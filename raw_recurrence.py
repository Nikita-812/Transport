"""Build origin-safe first-route versus returning-card hourly aggregates."""
import argparse
import csv
import io
import json
import os
import sqlite3
import tempfile
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import pipeline
import raw_activity


START, END = raw_activity.START, raw_activity.END
RECURRENCE_FIELDS = ("route", "date", "hour", "boardings", "identified_boardings", "first_route_boardings", "returning_route_boardings")
LOOKUP_BATCH, SQLITE_IN_LIMIT = 10_000, 900


def _events(archive_path, member, progress_every):
    source = f"{Path(archive_path).name}/{member}"
    counts = {"events_read": 0, "events_kept": 0, "events_outside_dates": 0, "successful_kept": 0}
    with zipfile.ZipFile(archive_path) as archive, archive.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != list(raw_activity.RAW_FIELDS):
            raise ValueError(f"{source}: unexpected schema")
        for line, row in enumerate(reader, 2):
            if None in row:
                raise ValueError(f"{source} line {line}: unexpected field count")
            counts["events_read"] += 1
            stamp = raw_activity._timestamp(row["tran_date_time"], source, line)
            if not START <= stamp.date() <= END:
                counts["events_outside_dates"] += 1
                continue
            route = raw_activity._route(row["ngpt_route"], source, line)
            counts["events_kept"] += 1
            success = row["validation_result"].strip() == "1"
            counts["successful_kept"] += success
            if success:
                yield route, stamp.date(), stamp.hour, row["crd_hashcode"].strip()
            if progress_every and counts["events_read"] % progress_every == 0:
                print(f"{source}: read {counts['events_read']:,} events", flush=True)
    return counts


def _scan(archive_path, member, consumer, progress_every):
    generator = _events(archive_path, member, progress_every)
    while True:
        try:
            consumer(*next(generator))
        except StopIteration as stop:
            return stop.value


def _first_pass(sources, connection, progress_every):
    connection.execute("CREATE TABLE first_seen (route INTEGER NOT NULL, card TEXT NOT NULL, first_date TEXT NOT NULL, PRIMARY KEY (route, card))")
    statement = "INSERT INTO first_seen VALUES (?, ?, ?) ON CONFLICT(route, card) DO UPDATE SET first_date = MIN(first_date, excluded.first_date)"
    result = []
    for archive, member in sources:
        batch = []
        def consume(route, day, hour, card):
            if card:
                batch.append((route, card, day.isoformat()))
                if len(batch) >= LOOKUP_BATCH:
                    connection.executemany(statement, batch)
                    batch.clear()
        counts = _scan(archive, member, consume, progress_every)
        if batch:
            connection.executemany(statement, batch)
        source = raw_activity._source_info(archive, member)
        source.update(counts)
        result.append(source)
    connection.commit()
    return result


def _lookup(connection, pending, values):
    cards_by_route = defaultdict(set)
    for route, day, hour, card in pending:
        cards_by_route[route].add(card)
    first_dates = {}
    for route, cards in cards_by_route.items():
        cards = list(cards)
        for start in range(0, len(cards), SQLITE_IN_LIMIT):
            chunk = cards[start:start + SQLITE_IN_LIMIT]
            placeholders = ",".join("?" for _ in chunk)
            query = "SELECT card, first_date FROM first_seen WHERE route = ? AND card IN (" + placeholders + ")"
            for card, first_day in connection.execute(query, [route, *chunk]):
                first_dates[(route, card)] = date.fromisoformat(first_day)
    for route, day, hour, card in pending:
        item = values[(route, day, hour)]
        item[1] += 1
        item[2 if first_dates[(route, card)] == day else 3] += 1


def _second_pass(sources, connection, values, progress_every):
    result = []
    for archive, member in sources:
        pending = []
        def consume(route, day, hour, card):
            values[(route, day, hour)][0] += 1
            if card:
                pending.append((route, day, hour, card))
                if len(pending) >= LOOKUP_BATCH:
                    _lookup(connection, pending, values)
                    pending.clear()
        result.append(_scan(archive, member, consume, progress_every))
        if pending:
            _lookup(connection, pending, values)
    return result


def _rows(values):
    for route in pipeline.ROUTES:
        for day in pipeline.dates(START, END):
            for hour in range(24):
                yield (route, day.isoformat(), hour, *values.get((route, day, hour), (0, 0, 0, 0)))


def extract(train_archive=Path("train.zip"), test_archive=Path("Archive (1).zip"), output=Path("data/processed/raw_recurrence.csv"), history=Path("data/processed/history.csv"), progress_every=5_000_000):
    output, history = Path(output), Path(history)
    expected = raw_activity._history_boardings(history)
    sources = ((train_archive, "train.csv"), (test_archive, "test.csv"))
    values = defaultdict(lambda: [0, 0, 0, 0])
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.with_suffix(".metadata.json")
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        temporary = Path(temporary)
        connection = sqlite3.connect(temporary / "first-seen.sqlite")
        try:
            source_info = _first_pass(sources, connection, progress_every)
            _second_pass(sources, connection, values, progress_every)
        finally:
            connection.close()
        mismatches = sum(values.get(key, (0,))[0] != boardings for key, boardings in expected.items())
        if mismatches:
            raise ValueError(f"raw boardings differ from history.csv for {mismatches} keys")
        if any(item[2] + item[3] != item[1] or item[1] > item[0] for item in values.values()):
            raise ValueError("recurrence counts do not partition identified boardings")
        temporary_output = temporary / output.name
        with temporary_output.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, delimiter=";", lineterminator="\n")
            writer.writerow(RECURRENCE_FIELDS)
            writer.writerows(_rows(values))
        metadata = {
            "schema_version": 1,
            "definitions": {"first_route_boardings": "identified successful boardings whose card has no earlier observed calendar date on this route", "returning_route_boardings": "identified successful boardings whose card has an earlier observed calendar date on this route", "left_censoring": "first observed from 2025-01-01 is not proof of a new passenger or regular commuter"},
            "period": [START.isoformat(), END.isoformat()], "rows": 72_960, "sources": source_info,
            "events": {name: sum(item[name] for item in source_info) for name in ("events_read", "events_kept", "events_outside_dates", "successful_kept")},
            "reconciliation": {"history": history.name, "history_sha256": raw_activity._sha256(history), "keys": len(expected), "mismatches": 0, "boardings": sum(values.get(key, (0,))[0] for key in expected)},
            "source_code_sha256": raw_activity._sha256(Path(__file__)), "output_sha256": raw_activity._sha256(temporary_output),
        }
        temporary_metadata = temporary / metadata_path.name
        temporary_metadata.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        os.replace(temporary_output, output)
        os.replace(temporary_metadata, metadata_path)
    return metadata


def main(argv=None):
    parser = argparse.ArgumentParser(description="Aggregate first-route and returning-card boardings")
    parser.add_argument("--train-archive", type=Path, default=Path("train.zip"))
    parser.add_argument("--test-archive", type=Path, default=Path("Archive (1).zip"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/raw_recurrence.csv"))
    parser.add_argument("--history", type=Path, default=Path("data/processed/history.csv"))
    parser.add_argument("--progress-every", type=int, default=5_000_000)
    args = parser.parse_args(argv)
    extract(args.train_archive, args.test_archive, args.output, args.history, args.progress_every)


if __name__ == "__main__":
    main()
