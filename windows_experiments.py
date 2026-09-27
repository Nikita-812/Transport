"""Manifest validation, preflight, Windows runner, merge/freeze and export CLI."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pipeline
from models import catalogue_availability, create_candidate, load_candidate, save_candidate


VALID_DEVICES = {"windows", "mac"}
PHASE_ORDER = ("preflight", "screen", "tune", "repeat", "freeze", "final_check", "export")


def utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_manifest(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    required = {"experiment_id", "revision", "start_utc", "deadline_utc", "phases", "devices", "runs"}
    missing = required - set(value)
    if missing:
        raise ValueError(f"manifest missing fields: {sorted(missing)}")
    if utc(value["deadline_utc"]) <= utc(value["start_utc"]):
        raise ValueError("deadline must be after start")
    if set(value["devices"]) - VALID_DEVICES:
        raise ValueError("unknown device")
    names = [p["name"] for p in value["phases"]]
    ends = [p["ends_minute"] for p in value["phases"]]
    if names != list(PHASE_ORDER) or ends != sorted(ends) or ends[-1] != 480:
        raise ValueError("invalid phases")
    run_ids = [r["run_id"] for r in value["runs"]]
    if len(run_ids) != len(set(run_ids)):
        raise ValueError("duplicate run_id")
    for run in value["runs"]:
        if run["device"] not in value["devices"]:
            raise ValueError(f"unknown device for {run['run_id']}")
        if run["phase"] not in names:
            raise ValueError(f"unknown phase for {run['run_id']}")
    value["manifest_hash"] = canonical_hash({k: v for k, v in value.items() if k != "manifest_hash"})
    return value


def random_search_configs(seed=42, count=12):
    """Finite, reproducible, duplicate-free tuning queue."""
    randomizer = random.Random(seed)
    space = []
    for depth in (4, 6, 8):
        for rate in (.03, .1):
            for estimators in (300, 500):
                space.append({"kind": "xgboost", "max_depth": depth, "learning_rate": rate, "n_estimators": estimators, "objective": "reg:absoluteerror"})
    for depth in (8, 16):
        for estimators in (100, 300):
            space.append({"kind": "extra_trees", "max_depth": depth, "n_estimators": estimators})
            space.append({"kind": "random_forest", "max_depth": depth, "n_estimators": estimators})
    for loss in ("absolute_error", "poisson"):
        for iterations in (300, 500):
            space.append({"kind": "hist_gradient_boosting", "loss": loss, "max_iter": iterations})
    randomizer.shuffle(space)
    return space[:min(count, len(space))]


def environment_inventory():
    ram = None
    try:
        import psutil
        ram = psutil.virtual_memory().total
    except ImportError:
        pass
    gpu = None
    try:
        query = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        gpu = query.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        pass
    return {
        "os": platform.platform(), "python": sys.version.split()[0], "cpu": platform.processor(),
        "logical_cpu": os.cpu_count(), "ram_bytes": ram, "gpu": gpu,
        "catalogue": catalogue_availability(),
    }


def validate_grid(path, expected_fields, expected_count):
    with Path(path).open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != list(expected_fields):
            raise ValueError(f"{path}: unexpected schema")
        keys = set()
        for line, row in enumerate(reader, 2):
            key = (int(row["route"]), date.fromisoformat(row["date"]), int(row["hour"]))
            if key in keys:
                raise ValueError(f"{path}:{line}: duplicate key")
            keys.add(key)
    if len(keys) != expected_count:
        raise ValueError(f"{path}: expected {expected_count} keys, got {len(keys)}")
    return keys


def preflight(manifest_path, data_dir, report_path):
    manifest = load_manifest(manifest_path); data_dir = Path(data_dir)
    history = data_dir / "history.csv"; future = data_dir / "future.csv"
    validate_grid(history, pipeline.HISTORY_FIELDS, 72_960)
    validate_grid(future, pipeline.FUTURE_FIELDS, 14_640)
    calendar = Path(__file__).with_name("calendar_2025.json")
    git_commit = None
    try:
        git_commit = subprocess.run(["git", "-c", f"safe.directory={Path.cwd().as_posix()}", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    hashes = {"history": file_hash(history), "future": file_hash(future), "calendar": file_hash(calendar)}
    expected_hashes = manifest.get("data_hashes")
    if expected_hashes and hashes != expected_hashes:
        mismatches = sorted(key for key in hashes if hashes.get(key) != expected_hashes.get(key))
        raise ValueError(f"input hash mismatch: {mismatches}")
    report = {
        "status": "ready", "checked_at": datetime.now(timezone.utc).isoformat(),
        "experiment_id": manifest["experiment_id"], "revision": manifest["revision"],
        "manifest_hash": manifest["manifest_hash"], "git_commit": git_commit,
        "hashes": hashes,
        "rows": {"history": 72_960, "future": 14_640}, "environment": environment_inventory(),
    }
    atomic_json(report_path, report)
    return report


def _rows_for_slice(rows, name):
    for slice_name, cutoff, start, end in pipeline.SLICES:
        if slice_name == name:
            return cutoff, [r for r in rows if r["date"] <= cutoff], [r for r in rows if start <= r["date"] <= end]
    raise ValueError(f"unknown slice: {name}")


def execute_run(run, data_dir, output_dir, identity):
    started = datetime.now(timezone.utc); process_started = time.perf_counter()
    rows = pipeline.read_history(Path(data_dir) / "history.csv")
    attempt_id = f"attempt-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    target = Path(output_dir) / run["run_id"] / attempt_id
    result = {**identity, "run_id": run["run_id"], "attempt_id": attempt_id, "config": run,
              "status": "running", "started_at": started.isoformat()}
    atomic_json(target / "result.json", result)
    predictions = []
    metrics = {}
    try:
        for slice_name in run["slices"]:
            cutoff, train, validation = _rows_for_slice(rows, slice_name)
            candidate = create_candidate(run["parameters"], run["backend"], run["seed"])
            candidate.fit(train)
            values = candidate.predict(validation)
            evaluated = []
            for row, value in zip(validation, values):
                item = dict(row, prediction=max(0.0, float(value))); evaluated.append(item)
                predictions.append({"run_id": run["run_id"], "cutoff": cutoff.isoformat(), "route": row["route"],
                                    "date": row["date"].isoformat(), "hour": row["hour"], "prediction": item["prediction"]})
            metrics[slice_name] = pipeline.build_metrics(evaluated)
        fields = ("run_id", "cutoff", "route", "date", "hour", "prediction")
        target.mkdir(parents=True, exist_ok=True)
        temporary = target / "predictions.csv.tmp"
        pipeline._write_csv(temporary, fields, predictions); os.replace(temporary, target / "predictions.csv")
        elapsed = time.perf_counter() - process_started
        result.update({"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat(),
                       "elapsed_seconds": elapsed, "metrics": metrics, "prediction_rows": len(predictions),
                       "resources": {"peak_rss_bytes": _peak_rss(), "vram_peak_bytes": None, "vram_reason": "not sampled by worker"}})
    except Exception as error:
        result.update({"status": "failed", "completed_at": datetime.now(timezone.utc).isoformat(),
                       "elapsed_seconds": time.perf_counter() - process_started,
                       "error": {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}})
    atomic_json(target / "result.json", result)
    return result


def _peak_rss():
    try:
        import psutil
        process = psutil.Process(); return process.memory_info().peak_wset if hasattr(process.memory_info(), "peak_wset") else process.memory_info().rss
    except ImportError:
        return None


def run_manifest(manifest_path, data_dir, output_dir, device, phase=None, ignore_deadline=False):
    manifest = load_manifest(manifest_path)
    if device not in VALID_DEVICES:
        raise ValueError("unknown device")
    now = datetime.now(timezone.utc)
    if now >= utc(manifest["deadline_utc"]) and not ignore_deadline:
        raise RuntimeError("campaign deadline has passed")
    identity = {"experiment_id": manifest["experiment_id"], "revision": manifest["revision"], "manifest_hash": manifest["manifest_hash"],
                "data_hashes": manifest.get("data_hashes", {})}
    completed = []
    for run in manifest["runs"]:
        if run["device"] != device or (phase and run["phase"] != phase):
            continue
        previous = list(Path(output_dir).glob(f"{run['run_id']}/*/result.json"))
        if any(json.loads(p.read_text(encoding="utf-8")).get("status") == "completed" and
               (p.parent / "predictions.csv").is_file() for p in previous):
            continue
        completed.append(execute_run(run, data_dir, output_dir, identity))
    return completed


def merge_results(manifest_path, result_roots, output):
    manifest = load_manifest(manifest_path); accepted = {}; incomplete = []
    for root in result_roots:
        for path in Path(root).glob("*/*/result.json"):
            item = json.loads(path.read_text(encoding="utf-8")); key = (item["run_id"], item["attempt_id"])
            compatible_revision = int(item.get("revision", -1)) <= int(manifest["revision"])
            compatible_data = item.get("data_hashes", {}) == manifest.get("data_hashes", {})
            if item.get("experiment_id") != manifest["experiment_id"] or not compatible_revision or not compatible_data:
                raise ValueError(f"incompatible result: {path}")
            digest = canonical_hash(item)
            if key in accepted and accepted[key]["digest"] != digest:
                raise ValueError(f"conflicting duplicate: {key}")
            accepted[key] = {"digest": digest, "result": item, "path": str(path)}
    ranked = []
    for entry in accepted.values():
        item = entry["result"]
        if item.get("status") != "completed" or set(item.get("metrics", {})) != {"may-june", "july-august"}:
            incomplete.append(item); continue
        totals = [m["overall"] for m in item["metrics"].values()]
        score = sum(m["absolute_error"] for m in totals) / sum(m["target_sum"] for m in totals)
        ranked.append({"run_id": item["run_id"], "attempt_id": item["attempt_id"], "wape": score,
                       "elapsed_seconds": item["elapsed_seconds"], "path": entry["path"], "config": item["config"]})
    ranked.sort(key=lambda x: (x["wape"], x["run_id"])); report = {"ranked": ranked, "incomplete": incomplete, "accepted": len(accepted)}
    atomic_json(output, report); return report


def freeze(merge_path, output, finalists=3, ensembles_path=None):
    merge = json.loads(Path(merge_path).read_text(encoding="utf-8"))
    if not merge["ranked"]:
        raise ValueError("no complete configurations to freeze")
    chosen = merge["ranked"][0]
    selection_config = {"type": "single", "component": chosen}
    selected = chosen["run_id"]
    if ensembles_path:
        ensembles = json.loads(Path(ensembles_path).read_text(encoding="utf-8")); best = ensembles.get("best_ensemble")
        if best and best["wape"] < chosen["wape"]:
            left = next(item for item in merge["ranked"] if item["run_id"] == best["left"])
            right = next(item for item in merge["ranked"] if item["run_id"] == best["right"])
            selection_config = {"type": "ensemble", "left": left, "right": right, "left_weight": best["left_weight"], "early_wape": best["wape"]}
            selected = f"ensemble:{best['left']}:{best['right']}:{best['left_weight']}"
    body = {"created_at": datetime.now(timezone.utc).isoformat(), "finalists": merge["ranked"][:finalists],
            "selected": selected, "selection_config": selection_config, "seeds": [42, 43, 44], "ensemble_weights": [0.25, 0.5, 0.75]}
    body["sha256"] = canonical_hash(body); atomic_json(output, body); return body


def validate_freeze(path):
    value = json.loads(Path(path).read_text(encoding="utf-8")); supplied = value.pop("sha256", None)
    if supplied != canonical_hash(value):
        raise ValueError("freeze hash mismatch")
    value["sha256"] = supplied; return value


def analyse_ensembles(merge_path, data_dir, output, top=4):
    merge = json.loads(Path(merge_path).read_text(encoding="utf-8")); leaders = merge["ranked"][:top]
    history = pipeline.read_history(Path(data_dir) / "history.csv")
    targets = {(r["date"], r["route"], r["hour"]): float(r["boardings"]) for r in history}
    forecasts = {}
    for item in leaders:
        path = Path(item["path"]).parent / "predictions.csv"; values = {}
        with path.open(newline="", encoding="utf-8") as stream:
            for row in csv.DictReader(stream, delimiter=";"):
                key = (date.fromisoformat(row["date"]), int(row["route"]), int(row["hour"]))
                values[key] = float(row["prediction"])
        forecasts[item["run_id"]] = values
    candidates = []
    for left_index, left in enumerate(leaders):
        for right in leaders[left_index + 1:]:
            common = set(forecasts[left["run_id"]]) & set(forecasts[right["run_id"]])
            for weight in (.25, .5, .75):
                error = sum(abs(targets[key] - (weight * forecasts[left["run_id"]][key] + (1-weight) * forecasts[right["run_id"]][key])) for key in common)
                target = sum(targets[key] for key in common)
                candidates.append({"left": left["run_id"], "right": right["run_id"], "left_weight": weight,
                                   "wape": error / target, "rows": len(common)})
    candidates.sort(key=lambda x: (x["wape"], x["left"], x["right"], x["left_weight"]))
    report = {"leaders": [x["run_id"] for x in leaders], "ensembles": candidates,
              "best_single_wape": leaders[0]["wape"], "best_ensemble": candidates[0] if candidates else None}
    atomic_json(output, report); return report


def final_check(freeze_path, data_dir, output):
    frozen = validate_freeze(freeze_path)
    rows = pipeline.read_history(Path(data_dir) / "history.csv")
    cutoff, train, validation = _rows_for_slice(rows, "september-october")
    selection = frozen["selection_config"]
    if selection["type"] == "single":
        config = selection["component"]["config"]; candidate = create_candidate(config["parameters"], config["backend"], config["seed"])
        candidate.fit(train); values = candidate.predict(validation)
    else:
        left, right, weight = selection["left"]["config"], selection["right"]["config"], selection["left_weight"]
        left_model = create_candidate(left["parameters"], left["backend"], left["seed"]); left_model.fit(train)
        right_model = create_candidate(right["parameters"], right["backend"], right["seed"]); right_model.fit(train)
        values = [weight*a + (1-weight)*b for a, b in zip(left_model.predict(validation), right_model.predict(validation))]
    evaluated = [dict(row, prediction=max(0.0, float(value))) for row, value in zip(validation, values)]
    baseline = create_candidate({"kind": "seasonal"}); baseline.fit(train)
    baseline_rows = [dict(row, prediction=value) for row, value in zip(validation, baseline.predict(validation))]
    selected_metrics = pipeline.build_metrics(evaluated); baseline_metrics = pipeline.build_metrics(baseline_rows)
    report = {"freeze_sha256": frozen["sha256"], "selected": frozen["selected"], "selection_changed": False,
              "note": "September-October was previously examined in EDA; no retuning performed.",
              "metrics": selected_metrics, "baseline_metrics": baseline_metrics,
              "degraded_vs_baseline": selected_metrics["overall"]["wape"] > baseline_metrics["overall"]["wape"]}
    atomic_json(output, report); return report


def export_frozen(freeze_path, data_dir, output, bundle_path):
    frozen = validate_freeze(freeze_path)
    rows = pipeline.read_history(Path(data_dir) / "history.csv")
    with (Path(data_dir) / "future.csv").open(newline="", encoding="utf-8") as stream:
        future = [{**r, "route": int(r["route"]), "date": date.fromisoformat(r["date"]), "hour": int(r["hour"]),
                   **{f: int(r[f]) for f in pipeline.CALENDAR_FIELDS}} for r in csv.DictReader(stream, delimiter=";")]
    selection = frozen["selection_config"]
    if selection["type"] == "single":
        config = selection["component"]["config"]; candidate = create_candidate(config["parameters"], config["backend"], 42)
        candidate.fit(rows); values = candidate.predict(future); bundle_object = candidate
    else:
        left, right, weight = selection["left"]["config"], selection["right"]["config"], selection["left_weight"]
        left_model = create_candidate(left["parameters"], left["backend"], 42); left_model.fit(rows)
        right_model = create_candidate(right["parameters"], right["backend"], 42); right_model.fit(rows)
        values = [weight*a + (1-weight)*b for a, b in zip(left_model.predict(future), right_model.predict(future))]
        bundle_object = {"left": left_model, "right": right_model, "left_weight": weight}
    verification = values[:240]
    save_candidate(bundle_object, bundle_path, {"selection": selection, "cutoff": "2025-10-31", "freeze_sha256": frozen["sha256"],
                                                "verification": verification})
    loaded = load_candidate(bundle_path)["candidate"]
    if isinstance(loaded, dict):
        repeated = [loaded["left_weight"]*a + (1-loaded["left_weight"])*b for a,b in zip(loaded["left"].predict(future[:240]), loaded["right"].predict(future[:240]))]
    else:
        repeated = loaded.predict(future[:240])
    for left, right in zip(verification, repeated):
        if abs(left - right) > 1e-6 + 1e-5 * abs(left):
            raise ValueError("artifact round trip mismatch")
    export_rows = [{"route": r["route"], "date": r["date"].isoformat(), "hour": r["hour"], "prediction": max(0.0, float(v))} for r, v in zip(future, values)]
    output = Path(output); output.parent.mkdir(parents=True, exist_ok=True); temporary = output.with_suffix(output.suffix + ".tmp")
    pipeline._write_csv(temporary, ("route", "date", "hour", "prediction"), export_rows); os.replace(temporary, output)
    return {"rows": len(export_rows), "sha256": file_hash(output), "bundle_sha256": file_hash(bundle_path), "selected": frozen["selected"]}


def export_predictions(data_dir, output, kind="seasonal", weeks=8):
    rows = pipeline.read_history(Path(data_dir) / "history.csv")
    with (Path(data_dir) / "future.csv").open(newline="", encoding="utf-8") as stream:
        future = []
        for row in csv.DictReader(stream, delimiter=";"):
            future.append({**row, "route": int(row["route"]), "date": date.fromisoformat(row["date"]), "hour": int(row["hour"]),
                           **{f: int(row[f]) for f in pipeline.CALENDAR_FIELDS}})
    candidate = create_candidate({"kind": kind, "weeks": weeks}); candidate.fit(rows); values = candidate.predict(future)
    export_rows = [{"route": r["route"], "date": r["date"].isoformat(), "hour": r["hour"], "prediction": max(0.0, float(v))} for r, v in zip(future, values)]
    if len(export_rows) != 14_640 or len({(r["route"], r["date"], r["hour"]) for r in export_rows}) != 14_640:
        raise ValueError("invalid export grid")
    output = Path(output); output.parent.mkdir(parents=True, exist_ok=True); temporary = output.with_suffix(output.suffix + ".tmp")
    pipeline._write_csv(temporary, ("route", "date", "hour", "prediction"), export_rows); os.replace(temporary, output)
    return {"rows": len(export_rows), "sha256": file_hash(output), "model": kind}


def main(argv=None):
    parser = argparse.ArgumentParser(); commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("validate-manifest"); p.add_argument("--manifest", type=Path, required=True)
    p = commands.add_parser("preflight"); p.add_argument("--manifest", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--report", type=Path, required=True)
    p = commands.add_parser("run"); p.add_argument("--manifest", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output-dir", type=Path, required=True); p.add_argument("--device", choices=sorted(VALID_DEVICES), required=True); p.add_argument("--phase"); p.add_argument("--ignore-deadline", action="store_true")
    p = commands.add_parser("merge"); p.add_argument("--manifest", type=Path, required=True); p.add_argument("--results", type=Path, nargs="+", required=True); p.add_argument("--output", type=Path, required=True)
    p = commands.add_parser("freeze"); p.add_argument("--merge", type=Path, required=True); p.add_argument("--output", type=Path, required=True); p.add_argument("--ensembles", type=Path)
    p = commands.add_parser("ensembles"); p.add_argument("--merge", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output", type=Path, required=True)
    p = commands.add_parser("final-check"); p.add_argument("--freeze", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output", type=Path, required=True)
    p = commands.add_parser("export-frozen"); p.add_argument("--freeze", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output", type=Path, required=True); p.add_argument("--bundle", type=Path, required=True)
    p = commands.add_parser("export"); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output", type=Path, required=True); p.add_argument("--kind", default="seasonal"); p.add_argument("--weeks", type=int, default=8)
    args = parser.parse_args(argv)
    if args.command == "validate-manifest": result = load_manifest(args.manifest)
    elif args.command == "preflight": result = preflight(args.manifest, args.data_dir, args.report)
    elif args.command == "run": result = run_manifest(args.manifest, args.data_dir, args.output_dir, args.device, args.phase, args.ignore_deadline)
    elif args.command == "merge": result = merge_results(args.manifest, args.results, args.output)
    elif args.command == "freeze": result = freeze(args.merge, args.output, ensembles_path=args.ensembles)
    elif args.command == "ensembles": result = analyse_ensembles(args.merge, args.data_dir, args.output)
    elif args.command == "final-check": result = final_check(args.freeze, args.data_dir, args.output)
    elif args.command == "export-frozen": result = export_frozen(args.freeze, args.data_dir, args.output, args.bundle)
    else: result = export_predictions(args.data_dir, args.output, args.kind, args.weeks)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
