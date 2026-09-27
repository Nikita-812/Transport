"""Stream raw validation archives into route-hour operational aggregates."""

import argparse
import csv
import hashlib
import io
import json
import os
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path

import pipeline


RAW_FIELDS = (
    "tran_no", "device_no", "tran_date_time", "begin_date_time", "input_date_time",
    "crd_hashcode", "validation_result", "tran_type_id", "place_id", "good_type",
    "pass_route", "ngpt_route", "bus_exit_no", "garage_number",
)
ACTIVITY_FIELDS = (
    "route", "date", "hour", "boardings", "events", "active_vehicles", "active_exits", "active_devices",
)
START, END = date(2025, 1, 1), date(2025, 10, 31)


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _route(value, source, line):
    try:
        route = int(value.strip().split(maxsplit=1)[0])
    except (AttributeError, IndexError, ValueError) as error:
        raise ValueError(f"{source} line {line}: invalid ngpt_route") from error
    if route not in pipeline.ROUTES:
        raise ValueError(f"{source} line {line}: unknown route {route}")
    return route


def _timestamp(value, source, line):
    try:
        if len(value) != 19 or value[10] != " ":
            raise ValueError
        return datetime.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{source} line {line}: invalid tran_date_time") from error


def _source_info(archive_path, member):
    with zipfile.ZipFile(archive_path) as archive:
        try:
            info = archive.getinfo(member)
        except KeyError as error:
            raise ValueError(f"missing ZIP member: {member}") from error
    return {"archive": Path(archive_path).name, "member": member, "crc": info.CRC, "size": info.file_size}


def _stream(archive_path, member, values, progress_every):
    counts = {"events_read": 0, "events_kept": 0, "events_outside_dates": 0}
    source = f"{Path(archive_path).name}/{member}"
    with zipfile.ZipFile(archive_path) as archive:
        try:
            raw = archive.open(member)
        except KeyError as error:
            raise ValueError(f"missing ZIP member: {member}") from error
        with raw:
            with io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream, delimiter=";")
                if reader.fieldnames != list(RAW_FIELDS):
                    raise ValueError(f"{source}: unexpected schema")
                for line, row in enumerate(reader, 2):
                    if None in row:
                        raise ValueError(f"{source} line {line}: unexpected field count")
                    counts["events_read"] += 1
                    stamp = _timestamp(row["tran_date_time"], source, line)
                    if not START <= stamp.date() <= END:
                        counts["events_outside_dates"] += 1
                        continue
                    route = _route(row["ngpt_route"], source, line)
                    counts["events_kept"] += 1
                    key = (route, stamp.date(), stamp.hour)
                    item = values.setdefault(key, [0, 0, set(), set(), set()])
                    item[0] += row["validation_result"].strip() == "1"
                    item[1] += 1
                    for index, field in ((2, "garage_number"), (3, "bus_exit_no"), (4, "device_no")):
                        value = row[field].strip()
                        if value:
                            item[index].add(value)
                    if progress_every and counts["events_read"] % progress_every == 0:
                        print(f"{source}: read {counts['events_read']:,} events", flush=True)
    return counts


def _history_boardings(path):
    values = {}
    with Path(path).open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != list(pipeline.HISTORY_FIELDS):
            raise ValueError("history.csv has an unexpected schema")
        for line, row in enumerate(reader, 2):
            try:
                key = (int(row["route"]), date.fromisoformat(row["date"]), int(row["hour"]))
                boardings = int(row["boardings"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"history.csv line {line}: invalid key or boardings") from error
            if key in values:
                raise ValueError(f"history.csv line {line}: duplicate key")
            values[key] = boardings
    expected = {(route, day, hour) for route in pipeline.ROUTES for day in pipeline.dates(START, END) for hour in range(24)}
    if set(values) != expected:
        raise ValueError("history.csv keys do not match the canonical history grid")
    return values


def _rows(values):
    for route in pipeline.ROUTES:
        for day in pipeline.dates(START, END):
            for hour in range(24):
                item = values.get((route, day, hour))
                if item is None:
                    item = (0, 0, (), (), ())
                yield (route, day.isoformat(), hour, item[0], item[1], len(item[2]), len(item[3]), len(item[4]))


def extract(train_archive=Path("train.zip"), test_archive=Path("Archive (1).zip"), output=Path("data/processed/raw_activity.csv"), history=Path("data/processed/history.csv"), progress_every=5_000_000):
    output, history = Path(output), Path(history)
    expected = _history_boardings(history)
    values = {}
    sources = []
    for archive, member in ((train_archive, "train.csv"), (test_archive, "test.csv")):
        source = _source_info(archive, member)
        source.update(_stream(archive, member, values, progress_every))
        sources.append(source)

    mismatches = sum(values.get(key, (0,))[0] != boardings for key, boardings in expected.items())
    if mismatches:
        raise ValueError(f"raw boardings differ from history.csv for {mismatches} keys")

    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.with_suffix(".metadata.json")
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        temporary = Path(temporary)
        temporary_output = temporary / output.name
        with temporary_output.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, delimiter=";", lineterminator="\n")
            writer.writerow(ACTIVITY_FIELDS)
            writer.writerows(_rows(values))
        metadata = {
            "schema_version": 1,
            "definitions": {
                "boardings": "validation_result == 1",
                "events": "all observed validations in the route-date-hour key",
                "active_vehicles": "distinct nonblank garage_number among events",
                "active_exits": "distinct nonblank bus_exit_no among events",
                "active_devices": "distinct nonblank device_no among events",
            },
            "period": [START.isoformat(), END.isoformat()],
            "rows": 72_960,
            "sources": sources,
            "events": {name: sum(item[name] for item in sources) for name in ("events_read", "events_kept", "events_outside_dates")},
            "reconciliation": {"history": history.name, "history_sha256": _sha256(history), "keys": len(expected), "mismatches": 0, "boardings": sum(values.get(key, (0,))[0] for key in expected)},
            "source_code_sha256": _sha256(Path(__file__)),
            "output_sha256": _sha256(temporary_output),
        }
        temporary_metadata = temporary / metadata_path.name
        temporary_metadata.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        os.replace(temporary_output, output)
        os.replace(temporary_metadata, metadata_path)
    return metadata


def main(argv=None):
    parser = argparse.ArgumentParser(description="Stream raw tram activity into hourly aggregates")
    parser.add_argument("--train-archive", type=Path, default=Path("train.zip"))
    parser.add_argument("--test-archive", type=Path, default=Path("Archive (1).zip"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/raw_activity.csv"))
    parser.add_argument("--history", type=Path, default=Path("data/processed/history.csv"))
    parser.add_argument("--progress-every", type=int, default=5_000_000)
    args = parser.parse_args(argv)
    extract(args.train_archive, args.test_archive, args.output, args.history, args.progress_every)


if __name__ == "__main__":
    main()
