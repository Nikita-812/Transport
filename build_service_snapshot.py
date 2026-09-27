"""Build the production snapshot bundled with the Docker image.

The command re-evaluates the accepted pooled_route_blend on every fixed
validation slice before publishing anything.  Training data is required only
to regenerate the bundle; the resulting snapshot is served without sklearn.
"""

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path

import accuracy
import forecast_api
import forecast_export
import pipeline


def sha256_bytes(content):
    return hashlib.sha256(content).hexdigest()


def rounded_predictions(values):
    result = [round(value) for value in values]
    if not all(isinstance(value, int) and value >= 0 for value in result):
        raise ValueError("predictions must be finite nonnegative integers")
    return result


def csv_bytes(rows, predictions):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";", lineterminator="\n")
    writer.writerow(("route", "date", "hour", "prediction"))
    for row, prediction in zip(rows, predictions, strict=True):
        writer.writerow((row["route"], row["date"].isoformat(), row["hour"], prediction))
    return stream.getvalue().encode("utf-8")


def atomic_write(path, content):
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def evaluate(history):
    slices = {}
    for name, cutoff, start, end in pipeline.SLICES:
        train = [row for row in history if row["date"] <= cutoff]
        validation = [row for row in history if start <= row["date"] <= end]
        features = [{key: value for key, value in row.items() if key != "boardings"} for row in validation]
        predictions = rounded_predictions(accuracy.pooled_route_blend_predictions(train, features))
        score = pipeline.metric(
            {**row, "prediction": prediction}
            for row, prediction in zip(validation, predictions, strict=True)
        )
        if not math.isfinite(score["wape_score"]):
            raise ValueError(f"{name}: WAPE-score is not finite")
        slices[name] = {
            "cutoff": cutoff.isoformat(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "rows": score["rows"],
            "absolute_error": score["absolute_error"],
            "target_sum": score["target_sum"],
            "wape": score["wape"],
            "wape_score": score["wape_score"],
            "target_wape_score": pipeline.TARGET_WAPE_SCORE,
            "passed": score["wape_score"] >= pipeline.TARGET_WAPE_SCORE,
        }
    failures = [name for name, score in slices.items() if not score["passed"]]
    if failures:
        raise ValueError(
            f"{', '.join(failures)}: absolute WAPE-score is below {pipeline.TARGET_WAPE_SCORE:.2f}"
        )
    return slices


def build(data_dir, output_dir, reference_map_path, horizon):
    data_dir, output_dir = Path(data_dir), Path(output_dir)
    history_path = data_dir / "history.csv"
    history = pipeline.read_history(history_path)
    slices = evaluate(history)

    start = pipeline.FUTURE_START
    end = forecast_export.horizon_end(start, horizon)
    future = forecast_export.future_rows(start, end)
    predictions = rounded_predictions(accuracy.pooled_route_blend_predictions(history, future))
    forecast = csv_bytes(future, predictions)

    reference = Path(reference_map_path).read_bytes()
    parsed_reference = json.loads(reference.decode("utf-8"))
    if parsed_reference.get("forecast_available") is not False:
        raise ValueError("reference map must explicitly deny stop forecast availability")

    quality = {
        "schema_version": 1,
        "winner": "pooled_route_blend",
        "target_wape_score": pipeline.TARGET_WAPE_SCORE,
        "quality_passed": True,
        "protocol": "fixed-origin two-month forecasts; integer predictions; no refit within a slice",
        "history_sha256": forecast_export.sha256(history_path),
        "slices": slices,
    }
    quality_bytes = (json.dumps(quality, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    forecast_hash = sha256_bytes(forecast)
    metadata = {
        "schema_version": 2,
        "rows": len(future),
        "routes": list(pipeline.ROUTES),
        "coverage": {"start": start.isoformat(), "end": end.isoformat()},
        "submission_coverage": {
            "start": start.isoformat(),
            "end": min(end, pipeline.FUTURE_END).isoformat(),
        },
        "horizon": horizon,
        "winner": "pooled_route_blend",
        "accuracy": "fixed-origin quality gate passed; dates after 2025-12-31 are an unvalidated extension",
        "quality_passed": True,
        "serving_mode": "production",
        "history_sha256": quality["history_sha256"],
        "forecast_sha256": forecast_hash,
        "forecast_version": f"pooled_route_blend:{forecast_hash[:12]}",
        "reference_map_sha256": sha256_bytes(reference),
        "quality_report_sha256": sha256_bytes(quality_bytes),
    }
    metadata_bytes = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    if output_dir.exists():
        raise FileExistsError(f"{output_dir} already exists; choose a fresh output directory")
    # Create the directory in place so files inherit the workspace ACL on Windows.
    # Moving a TemporaryDirectory here can leave Docker Desktop unable to read it.
    output_dir.mkdir(parents=True)
    atomic_write(output_dir / "forecast.csv", forecast)
    atomic_write(output_dir / "metadata.json", metadata_bytes)
    atomic_write(output_dir / "quality.json", quality_bytes)
    atomic_write(output_dir / "reference_map.json", reference)
    snapshot = forecast_api.load_snapshot(output_dir)
    print(
        f"snapshot: {output_dir} version={snapshot.version} rows={len(snapshot.rows)} "
        f"coverage={snapshot.coverage_start}..{snapshot.coverage_end} quality_passed={snapshot.quality_passed}"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the production snapshot bundled with Docker")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output-dir", type=Path, default=Path("service_snapshot"))
    parser.add_argument("--reference-map", type=Path, required=True)
    parser.add_argument("--horizon", choices=("submission", "year"), default="year")
    args = parser.parse_args(argv)
    build(args.data_dir, args.output_dir, args.reference_map, args.horizon)


if __name__ == "__main__":
    main()
