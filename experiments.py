import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import pickle
import platform
import subprocess
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

import pipeline


os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")


EARLY_SLICES = pipeline.SLICES[:2]
LATE_SLICE = pipeline.SLICES[2]
ROUTE_INDEX = {route: index for index, route in enumerate(pipeline.ROUTES)}


def feature_matrix(rows):
    import numpy as np

    origin = date(2025, 1, 1)
    return np.asarray([
        [
            ROUTE_INDEX[row["route"]], row["weekday"], row["hour"], row["month"],
            row["is_weekend"], row["is_holiday"], row["is_workday"], row["is_preholiday"],
            (row["date"] - origin).days,
        ]
        for row in rows
    ], dtype=float)


def validate_predictions(values):
    result = [float(value) for value in values]
    if not all(math.isfinite(value) for value in result):
        raise ValueError("predictions must be finite")
    return [max(0.0, value) for value in result]


def combined_score(error_target_pairs):
    pairs = list(error_target_pairs)
    target = sum(item[1] for item in pairs)
    return 1.0 - sum(item[0] for item in pairs) / target if target else None


def _linear_model(model):
    from sklearn.compose import ColumnTransformer
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder

    features = ColumnTransformer([
        ("categorical", OneHotEncoder(handle_unknown="ignore"), list(range(8))),
        ("ordinal", "passthrough", [8]),
    ])
    return make_pipeline(features, model)


class SeasonalWindowRegressor:
    def __init__(self, days=None, statistic="mean", half_life=None):
        self.days = days
        self.statistic = statistic
        self.half_life = half_life

    def fit(self, features, targets):
        cutoff = max(row[8] for row in features)
        groups = (defaultdict(list), defaultdict(list), defaultdict(list))
        for row, target in zip(features, targets):
            age = cutoff - row[8]
            if self.days is not None and age >= self.days:
                continue
            keys = ((int(row[0]), int(row[1]), int(row[2])), (int(row[0]), int(row[2])), int(row[0]))
            for group, key in zip(groups, keys):
                group[key].append((float(target), age))
        self.levels = []
        for group in groups:
            level = {}
            for key, values in group.items():
                if self.statistic == "median":
                    level[key] = median(value for value, _ in values)
                elif self.half_life:
                    weights = [0.5 ** (age / self.half_life) for _, age in values]
                    level[key] = sum(value * weight for (value, _), weight in zip(values, weights)) / sum(weights)
                else:
                    level[key] = sum(value for value, _ in values) / len(values)
            self.levels.append(level)
        return self

    def predict(self, features):
        values = []
        for row in features:
            route, weekday, hour = int(row[0]), int(row[1]), int(row[2])
            value = self.levels[0].get(
                (route, weekday, hour), self.levels[1].get((route, hour), self.levels[2].get(route, 0.0))
            )
            values.append(value)
        return values

    def get_params(self, deep=True):
        return {"days": self.days, "statistic": self.statistic, "half_life": self.half_life}


def smoke_model_catalog():
    from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import PoissonRegressor, Ridge

    categorical = list(range(8))
    return {
        "ridge": lambda: _linear_model(Ridge(alpha=10.0)),
        "poisson": lambda: _linear_model(PoissonRegressor(alpha=1.0, solver="newton-cholesky", max_iter=100)),
        "extra_trees": lambda: ExtraTreesRegressor(n_estimators=10, max_depth=8, min_samples_leaf=2, n_jobs=1, random_state=42),
        "random_forest": lambda: RandomForestRegressor(n_estimators=10, max_depth=8, min_samples_leaf=2, n_jobs=1, random_state=42),
        "hist_gradient_boosting": lambda: HistGradientBoostingRegressor(
            loss="absolute_error", max_iter=10, max_depth=4, learning_rate=0.1,
            l2_regularization=1.0, categorical_features=categorical, early_stopping=False, random_state=42,
        ),
    }


def benchmark_model_catalog():
    from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import PoissonRegressor, Ridge

    models = {}
    for weeks in (4, 8, 12):
        models[f"seasonal_mean_{weeks}w"] = lambda weeks=weeks: SeasonalWindowRegressor(days=7 * weeks)
        models[f"seasonal_median_{weeks}w"] = lambda weeks=weeks: SeasonalWindowRegressor(days=7 * weeks, statistic="median")
    for half_life in (14, 28, 56):
        models[f"seasonal_decay_halflife_{half_life}d"] = lambda half_life=half_life: SeasonalWindowRegressor(half_life=half_life)
    for alpha in (0.1, 1.0, 10.0, 100.0):
        models[f"ridge_alpha_{alpha:g}"] = lambda alpha=alpha: _linear_model(Ridge(alpha=alpha))
    for alpha in (0.1, 1.0):
        models[f"poisson_alpha_{alpha:g}"] = lambda alpha=alpha: _linear_model(
            PoissonRegressor(alpha=alpha, solver="newton-cholesky", max_iter=100)
        )
    for depth in (8, 16):
        models[f"extra_trees_depth_{depth}"] = lambda depth=depth: ExtraTreesRegressor(
            n_estimators=300, max_depth=depth, min_samples_leaf=2, n_jobs=1, random_state=42
        )
        models[f"random_forest_depth_{depth}"] = lambda depth=depth: RandomForestRegressor(
            n_estimators=300, max_depth=depth, min_samples_leaf=2, n_jobs=1, random_state=42
        )
    categorical = list(range(8))
    for loss in ("absolute_error", "poisson"):
        for depth in (4, 6, 8):
            for learning_rate, iterations in ((0.03, 500), (0.1, 100), (0.1, 300)):
                name = f"hist_{loss}_depth_{depth}_lr_{learning_rate:g}_iter_{iterations}"
                models[name] = lambda loss=loss, depth=depth, learning_rate=learning_rate, iterations=iterations: HistGradientBoostingRegressor(
                    loss=loss, max_iter=iterations, max_depth=depth, learning_rate=learning_rate,
                    l2_regularization=1.0, categorical_features=categorical, early_stopping=False, random_state=42,
                )
    return models


def _slice_rows(rows, cutoff, start, end):
    return [row for row in rows if row["date"] <= cutoff], [row for row in rows if start <= row["date"] <= end]


def _score(actual_rows, predictions):
    predictions = validate_predictions(predictions)
    if len(actual_rows) != len(predictions):
        raise ValueError(f"prediction count {len(predictions)} does not match target count {len(actual_rows)}")
    error = sum(abs(row["boardings"] - prediction) for row, prediction in zip(actual_rows, predictions))
    target = sum(row["boardings"] for row in actual_rows)
    return {"absolute_error": error, "target_sum": target, "wape_score": 1.0 - error / target if target else None}


def _fit_predict(factory, train, validation):
    model = factory()
    model.fit(feature_matrix(train), [row["boardings"] for row in train])
    predictions = validate_predictions(model.predict(feature_matrix(validation)))
    pickle.loads(pickle.dumps(model)).predict(feature_matrix(validation[:1]))
    totals = defaultdict(int)
    for row in train:
        totals[row["route"]] += row["boardings"]
    return [0.0 if totals[row["route"]] == 0 else value for row, value in zip(validation, predictions)]


def _jsonable(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return repr(value)


def _model_config(factory):
    model = factory()
    return {"class": f"{type(model).__module__}.{type(model).__name__}", "parameters": _jsonable(model.get_params(deep=True))}


def _content_hash(payload):
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write_freeze(path, finalists, identity):
    path = Path(path)
    payload = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "identity": identity,
        "finalists": [{key: item[key] for key in ("name", "early_wape_score", "kind", "config", "components", "weight") if key in item} for item in finalists],
    }
    payload["sha256"] = _content_hash(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return payload


def load_freeze(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    signature = payload.pop("sha256", None)
    if signature != _content_hash(payload):
        raise ValueError("freeze hash mismatch")
    payload["sha256"] = signature
    return payload


def _evaluate_factory(name, factory, rows, slices):
    started = time.perf_counter()
    slice_results = {}
    predictions = {}
    for slice_name, cutoff, start, end in slices:
        train, validation = _slice_rows(rows, cutoff, start, end)
        values = _fit_predict(factory, train, validation)
        predictions[slice_name] = values
        slice_results[slice_name] = _score(validation, values)
    return {
        "name": name,
        "kind": "model",
        "config": _model_config(factory),
        "seconds": time.perf_counter() - started,
        "slices": slice_results,
        "early_wape_score": combined_score((item["absolute_error"], item["target_sum"]) for item in slice_results.values()),
    }, predictions


def _evaluate_baseline(rows, slices):
    started = time.perf_counter()
    result = {"name": "baseline", "kind": "baseline", "config": {"function": "pipeline.fit_seasonal"}, "slices": {}}
    predictions = {}
    for slice_name, cutoff, start, end in slices:
        train, validation = _slice_rows(rows, cutoff, start, end)
        model = pipeline.fit_seasonal(train)
        values = [pipeline.predict_seasonal(model, row["route"], row["weekday"], row["hour"]) for row in validation]
        predictions[slice_name] = values
        result["slices"][slice_name] = _score(validation, values)
    result["early_wape_score"] = combined_score(
        (item["absolute_error"], item["target_sum"]) for item in result["slices"].values()
    )
    result["seconds"] = time.perf_counter() - started
    return result, predictions


def _ensembles(runs, prediction_sets, rows):
    leaders = sorted((run for run in runs if run["kind"] == "model"), key=lambda item: item["early_wape_score"], reverse=True)[:4]
    validation = {name: _slice_rows(rows, cutoff, start, end)[1] for name, cutoff, start, end in EARLY_SLICES}
    result = []
    for left_index, left in enumerate(leaders):
        for right in leaders[left_index + 1:]:
            for weight in (0.25, 0.5, 0.75):
                name = f"ensemble_{weight:g}_{left['name']}__{1-weight:g}_{right['name']}"
                slices = {}
                predictions = {}
                for slice_name, *_ in EARLY_SLICES:
                    values = [
                        weight * a + (1.0 - weight) * b
                        for a, b in zip(prediction_sets[left["name"]][slice_name], prediction_sets[right["name"]][slice_name])
                    ]
                    predictions[slice_name] = values
                    slices[slice_name] = _score(validation[slice_name], values)
                run = {
                    "name": name, "kind": "ensemble", "seconds": None, "weight": weight,
                    "components": [left["name"], right["name"]], "slices": slices,
                    "config": {"weight": weight, "components": [left["name"], right["name"]]},
                    "early_wape_score": combined_score((item["absolute_error"], item["target_sum"]) for item in slices.values()),
                }
                result.append((run, predictions))
    return result


def _late_score(run, catalog, rows, cache):
    slice_name, cutoff, start, end = LATE_SLICE
    train, validation = _slice_rows(rows, cutoff, start, end)
    if run["kind"] == "baseline":
        model = pipeline.fit_seasonal(train)
        values = [pipeline.predict_seasonal(model, row["route"], row["weekday"], row["hour"]) for row in validation]
    elif run["kind"] == "model":
        if run["name"] not in cache:
            cache[run["name"]] = _fit_predict(catalog[run["name"]], train, validation)
        values = cache[run["name"]]
    else:
        left, right = run["components"]
        if left not in cache:
            cache[left] = _fit_predict(catalog[left], train, validation)
        if right not in cache:
            cache[right] = _fit_predict(catalog[right], train, validation)
        a, b = cache[left], cache[right]
        values = [run["weight"] * x + (1.0 - run["weight"]) * y for x, y in zip(a, b)]
    score = _score(validation, values)
    run["late_slice"] = {slice_name: score}
    run["late_wape_score"] = score["wape_score"]
    return values


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _environment(data_dir):
    import numpy
    import psutil
    import sklearn

    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    return {
        "python": sys.version.split()[0], "numpy": numpy.__version__, "scikit_learn": sklearn.__version__,
        "os": platform.platform(), "cpu": platform.processor() or platform.machine(),
        "logical_cpus": os.cpu_count(), "ram_bytes": psutil.virtual_memory().total, "git_commit": commit,
        "history_sha256": _sha256(Path(data_dir) / "history.csv"),
        "source_sha256": {name: _sha256(Path(__file__).with_name(name)) for name in ("experiments.py", "pipeline.py")},
    }


def _write_predictions(path, selected, prediction_sets, rows):
    path = Path(path)
    with gzip.GzipFile(filename=path, mode="wb", mtime=0) as compressed, io.TextIOWrapper(compressed, encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter=";", lineterminator="\n")
        writer.writerow(("run", "slice", "route", "date", "hour", "target", "prediction"))
        slices = (*EARLY_SLICES, LATE_SLICE)
        for run in selected:
            for slice_name, cutoff, start, end in slices:
                validation = _slice_rows(rows, cutoff, start, end)[1]
                values = prediction_sets[run["name"]][slice_name]
                for row, value in zip(validation, values):
                    writer.writerow((run["name"], slice_name, row["route"], row["date"].isoformat(), row["hour"], row["boardings"], value))
    return _sha256(path)


def render_summary(report):
    runs = sorted(report["runs"], key=lambda item: item["early_wape_score"] if item["early_wape_score"] is not None else -math.inf, reverse=True)
    shown = runs[:5]
    baseline = next((run for run in runs if run["name"] == "baseline"), None)
    if baseline and baseline not in shown:
        shown.append(baseline)
    lines = [
        "# MacBook model benchmark", "",
        "Отбор выполнен по объединённым срезам май–июнь и июль–август. Сентябрь–октябрь открыт только после freeze, уже изучался в EDA и не является независимым holdout.", "",
        "| run | May–Jun | Jul–Aug | early combined | Sep–Oct late | vs baseline early | early fit+predict seconds |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    baseline_score = baseline["early_wape_score"] if baseline else None
    for run in shown:
        late = run.get("late_wape_score")
        early = run["early_wape_score"]
        delta = early - baseline_score if early is not None and baseline_score is not None else None
        may_june = run.get("slices", {}).get("may-june", {}).get("wape_score")
        july_august = run.get("slices", {}).get("july-august", {}).get("wape_score")
        seconds = run.get("seconds")
        lines.append(
            f"| {run['name']} | {'—' if may_june is None else f'{may_june:.5f}'} | "
            f"{'—' if july_august is None else f'{july_august:.5f}'} | {'—' if early is None else f'{early:.5f}'} | "
            f"{'—' if late is None else f'{late:.5f}'} | "
            f"{'—' if delta is None else f'{delta:+.5f}'} | "
            f"{'—' if seconds is None else f'{seconds:.2f}'} |"
        )
    best = runs[0] if runs else None
    if best and baseline and best.get("late_wape_score") is not None and baseline.get("late_wape_score") is not None:
        comparison = "ниже" if best["late_wape_score"] < baseline["late_wape_score"] else "выше"
        lines.extend([
            "",
            f"Поздний WAPE-score выбранного по ранним срезам лидера {comparison} baseline: "
            f"`{best['late_wape_score']:.5f}` против `{baseline['late_wape_score']:.5f}`; выбор после late-среза не менялся.",
        ])
    best_model = next((run for run in runs if run.get("kind") == "model"), None)
    if best and best_model and best.get("kind") == "ensemble":
        lines.append(
            f"Преимущество ансамбля над лучшей одиночной моделью на ранних срезах: "
            f"`{best['early_wape_score'] - best_model['early_wape_score']:+.5f}`; повторы seed 43/44 не выполнялись, устойчивость не подтверждена."
        )
    lines.extend([
        "",
        "Покрытие ограничено MacBook CPU: LightGBM не установлен, Windows/GPU, полный восьмичасовой поиск и seed-повторы не выполнялись.",
        "",
        f"Freeze: `{report.get('freeze_path', 'freeze.json')}`. Прогнозы финалистов: `{report.get('predictions_path', 'finalist-predictions.csv.gz')}`. Полный отчёт: `{report.get('json_path', 'results.json')}`.", "",
    ])
    return "\n".join(lines)


def benchmark(data_dir, output_dir, summary_path=None):
    os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 1))
    rows = pipeline.read_history(Path(data_dir) / "history.csv")
    catalog = benchmark_model_catalog()
    started = datetime.now(timezone.utc)
    environment = _environment(data_dir)
    baseline, baseline_predictions = _evaluate_baseline(rows, EARLY_SLICES)
    runs = [baseline]
    prediction_sets = {"baseline": baseline_predictions}
    for name, factory in catalog.items():
        run, predictions = _evaluate_factory(name, factory, rows, EARLY_SLICES)
        runs.append(run)
        prediction_sets[name] = predictions
    for run, predictions in _ensembles(runs, prediction_sets, rows):
        runs.append(run)
        prediction_sets[run["name"]] = predictions

    finalists = sorted((run for run in runs if run["name"] != "baseline"), key=lambda item: item["early_wape_score"], reverse=True)[:5]
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    freeze_path = output_dir / "freeze.json"
    write_freeze(freeze_path, finalists, {
        "history_sha256": environment["history_sha256"], "git_commit": environment["git_commit"],
        "selection_slices": [item[0] for item in EARLY_SLICES],
    })
    frozen = load_freeze(freeze_path)
    if [item["name"] for item in frozen["finalists"]] != [item["name"] for item in finalists]:
        raise ValueError("frozen finalist selection changed")
    late_cache = {}
    selected = [baseline, *finalists]
    for run in selected:
        prediction_sets[run["name"]][LATE_SLICE[0]] = _late_score(run, catalog, rows, late_cache)
    runs.sort(key=lambda item: item["early_wape_score"], reverse=True)

    predictions_path = output_dir / "finalist-predictions.csv.gz"
    predictions_sha256 = _write_predictions(predictions_path, selected, prediction_sets, rows)

    report = {
        "protocol": "MacBook CPU fixed-origin benchmark",
        "selection_slices": [item[0] for item in EARLY_SLICES],
        "late_slice": LATE_SLICE[0],
        "started_at": started.isoformat(), "finished_at": datetime.now(timezone.utc).isoformat(),
        "environment": environment, "freeze_path": str(freeze_path), "freeze_sha256": frozen["sha256"],
        "predictions_path": str(predictions_path), "predictions_sha256": predictions_sha256, "runs": runs,
    }
    report_path = output_dir / "results.json"
    report["json_path"] = str(report_path)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = render_summary(report)
    (output_dir / "summary.md").write_text(summary, encoding="utf-8")
    if summary_path:
        Path(summary_path).write_text(summary, encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the MacBook CPU model benchmark")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/macbook-benchmark"))
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args(argv)
    benchmark(args.data_dir, args.output_dir, args.summary)


if __name__ == "__main__":
    main()
