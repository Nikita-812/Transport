import argparse
import csv
import hashlib
import json
import math
import os
import sys
import tempfile
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


ROUTES = (1, 5, 7, 11, 12, 17, 25, 26, 28, 50)
LABEL_MEMBERS = (
    ("labels/labels_day_train.csv", date(2025, 1, 1), date(2025, 8, 31)),
    ("labels/labels_day_test.csv", date(2025, 9, 1), date(2025, 10, 31)),
)
HISTORY_END = date(2025, 10, 31)
FUTURE_START = date(2025, 11, 1)
FUTURE_END = date(2025, 12, 31)
CALENDAR_FIELDS = (
    "weekday", "month", "is_weekend", "is_holiday", "is_workday", "is_preholiday"
)
HISTORY_FIELDS = ("route", "date", "hour", "boardings", *CALENDAR_FIELDS)
FUTURE_FIELDS = ("route", "date", "hour", *CALENDAR_FIELDS)
SLICES = (
    ("may-june", date(2025, 4, 30), date(2025, 5, 1), date(2025, 6, 30)),
    ("july-august", date(2025, 6, 30), date(2025, 7, 1), date(2025, 8, 31)),
    ("september-october", date(2025, 8, 31), date(2025, 9, 1), date(2025, 10, 31)),
)


def dates(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def sha256_bytes(content):
    return hashlib.sha256(content).hexdigest()


def sha256_member(archive_path, member):
    with zipfile.ZipFile(archive_path) as archive:
        try:
            return sha256_bytes(archive.read(member))
        except KeyError as error:
            raise ValueError(f"missing ZIP member: {member}") from error


def load_calendar(path):
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("year") != 2025 or not data.get("sources"):
        raise ValueError("calendar must describe 2025 and include sources")
    for field in ("holidays", "transferred_days_off", "transferred_workdays", "preholidays"):
        data[field] = {date.fromisoformat(value) for value in data.get(field, [])}
    return data


def calendar_features(day, calendar):
    weekend = day.weekday() >= 5
    workday = not weekend
    if day in calendar["holidays"] or day in calendar["transferred_days_off"]:
        workday = False
    if day in calendar["transferred_workdays"]:
        workday = True
    return {
        "weekday": day.weekday(),
        "month": day.month,
        "is_weekend": int(weekend),
        "is_holiday": int(day in calendar["holidays"]),
        "is_workday": int(workday),
        "is_preholiday": int(day in calendar["preholidays"]),
    }


def _read_csv_bytes(content, expected_header, source):
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError(f"{source}: expected UTF-8") from error
    reader = csv.DictReader(text.splitlines(), delimiter=";")
    if reader.fieldnames != list(expected_header):
        raise ValueError(f"{source}: schema must be {';'.join(expected_header)}")
    return reader


def _integer(row, field, source, line):
    value = row.get(field)
    if value is None or value.strip() == "":
        raise ValueError(f"{source} line {line}: missing {field}")
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{source} line {line}: {field} must be an integer") from error


def read_labels(archive, member, start, end):
    try:
        content = archive.read(member)
    except KeyError as error:
        raise ValueError(f"missing ZIP member: {member}") from error
    reader = _read_csv_bytes(content, ("route", "date", "hour", "boardings"), member)
    values = {}
    for line, row in enumerate(reader, 2):
        route = _integer(row, "route", member, line)
        hour = _integer(row, "hour", member, line)
        boardings = _integer(row, "boardings", member, line)
        if route not in ROUTES:
            raise ValueError(f"{member} line {line}: unknown route {route}")
        if not 0 <= hour <= 23:
            raise ValueError(f"{member} line {line}: hour outside 0..23")
        if boardings < 0:
            raise ValueError(f"{member} line {line}: negative boardings")
        try:
            day = date.fromisoformat(row["date"])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{member} line {line}: invalid date") from error
        if not start <= day <= end:
            raise ValueError(f"{member} line {line}: date outside source range")
        key = (route, day, hour)
        if key in values:
            raise ValueError(f"{member} line {line}: duplicate key {key}")
        values[key] = boardings
    return values, {"member": member, "sha256": sha256_bytes(content), "rows": len(values), "boardings": sum(values.values())}


def _expected_keys(start, end):
    return {(route, day, hour) for route in ROUTES for day in dates(start, end) for hour in range(24)}


def read_submission_keys(archive):
    member = "test_submission.csv"
    try:
        content = archive.read(member)
    except KeyError as error:
        raise ValueError(f"missing ZIP member: {member}") from error
    reader = _read_csv_bytes(content, ("route", "date", "hour", "prediction"), member)
    keys = set()
    for line, row in enumerate(reader, 2):
        route = _integer(row, "route", member, line)
        hour = _integer(row, "hour", member, line)
        try:
            day = date.fromisoformat(row["date"])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{member} line {line}: invalid date") from error
        key = (route, day, hour)
        if key in keys:
            raise ValueError(f"{member} line {line}: duplicate key {key}")
        keys.add(key)
    expected = _expected_keys(FUTURE_START, FUTURE_END)
    if keys != expected:
        raise ValueError(f"{member}: keys do not match the required future grid")
    return keys


def _write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter=";", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _grid_rows(start, end, calendar, values=None):
    for route in ROUTES:
        for day in dates(start, end):
            features = calendar_features(day, calendar)
            for hour in range(24):
                row = {"route": route, "date": day.isoformat(), "hour": hour}
                if values is not None:
                    row["boardings"] = values.get((route, day, hour), 0)
                row.update(features)
                yield row


def prepare(archive_path, output_dir, calendar_path=None):
    archive_path = Path(archive_path)
    output_dir = Path(output_dir)
    calendar_path = Path(calendar_path or Path(__file__).with_name("calendar_2025.json"))
    calendar = load_calendar(calendar_path)
    values = {}
    sources = []
    class DirectorySource:
        def __init__(self, root):
            self.root = root

        def read(self, member):
            path = self.root / Path(member)
            if not path.is_file():
                raise KeyError(member)
            return path.read_bytes()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    source = DirectorySource(archive_path) if archive_path.is_dir() else zipfile.ZipFile(archive_path)
    with source as archive:
        for member, start, end in LABEL_MEMBERS:
            part, source = read_labels(archive, member, start, end)
            values.update(part)
            sources.append(source)
        read_submission_keys(archive)

    history_rows = 10 * 304 * 24
    metadata = {
        "schema_version": 1,
        "python_version": sys.version.split()[0],
        "archive": archive_path.name,
        "sources": sources,
        "calendar": {
            "file": calendar_path.name,
            "sha256": sha256_bytes(calendar_path.read_bytes()),
            "sources": calendar["sources"],
        },
        "periods": {"history": ["2025-01-01", "2025-10-31"], "future": ["2025-11-01", "2025-12-31"]},
        "routes": list(ROUTES),
        "rows": {"history": history_rows, "future": 14_640},
        "boardings": {"total": sum(values.values()), "by_source": {item["member"]: item["boardings"] for item in sources}},
        "added_zero_rows": history_rows - len(values),
        "zero_rows_by_route": {
            str(route): sum(values.get((route, day, hour), 0) == 0 for day in dates(date(2025, 1, 1), HISTORY_END) for hour in range(24))
            for route in ROUTES
        },
    }

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output_dir.parent) as temporary:
        temporary = Path(temporary)
        _write_csv(temporary / "history.csv", HISTORY_FIELDS, _grid_rows(date(2025, 1, 1), HISTORY_END, calendar, values))
        _write_csv(temporary / "future.csv", FUTURE_FIELDS, _grid_rows(FUTURE_START, FUTURE_END, calendar))
        (temporary / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        for name in ("history.csv", "future.csv", "metadata.json"):
            os.replace(temporary / name, output_dir / name)
    return metadata


def fit_seasonal(rows):
    levels = (defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]))
    for row in rows:
        value = int(row["boardings"])
        keys = ((int(row["route"]), int(row["weekday"]), int(row["hour"])), (int(row["route"]), int(row["hour"])), int(row["route"]))
        for level, key in zip(levels, keys):
            level[key][0] += value
            level[key][1] += 1
    return tuple({key: total / count for key, (total, count) in level.items()} for level in levels)


def predict_seasonal(model, route, weekday, hour):
    route = int(route)
    hour = int(hour)
    value = model[0].get((route, int(weekday), hour), model[1].get((route, hour), model[2].get(route, 0)))
    return max(0.0, value) if math.isfinite(value) else 0.0


def metric(rows):
    rows = list(rows)
    target = sum(int(row["boardings"]) for row in rows)
    error = sum(abs(int(row["boardings"]) - float(row["prediction"])) for row in rows)
    wape = error / target if target else None
    return {
        "rows": len(rows),
        "target_sum": target,
        "absolute_error": error,
        "wape": wape,
        "wape_score": max(0.0, 1.0 - wape) if wape is not None else None,
    }


def _groups(rows, key, expected=None):
    grouped = defaultdict(list)
    for row in rows:
        grouped[str(key(row))].append(row)
    names = [str(value) for value in expected] if expected is not None else sorted(grouped)
    return [(name, grouped[name]) for name in names]


def build_metrics(rows):
    rows = list(rows)
    overall = metric(rows)
    total_error = overall["absolute_error"]

    def metrics_for(groups, shares=False):
        result = []
        for name, group_rows in groups:
            item = {"group": name, **metric(group_rows)}
            if shares:
                item["absolute_error_share"] = item["absolute_error"] / total_error if total_error else 0
            result.append(item)
        return result

    def day_type(row):
        if int(row["is_holiday"]):
            return "holiday"
        return "workday_nonholiday" if int(row["is_workday"]) else "other_nonworkday"

    return {
        "overall": overall,
        "by_month": metrics_for(_groups(rows, lambda row: row["date"].strftime("%Y-%m"))),
        "by_route": metrics_for(_groups(rows, lambda row: row["route"], ROUTES), shares=True),
        "by_hour": metrics_for(_groups(rows, lambda row: row["hour"], range(24))),
        "by_day_type": metrics_for(_groups(rows, day_type, ("holiday", "workday_nonholiday", "other_nonworkday"))),
    }


def evaluate_slice(rows, cutoff, start, end):
    model = fit_seasonal(row for row in rows if row["date"] <= cutoff)
    predictions = []
    for row in rows:
        if start <= row["date"] <= end:
            result = dict(row)
            result["prediction"] = predict_seasonal(model, row["route"], row["weekday"], row["hour"])
            predictions.append(result)
    return predictions, build_metrics(predictions)


def read_history(path):
    with Path(path).open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != list(HISTORY_FIELDS):
            raise ValueError("history.csv has an unexpected schema")
        rows = []
        for row in reader:
            rows.append({
                **row,
                "route": int(row["route"]),
                "date": date.fromisoformat(row["date"]),
                "hour": int(row["hour"]),
                "boardings": int(row["boardings"]),
                **{field: int(row[field]) for field in CALENDAR_FIELDS},
            })
    return rows


def evaluate(data_dir, output_dir):
    rows = read_history(Path(data_dir) / "history.csv")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "protocol": "fixed-origin two-calendar-month evaluation",
        "notes": [
            "September-October is a local holdout already examined in EDA, not an untouched independent estimate.",
            "No target from a validation horizon is used to update forecasts within that horizon.",
            "The known route 50 weekend regime change is diagnostic context only and is not applied retrospectively to predictions.",
        ],
        "slices": {},
    }
    for name, cutoff, start, end in SLICES:
        predictions, metrics = evaluate_slice(rows, cutoff, start, end)
        report["slices"][name] = {
            "cutoff": cutoff.isoformat(),
            "horizon": [start.isoformat(), end.isoformat()],
            "metrics": metrics,
        }
        fields = ("route", "date", "hour", "boardings", "prediction", "forecast_origin")
        _write_csv(
            output_dir / f"{name}-predictions.csv",
            fields,
            ({
                "route": row["route"], "date": row["date"].isoformat(), "hour": row["hour"],
                "boardings": row["boardings"], "prediction": row["prediction"], "forecast_origin": cutoff.isoformat(),
            } for row in predictions),
        )
    (output_dir / "metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare and evaluate the hourly tram dataset")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("--archive", required=True, type=Path)
    prepare_parser.add_argument("--output-dir", required=True, type=Path)
    prepare_parser.add_argument("--calendar", type=Path, default=Path(__file__).with_name("calendar_2025.json"))
    evaluate_parser = commands.add_parser("evaluate")
    evaluate_parser.add_argument("--data-dir", required=True, type=Path)
    evaluate_parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "prepare":
        prepare(args.archive, args.output_dir, args.calendar)
    else:
        evaluate(args.data_dir, args.output_dir)


if __name__ == "__main__":
    main()
