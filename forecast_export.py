import argparse
import calendar
import csv
import hashlib
import json
import math
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import experiments
import pipeline
import reference_map


def horizon_end(start, horizon):
    if horizon == "day":
        return start
    if horizon == "month":
        year, month = start.year + (start.month == 12), start.month % 12 + 1
        return date(year, month, min(start.day, calendar.monthrange(year, month)[1])) - timedelta(days=1)
    if horizon == "year":
        year = start.year + 1
        return date(year, start.month, min(start.day, calendar.monthrange(year, start.month)[1])) - timedelta(days=1)
    if horizon == "submission":
        return pipeline.FUTURE_END
    raise ValueError("horizon must be day, month, year, or submission")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def winner_factory(freeze):
    winner = freeze["finalists"][0]
    if winner.get("kind") != "model" or not winner["name"].startswith("hist_"):
        raise ValueError("freeze winner must be one HistGradientBoosting model")
    parameters = winner.get("config", {}).get("parameters")
    if not isinstance(parameters, dict):
        raise ValueError("freeze winner has no model configuration")

    def factory():
        from sklearn.ensemble import HistGradientBoostingRegressor
        return HistGradientBoostingRegressor(**parameters)

    return winner, factory


def original_scores(results, winner_name):
    runs = {run["name"]: run for run in results.get("runs", [])}
    selected, baseline = runs.get(winner_name), runs.get("baseline")
    if not selected or not baseline:
        raise ValueError("results do not contain frozen winner and baseline")
    records = {}
    for slice_name, _, _, _ in pipeline.SLICES:
        selected_metrics = selected.get("slices", {}).get(slice_name) or selected.get("late_slice", {}).get(slice_name)
        baseline_metrics = baseline.get("slices", {}).get(slice_name) or baseline.get("late_slice", {}).get(slice_name)
        if not selected_metrics or not baseline_metrics:
            raise ValueError(f"results have no original score for {slice_name}")
        records[slice_name] = {
            "selected_wape_score": selected_metrics["wape_score"],
            "selected_absolute_error": selected_metrics["absolute_error"],
            "target_sum": selected_metrics["target_sum"],
            "baseline_wape_score": baseline_metrics["wape_score"],
            "baseline_absolute_error": baseline_metrics["absolute_error"],
        }
    return records


def check_quality(current, original, target_wape_score=0.95, fail=True):
    expected = {item[0] for item in pipeline.SLICES}
    if set(current) != expected or set(original) != expected:
        raise ValueError("quality records must contain every validation slice")
    report = {}
    failures = []
    for name, score in current.items():
        prior = original[name]
        values = (score.get("wape_score"), score.get("absolute_error"), score.get("target_sum"),
                  prior.get("selected_wape_score"), prior.get("baseline_wape_score"))
        if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values) or values[2] <= 0 or values[3] <= 0 or values[4] <= 0:
            raise ValueError(f"{name}: quality scores must be finite and positive")
        value = values[0]
        selected_ratio = value / prior["selected_wape_score"]
        baseline_ratio = value / prior["baseline_wape_score"]
        report[name] = {
            "absolute_error": score["absolute_error"], "target_sum": score["target_sum"], "wape_score": value,
            "target_wape_score": target_wape_score,
            "selected_wape_score": prior["selected_wape_score"], "selected_retention": selected_ratio,
            "baseline_wape_score": prior["baseline_wape_score"], "baseline_retention": baseline_ratio,
        }
        report[name]["passed"] = value >= target_wape_score
        if not report[name]["passed"]:
            failures.append(name)
    if failures and fail:
        raise ValueError(f"{', '.join(failures)}: absolute WAPE-score is below {target_wape_score:.2f}")
    return report


def read_future(path):
    with Path(path).open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if tuple(reader.fieldnames or ()) != pipeline.FUTURE_FIELDS:
            raise ValueError("future.csv has an unexpected schema")
        return [{
            **row, "route": int(row["route"]), "date": date.fromisoformat(row["date"]),
            **{field: int(row[field]) for field in ("hour", *pipeline.CALENDAR_FIELDS)},
        } for row in reader]


def future_rows(start, end):
    calendars = {}
    for year in range(start.year, end.year + 1):
        calendar = json.loads(Path(__file__).with_name(f"calendar_{year}.json").read_text(encoding="utf-8"))
        if calendar.get("year") != year or not calendar.get("sources"):
            raise ValueError(f"calendar_{year}.json is invalid")
        for field in ("holidays", "transferred_days_off", "transferred_workdays", "preholidays"):
            calendar[field] = {date.fromisoformat(value) for value in calendar.get(field, [])}
        calendars[year] = calendar
    rows = []
    for route in pipeline.ROUTES:
        day = start
        while day <= end:
            features = pipeline.calendar_features(day, calendars[day.year])
            rows.extend({"route": route, "date": day, "hour": hour, **features} for hour in range(24))
            day += timedelta(days=1)
    return rows


def write_quality(output_dir, report):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    base = output_dir / "quality.json"
    path = base if not base.exists() else output_dir / f"quality-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def diagnostic_quality(original):
    return check_quality({
        name: {"wape_score": values["selected_wape_score"], "absolute_error": values["selected_absolute_error"],
               "target_sum": values["target_sum"]}
        for name, values in original.items()
    }, original, fail=False)


def publish_snapshot(output_dir, future, predictions, metadata, reference=None):
    from forecast_api import load_snapshot

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    snapshots = output_dir / ".snapshots"
    snapshots.mkdir(exist_ok=True)
    _migrate_legacy_snapshot(output_dir, snapshots)
    with tempfile.TemporaryDirectory(dir=snapshots) as temporary:
        temporary = Path(temporary)
        forecast = temporary / "forecast.csv"
        with forecast.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, delimiter=";", lineterminator="\n")
            writer.writerow(("route", "date", "hour", "prediction"))
            for row, prediction in zip(future, predictions):
                writer.writerow((row["route"], row["date"].isoformat(), row["hour"], prediction))
        digest = sha256(forecast)
        metadata = dict(metadata, forecast_sha256=digest, forecast_version=f"{metadata['winner']}:{digest[:12]}")
        reference_bytes = None
        if reference is not None:
            reference_bytes = (json.dumps(reference, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
            metadata["reference_map_sha256"] = hashlib.sha256(reference_bytes).hexdigest()
        metadata_path = temporary / "metadata.json"
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if reference is not None:
            (temporary / "reference_map.json").write_bytes(reference_bytes)
        load_snapshot(temporary)
        generation = snapshots / _generation_id(forecast, metadata_path, temporary / "reference_map.json")
        if generation.exists():
            load_snapshot(generation)
        else:
            os.replace(temporary, generation)
        _switch_current_snapshot(output_dir, generation)
    return output_dir / "forecast.csv"


def _legacy_paths(output_dir):
    return tuple(output_dir / name for name in ("forecast.csv", "metadata.json"))


def _generation_id(forecast, metadata, reference=None):
    content = Path(forecast).read_bytes() + Path(metadata).read_bytes()
    return hashlib.sha256(content + (Path(reference).read_bytes() if reference and Path(reference).exists() else b"")).hexdigest()


def _switch_current_snapshot(output_dir, generation):
    # Keep old generations: startup resolves current once, so safe cleanup needs reader lifecycle coordination.
    pointer = output_dir / f".current-{generation.name}"
    pointer.unlink(missing_ok=True)
    pointer.symlink_to(Path(".snapshots") / generation.name)
    os.replace(pointer, output_dir / "current")
    for path in _legacy_paths(output_dir):
        link = output_dir / f".{path.name}-{generation.name}"
        link.unlink(missing_ok=True)
        link.symlink_to(Path("current") / path.name)
        os.replace(link, path)


def _migrate_legacy_snapshot(output_dir, snapshots):
    current = output_dir / "current"
    paths = _legacy_paths(output_dir)
    if current.exists() or current.is_symlink():
        if not current.is_symlink():
            raise ValueError("existing snapshot current pointer must be a symlink")
        return
    if any(path.exists() for path in paths) and not all(path.exists() for path in paths):
        raise ValueError("existing snapshot is incomplete")
    if not all(path.exists() for path in paths):
        return
    from forecast_api import load_snapshot

    load_snapshot(output_dir)
    generation = snapshots / _generation_id(*paths)
    if not generation.exists():
        with tempfile.TemporaryDirectory(dir=snapshots) as temporary:
            temporary = Path(temporary)
            for path in paths:
                (temporary / path.name).write_bytes(path.read_bytes())
            load_snapshot(temporary)
            os.replace(temporary, generation)
    _switch_current_snapshot(output_dir, generation)


def export(data_dir, freeze_path, results_path, output_dir, quality_only=False, diagnostic=False, horizon="submission", reference_archive=None):
    data_dir, output_dir = Path(data_dir), Path(output_dir)
    freeze = experiments.load_freeze(freeze_path)
    history_path = data_dir / "history.csv"
    if freeze.get("identity", {}).get("history_sha256") != sha256(history_path):
        raise ValueError("history.csv does not match freeze identity")
    results = json.loads(Path(results_path).read_text(encoding="utf-8"))
    if results.get("freeze_sha256") != freeze["sha256"] or results.get("environment", {}).get("history_sha256") != sha256(history_path):
        raise ValueError("results do not match freeze/data identity")
    winner, factory = winner_factory(freeze)
    history = pipeline.read_history(history_path)
    original = original_scores(results, winner["name"])
    if diagnostic:
        slices = diagnostic_quality(original)
    else:
        current = {}
        for name, cutoff, start, end in pipeline.SLICES:
            train, validation = experiments._slice_rows(history, cutoff, start, end)
            current[name] = experiments._score(validation, experiments._fit_predict(factory, train, validation))
        slices = check_quality(current, original, fail=False)
    quality = {
        "created_at": datetime.now(timezone.utc).isoformat(), "history_sha256": sha256(history_path),
        "freeze_sha256": freeze["sha256"], "winner": winner["name"],
        "target_wape_score": 0.95, "quality_passed": all(item["passed"] for item in slices.values()),
        "serving_mode": "diagnostic" if diagnostic else "production", "slices": slices,
    }
    quality_path = write_quality(output_dir, quality)
    if not diagnostic and not quality["quality_passed"]:
        raise ValueError("absolute WAPE-score is below 0.95; see " + str(quality_path))
    if quality_only:
        return quality_path
    coverage_start, coverage_end = pipeline.FUTURE_START, horizon_end(pipeline.FUTURE_START, horizon)
    submission_end = min(pipeline.FUTURE_END, coverage_end)
    future = future_rows(coverage_start, coverage_end)
    predictions = experiments._fit_predict(factory, history, future)
    reference = reference_map.build(reference_archive) if reference_archive else None
    publish_snapshot(output_dir, future, predictions, {"schema_version": 2, "rows": len(future), "routes": list(pipeline.ROUTES),
                     "coverage": {"start": coverage_start.isoformat(), "end": coverage_end.isoformat()},
                     "submission_coverage": {"start": pipeline.FUTURE_START.isoformat(), "end": submission_end.isoformat()},
                     "horizon": horizon, "accuracy": "unverified beyond fixed 2025 validation slices" if horizon == "year" else "fixed-origin quality gate applies",
                     "winner": winner["name"],
                     "quality_passed": quality["quality_passed"], "serving_mode": quality["serving_mode"],
                     "history_sha256": sha256(history_path), "freeze_sha256": freeze["sha256"], "quality_report": str(quality_path)}, reference)
    return output_dir / "forecast.csv"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate frozen model quality and export the forecast snapshot")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--freeze", type=Path, default=Path("artifacts/macbook-benchmark/freeze.json"))
    parser.add_argument("--results", type=Path, default=Path("artifacts/macbook-benchmark/results.json"))
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--quality-only", action="store_true")
    parser.add_argument("--diagnostic", action="store_true", help="export an explicitly non-production snapshot for HTTP diagnostics")
    parser.add_argument("--horizon", choices=("day", "month", "year", "submission"), default="submission")
    parser.add_argument("--reference-archive", type=Path, default=Path("Archive (1).zip"))
    args = parser.parse_args(argv)
    output_dir = args.output_dir or Path("artifacts/service-diagnostic" if args.diagnostic else "artifacts/service")
    export(args.data_dir, args.freeze, args.results, output_dir, args.quality_only, args.diagnostic, args.horizon, args.reference_archive)


if __name__ == "__main__":
    main()
