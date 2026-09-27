"""Stream successful raw validations into historical fare-category aggregates."""

import argparse
import csv
import io
import json
import os
import sqlite3
import tempfile
import zipfile
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date
from pathlib import Path

import pipeline
import raw_activity


FARE_FIELDS = ("route", "date", "hour", "good_type", "good_type_missing", "boardings")
BUFFER_KEYS = 50_000


def _flush(connection, buffer):
    if not buffer:
        return
    connection.executemany(
        "INSERT INTO fares VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(route, date, hour, good_type, good_type_missing) "
        "DO UPDATE SET boardings = boardings + excluded.boardings",
        ((*key, boardings) for key, boardings in buffer.items()),
    )
    buffer.clear()


def _stream(archive_path, member, connection, progress_every):
    counts = {"events_read": 0, "events_kept": 0, "events_outside_dates": 0, "successful_kept": 0}
    buffer = Counter()
    source = f"{Path(archive_path).name}/{member}"
    with zipfile.ZipFile(archive_path) as archive:
        try:
            raw = archive.open(member)
        except KeyError as error:
            raise ValueError(f"missing ZIP member: {member}") from error
        with raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, delimiter=";")
            if reader.fieldnames != list(raw_activity.RAW_FIELDS):
                raise ValueError(f"{source}: unexpected schema")
            for line, row in enumerate(reader, 2):
                if None in row:
                    raise ValueError(f"{source} line {line}: unexpected field count")
                counts["events_read"] += 1
                if progress_every and counts["events_read"] % progress_every == 0:
                    print(f"{source}: read {counts['events_read']:,} events", flush=True)
                stamp = raw_activity._timestamp(row["tran_date_time"], source, line)
                if not raw_activity.START <= stamp.date() <= raw_activity.END:
                    counts["events_outside_dates"] += 1
                    continue
                route = raw_activity._route(row["ngpt_route"], source, line)
                counts["events_kept"] += 1
                if row["validation_result"].strip() != "1":
                    continue
                good_type = row["good_type"]
                missing = int(not good_type.strip())
                if missing:
                    good_type = ""
                buffer[(route, stamp.date().isoformat(), stamp.hour, good_type, missing)] += 1
                counts["successful_kept"] += 1
                if len(buffer) >= BUFFER_KEYS:
                    _flush(connection, buffer)
    _flush(connection, buffer)
    return counts


def _reconcile(connection, expected):
    actual = {
        (route, date.fromisoformat(day), hour): boardings
        for route, day, hour, boardings in connection.execute(
            "SELECT route, date, hour, SUM(boardings) FROM fares GROUP BY route, date, hour"
        )
    }
    mismatches = sum(actual.get(key, 0) != boardings for key, boardings in expected.items())
    if mismatches:
        raise ValueError(f"raw fare boardings differ from history.csv for {mismatches} keys")


def _summary(connection, expected):
    totals = defaultdict(int)
    route_totals = defaultdict(int)
    support = defaultdict(int)
    route_support = defaultdict(int)
    for route, good_type, missing, boardings, keys in connection.execute(
        "SELECT route, good_type, good_type_missing, SUM(boardings), COUNT(*) FROM fares "
        "GROUP BY route, good_type, good_type_missing"
    ):
        key = (good_type, missing)
        totals[key] += boardings
        support[key] += keys
        route_totals[(key, route)] = boardings
        route_support[(key, route)] = keys
    history_by_route = defaultdict(int)
    for (route, _, _), boardings in expected.items():
        history_by_route[route] += boardings
    history_total = sum(history_by_route.values())
    categories = []
    for good_type, missing in sorted(totals, key=lambda key: (key[1], key[0])):
        key = (good_type, missing)
        categories.append({
            "good_type": good_type,
            "good_type_missing": missing,
            "boardings": totals[key],
            "global_boarding_share": totals[key] / history_total if history_total else 0,
            "nonzero_route_date_hours": support[key],
            "by_route": [
                {"route": route, "boardings": route_totals[(key, route)],
                 "boarding_share": route_totals[(key, route)] / history_by_route[route] if history_by_route[route] else 0,
                 "nonzero_date_hours": route_support[(key, route)]}
                for route in pipeline.ROUTES if (key, route) in route_totals
            ],
        })
    return {"category_count": len(categories), "rows": sum(support.values()), "boardings": history_total, "categories": categories}


def extract(train_archive=Path("train.zip"), test_archive=Path("Archive (1).zip"), output=Path("data/processed/raw_fares.csv"), history=Path("data/processed/history.csv"), progress_every=5_000_000):
    output, history = Path(output), Path(history)
    expected = raw_activity._history_boardings(history)
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.with_suffix(".metadata.json")
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        temporary = Path(temporary)
        database = temporary / "fares.sqlite3"
        with closing(sqlite3.connect(database)) as connection, connection:
            connection.execute(
                "CREATE TABLE fares (route INTEGER, date TEXT, hour INTEGER, good_type TEXT, good_type_missing INTEGER, boardings INTEGER, "
                "PRIMARY KEY (route, date, hour, good_type, good_type_missing)) WITHOUT ROWID"
            )
            sources = []
            for archive, member in ((train_archive, "train.csv"), (test_archive, "test.csv")):
                source = raw_activity._source_info(archive, member)
                source.update(_stream(archive, member, connection, progress_every))
                sources.append(source)
            _reconcile(connection, expected)
            summary = _summary(connection, expected)
            temporary_output = temporary / output.name
            with temporary_output.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream, delimiter=";", lineterminator="\n")
                writer.writerow(FARE_FIELDS)
                writer.writerows(connection.execute(
                    "SELECT route, date, hour, good_type, good_type_missing, boardings FROM fares "
                    "ORDER BY route, date, hour, good_type_missing, good_type"
                ))
        metadata = {
            "schema_version": 1,
            "definitions": {
                "boardings": "validation_result == 1",
                "good_type": "raw good_type; blank values are retained with good_type_missing == 1",
                "modeling": "fit or forecast composition from pre-origin history only; never use realized horizon composition",
            },
            "period": [raw_activity.START.isoformat(), raw_activity.END.isoformat()],
            "parent_grid_rows": 72_960,
            "rows": summary["rows"],
            "sources": sources,
            "events": {name: sum(item[name] for item in sources) for name in ("events_read", "events_kept", "events_outside_dates", "successful_kept")},
            "reconciliation": {"history": history.name, "history_sha256": raw_activity._sha256(history), "keys": len(expected), "mismatches": 0, "boardings": summary["boardings"]},
            "summary": summary,
            "source_code_sha256": raw_activity._sha256(Path(__file__)),
            "output_sha256": raw_activity._sha256(temporary_output),
        }
        temporary_metadata = temporary / metadata_path.name
        temporary_metadata.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        os.replace(temporary_output, output)
        os.replace(temporary_metadata, metadata_path)
    return metadata


def main(argv=None):
    parser = argparse.ArgumentParser(description="Stream raw tram fare categories into hourly aggregates")
    parser.add_argument("--train-archive", type=Path, default=Path("train.zip"))
    parser.add_argument("--test-archive", type=Path, default=Path("Archive (1).zip"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/raw_fares.csv"))
    parser.add_argument("--history", type=Path, default=Path("data/processed/history.csv"))
    parser.add_argument("--progress-every", type=int, default=5_000_000)
    args = parser.parse_args(argv)
    extract(args.train_archive, args.test_archive, args.output, args.history, args.progress_every)


if __name__ == "__main__":
    main()
