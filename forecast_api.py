import csv
import gzip
import hashlib
import json
import math
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from io import StringIO
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

ROUTES = (1, 5, 7, 11, 12, 17, 25, 26, 28, 50)
START, END = date(2025, 11, 1), date(2025, 12, 31)
HEADER = ("route", "date", "hour", "prediction")
GROUPS = {"raw", "hour", "day", "week", "month", "weekday", "season"}


@dataclass(frozen=True)
class Snapshot:
    version: str
    quality_passed: bool
    serving_mode: str
    routes: tuple
    coverage_start: date
    coverage_end: date
    submission_start: date
    submission_end: date
    rows: tuple
    by_route: dict
    csv_bytes: bytes
    submission_csv_bytes: bytes
    gzip_csv_bytes: bytes
    gzip_submission_csv_bytes: bytes
    reference_map: dict | None


def _expected_rows(routes, start, end):
    for route in routes:
        day = start
        while day <= end:
            for hour in range(24):
                yield route, day, hour
            day += timedelta(days=1)


def snapshot_directory(directory):
    directory = Path(directory).resolve()
    current = directory / "current"
    if current.is_symlink():
        if not current.exists():
            raise ValueError("snapshot current pointer is broken")
        target = current.resolve()
        snapshots = (directory / ".snapshots").resolve()
        if (not target.is_dir() or target.parent != snapshots or len(target.name) != 64
                or any(c not in "0123456789abcdef" for c in target.name)):
            raise ValueError("snapshot current pointer is invalid")
        return target
    if current.is_file():
        try:
            generation = current.read_text(encoding="ascii").strip()
        except (OSError, UnicodeError) as error:
            raise ValueError("snapshot current pointer is invalid") from error
        if (len(generation) != 64
                or any(c not in "0123456789abcdef" for c in generation)):
            raise ValueError("snapshot current pointer is invalid")
        target = directory / ".snapshots" / generation
        if not target.is_dir():
            raise ValueError("snapshot current pointer is broken")
        return target.resolve()
    if current.exists():
        raise ValueError("snapshot current pointer must be a symlink or pointer file")
    return directory


def _period(value, name):
    try: start, end = date.fromisoformat(value["start"]), date.fromisoformat(value["end"])
    except (KeyError, TypeError, ValueError) as error: raise ValueError(f"snapshot metadata {name} is invalid") from error
    if start > end: raise ValueError(f"snapshot metadata {name} is invalid")
    return start, end


def load_snapshot(directory):
    directory = snapshot_directory(directory); csv_bytes = (directory / "forecast.csv").read_bytes()
    metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8")); digest = hashlib.sha256(csv_bytes).hexdigest()
    if metadata.get("schema_version") == 1:
        routes, coverage_start, coverage_end, submission_start, submission_end = ROUTES, START, END, START, END
    elif metadata.get("schema_version") == 2:
        routes = tuple(metadata.get("routes", ROUTES)); coverage_start, coverage_end = _period(metadata.get("coverage"), "coverage")
        submission_start, submission_end = _period(metadata.get("submission_coverage"), "submission_coverage")
    else: raise ValueError("snapshot metadata has an unexpected schema")
    if routes != ROUTES or not (coverage_start <= submission_start <= submission_end <= coverage_end): raise ValueError("snapshot metadata coverage is invalid")
    expected_count = len(routes) * ((coverage_end - coverage_start).days + 1) * 24
    if metadata.get("rows") != expected_count: raise ValueError("snapshot metadata schema has an unexpected row count")
    if metadata.get("forecast_sha256") != digest or not isinstance(metadata.get("forecast_version"), str) or not metadata["forecast_version"].strip(): raise ValueError("snapshot metadata hash or version is invalid")
    if not isinstance(metadata.get("quality_passed"), bool) or metadata.get("serving_mode") not in {"production", "diagnostic"}: raise ValueError("snapshot metadata quality status is invalid")
    if metadata["serving_mode"] == "production" and not metadata["quality_passed"]: raise ValueError("snapshot metadata quality status is inconsistent")
    try: reader = csv.DictReader(csv_bytes.decode("utf-8").splitlines(), delimiter=";")
    except UnicodeDecodeError as error: raise ValueError("forecast.csv must be UTF-8") from error
    if tuple(reader.fieldnames or ()) != HEADER: raise ValueError("forecast.csv has an unexpected schema")
    source_rows = list(reader)
    if len(source_rows) != expected_count: raise ValueError("forecast.csv has an unexpected row count")
    rows = []
    for line, (row, expected) in enumerate(zip(source_rows, _expected_rows(routes, coverage_start, coverage_end)), 2):
        try: actual, prediction = (int(row["route"]), date.fromisoformat(row["date"]), int(row["hour"])), float(row["prediction"])
        except (KeyError, TypeError, ValueError) as error: raise ValueError(f"forecast.csv line {line}: invalid value") from error
        if set(row) != set(HEADER) or any(v is None for v in row.values()) or actual != expected: raise ValueError(f"forecast.csv line {line}: grid is incomplete, duplicated, or unsorted")
        if not math.isfinite(prediction) or prediction < 0: raise ValueError(f"forecast.csv line {line}: prediction must be finite and nonnegative")
        rows.append((*actual, prediction))
    reference_path = directory / "reference_map.json"
    reference_hash = metadata.get("reference_map_sha256")
    if reference_hash is not None and (not reference_path.exists() or hashlib.sha256(reference_path.read_bytes()).hexdigest() != reference_hash):
        raise ValueError("reference map sidecar is missing or has an invalid hash")
    reference_map = json.loads(reference_path.read_text(encoding="utf-8")) if reference_path.exists() else None
    if reference_map is not None and reference_map.get("forecast_available") is not False: raise ValueError("reference map must explicitly deny stop forecast availability")
    # Preserve the source representation (for example integer ``3`` rather than
    # parsed float ``3.0``) so the submission export keeps its reproducible hash.
    submission_rows = [source for source, (_, day, _, _) in zip(source_rows, rows, strict=True)
                       if submission_start <= day <= submission_end]
    submission_csv = csv_bytes if (submission_start, submission_end) == (coverage_start, coverage_end) else _csv(submission_rows)
    return Snapshot(metadata["forecast_version"], metadata["quality_passed"], metadata["serving_mode"], routes, coverage_start, coverage_end,
                    submission_start, submission_end, tuple(rows), {route: tuple(item for item in rows if item[0] == route) for route in routes},
                    csv_bytes, submission_csv, gzip.compress(csv_bytes, mtime=0), gzip.compress(submission_csv, mtime=0), reference_map)


def _routes(value):
    try: result = tuple(sorted({int(item) for item in value.split(",")}))
    except ValueError as error: raise HTTPException(422, "routes must be comma-separated route numbers") from error
    if not result or any(route not in ROUTES for route in result): raise HTTPException(422, "routes contains an unsupported route")
    return result


def _season(day):
    return ("winter", "spring", "summer", "autumn")[(day.month % 12) // 3]


def accepts_gzip(header):
    if not header:
        return False
    values = {}
    for part in header.split(","):
        items = [item.strip() for item in part.split(";")]
        coding = items[0].lower()
        quality = 1.0
        for item in items[1:]:
            if item.lower().startswith("q="):
                try:
                    quality = float(item.split("=", 1)[1])
                except ValueError:
                    quality = 0.0
                if not 0 <= quality <= 1:
                    quality = 0.0
        values[coding] = quality
    return values.get("gzip", values.get("*", 0.0)) > 0


def _query(snapshot, routes, start_date, end_date, hour, group_by):
    if start_date < snapshot.coverage_start or end_date > snapshot.coverage_end or start_date > end_date: raise HTTPException(422, "date range is outside the forecast snapshot coverage")
    if hour is not None and not 0 <= hour <= 23: raise HTTPException(422, "hour must be between 0 and 23")
    if group_by not in GROUPS: raise HTTPException(422, "unsupported group_by")
    first = (start_date - snapshot.coverage_start).days * 24
    last = ((end_date - snapshot.coverage_start).days + 1) * 24
    rows = [item for route in routes for item in snapshot.by_route[route][first:last] if hour is None or item[2] == hour]
    if group_by == "raw": return [{"route": r, "date": d.isoformat(), "hour": h, "prediction": p} for r, d, h, p in rows]
    grouped = defaultdict(float)
    for _, day, item_hour, prediction in rows:
        if group_by == "hour":
            key = f"{item_hour:02d}:00"
        elif group_by == "day":
            key = day.isoformat()
        elif group_by == "week":
            key = f"{day.isocalendar().year}-W{day.isocalendar().week:02d}"
        elif group_by == "month":
            key = day.strftime("%Y-%m")
        elif group_by == "weekday":
            key = str(day.weekday())
        else:
            key = _season(day)
        grouped[key] += prediction
    return [{group_by: key, "prediction": value} for key, value in sorted(grouped.items())]


def _csv(rows):
    fields = tuple(rows[0]) if rows else ("route", "date", "hour", "prediction"); stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, delimiter=";", lineterminator="\n"); writer.writeheader(); writer.writerows(rows)
    return stream.getvalue().encode()


def create_app(forecast_dir=None):
    app = FastAPI()
    app.state.snapshot = None

    @app.on_event("startup")
    def startup():
        app.state.snapshot = load_snapshot(forecast_dir or os.environ.get("FORECAST_DIR", "artifacts/service"))

        @lru_cache(maxsize=128)
        def aggregate_cache(routes, start_date, end_date, hour, group_by):
            return tuple(_query(app.state.snapshot, routes, start_date, end_date, hour, group_by))

        app.state.aggregate_cache = aggregate_cache

    def query(routes, start_date, end_date, hour, group_by):
        if group_by == "raw":
            return _query(app.state.snapshot, routes, start_date, end_date, hour, group_by)
        return list(app.state.aggregate_cache(routes, start_date, end_date, hour, group_by))

    def csv_response(request, plain, compressed, filename):
        headers = {"Content-Disposition": f"attachment; filename={filename}", "Vary": "Accept-Encoding"}
        if accepts_gzip(request.headers.get("accept-encoding")):
            headers["Content-Encoding"] = "gzip"
            return Response(compressed, media_type="text/csv", headers=headers)
        return Response(plain, media_type="text/csv", headers=headers)

    @app.get("/health")
    def health():
        s = app.state.snapshot
        return {"ready": s is not None, "forecast_version": s.version if s else None, "quality_passed": s.quality_passed if s else None, "serving_mode": s.serving_mode if s else None, "coverage": {"start": s.coverage_start, "end": s.coverage_end} if s else None}
    def selected(routes, route, stop_id):
        if stop_id is not None: raise HTTPException(422, "stop forecasts are unavailable: reference stops have no boarding target")
        return _routes(routes) if routes is not None else _routes(str(route)) if route is not None else (_ for _ in ()).throw(HTTPException(422, "route or routes is required"))
    @app.get("/forecasts")
    def forecasts(routes: str | None = Query(None), route: int | None = Query(None), stop_id: str | None = Query(None), start_date: date = Query(...), end_date: date = Query(...), hour: int | None = Query(None), group_by: str = Query("raw")):
        chosen = selected(routes, route, stop_id)
        return {"forecast_version": app.state.snapshot.version, "routes": chosen, "group_by": group_by,
                "rows": query(chosen, start_date, end_date, hour, group_by)}
    @app.get("/forecasts/export.csv")
    def export_csv(request: Request, routes: str | None = Query(None), route: int | None = Query(None), stop_id: str | None = Query(None), start_date: date = Query(...), end_date: date = Query(...), hour: int | None = Query(None), group_by: str = Query("raw")):
        chosen = selected(routes, route, stop_id); s = app.state.snapshot
        if chosen == s.routes and (start_date, end_date, hour, group_by) == (s.coverage_start, s.coverage_end, None, "raw"):
            return csv_response(request, s.csv_bytes, s.gzip_csv_bytes, "forecasts.csv")
        payload = _csv(query(chosen, start_date, end_date, hour, group_by))
        return csv_response(request, payload, gzip.compress(payload, mtime=0), "forecasts.csv")
    @app.get("/forecasts.csv")
    def forecasts_csv(request: Request):
        s = app.state.snapshot
        return csv_response(request, s.submission_csv_bytes, s.gzip_submission_csv_bytes, "forecast.csv")
    @app.get("/reference-map")
    def reference_map(): return app.state.snapshot.reference_map or {"forecast_available": False, "routes": []}
    @app.get("/")
    def root(): return FileResponse(Path(__file__).with_name("static") / "index.html")
    return app


app = create_app()
