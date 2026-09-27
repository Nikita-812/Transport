"""FastAPI application serving an immutable validated forecast snapshot."""

from __future__ import annotations

import csv
import hashlib
import io
import math
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from pipeline import FUTURE_END, FUTURE_START, ROUTES


def load_snapshot(path):
    path = Path(path); content = path.read_bytes()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("snapshot must be UTF-8") from error
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    if reader.fieldnames != ["route", "date", "hour", "prediction"]:
        raise ValueError("snapshot schema must be route;date;hour;prediction")
    rows = []; keys = set()
    for line, raw in enumerate(reader, 2):
        try:
            route, day, hour, prediction = int(raw["route"]), date.fromisoformat(raw["date"]), int(raw["hour"]), float(raw["prediction"])
        except (TypeError, ValueError) as error:
            raise ValueError(f"snapshot line {line}: invalid value") from error
        key = (route, day, hour)
        if route not in ROUTES or not FUTURE_START <= day <= FUTURE_END or not 0 <= hour <= 23:
            raise ValueError(f"snapshot line {line}: key outside forecast grid")
        if key in keys:
            raise ValueError(f"snapshot line {line}: duplicate key")
        if not math.isfinite(prediction) or prediction < 0:
            raise ValueError(f"snapshot line {line}: invalid prediction")
        keys.add(key); rows.append({"route": route, "date": day.isoformat(), "hour": hour, "prediction": prediction})
    if len(keys) != 14_640:
        raise ValueError(f"snapshot must contain 14640 rows, got {len(keys)}")
    rows.sort(key=lambda r: (r["route"], r["date"], r["hour"]))
    output = io.StringIO(newline=""); writer = csv.DictWriter(output, fieldnames=reader.fieldnames, delimiter=";", lineterminator="\n")
    writer.writeheader(); writer.writerows(rows)
    return {"rows": rows, "csv": output.getvalue().encode(), "version": hashlib.sha256(content).hexdigest()}


def create_app(snapshot_path, mode="snapshot", online_predictor=None):
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.responses import Response
    if mode not in {"snapshot", "online"}:
        raise ValueError("mode must be snapshot or online")
    if mode == "online" and online_predictor is None:
        raise ValueError("online mode requires a preloaded predictor")
    snapshot = load_snapshot(snapshot_path)
    index = {(r["route"], r["date"], r["hour"]): r for r in snapshot["rows"]}
    app = FastAPI(title="Tram Forecast API")

    @app.get("/health")
    def health():
        return {"ready": True, "forecast_version": snapshot["version"], "mode": mode, "rows": len(index)}

    @app.get("/forecasts")
    def forecasts(route: int, start_date: date, end_date: date, hour: int | None = Query(None, ge=0, le=23)):
        if route not in ROUTES:
            raise HTTPException(422, "unknown route")
        if start_date > end_date or start_date < FUTURE_START or end_date > FUTURE_END:
            raise HTTPException(422, "date range outside snapshot or reversed")
        rows = [r for r in snapshot["rows"] if r["route"] == route and start_date.isoformat() <= r["date"] <= end_date.isoformat() and (hour is None or r["hour"] == hour)]
        if mode == "online":
            values = online_predictor(rows)
            rows = [dict(row, prediction=max(0.0, float(value))) for row, value in zip(rows, values)]
        return {"forecast_version": snapshot["version"], "mode": mode, "rows": rows}

    @app.get("/forecasts.csv")
    def forecasts_csv():
        return Response(snapshot["csv"], media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=forecasts.csv"})

    return app


def app_from_environment():
    import os
    snapshot = os.environ.get("FORECAST_SNAPSHOT")
    if not snapshot:
        raise RuntimeError("FORECAST_SNAPSHOT is required")
    return create_app(snapshot, os.environ.get("FORECAST_MODE", "snapshot"))
