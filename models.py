"""Small, lazy-loaded model catalogue used by the benchmark runner."""

from __future__ import annotations

import json
import math
import pickle
from collections import defaultdict
from pathlib import Path

from pipeline import fit_seasonal, predict_seasonal


FEATURE_NAMES = (
    "route", "hour", "weekday", "month", "is_weekend", "is_holiday",
    "is_workday", "is_preholiday",
)


def _xy(rows):
    import numpy as np
    x = np.asarray([[float(row[name]) for name in FEATURE_NAMES] for row in rows], dtype="float32")
    y = np.asarray([float(row["boardings"]) for row in rows], dtype="float32")
    return x, y


class SeasonalCandidate:
    def fit(self, rows, sample_weight=None):
        self.model = fit_seasonal(rows)
        return self

    def predict(self, rows):
        return [predict_seasonal(self.model, r["route"], r["weekday"], r["hour"]) for r in rows]


class WindowCandidate:
    def __init__(self, weeks=8, statistic="mean", decay=None):
        self.weeks, self.statistic, self.decay = weeks, statistic, decay

    def fit(self, rows, sample_weight=None):
        self.rows = list(rows)
        return self

    def predict(self, rows):
        from datetime import timedelta
        import statistics
        result = []
        by_key = defaultdict(list)
        route_fallback = defaultdict(list)
        for row in self.rows:
            by_key[(int(row["route"]), int(row["weekday"]), int(row["hour"]))].append(
                (row["date"], float(row["boardings"]))
            )
            route_fallback[int(row["route"])].append(float(row["boardings"]))
        cutoff = max(r["date"] for r in self.rows)
        start = cutoff - timedelta(days=7 * int(self.weeks) - 1)
        for row in rows:
            values = [(day, value) for day, value in by_key.get(
                (int(row["route"]), int(row["weekday"]), int(row["hour"])), []
            ) if day >= start]
            if not values:
                prediction = sum(route_fallback.get(int(row["route"]), [0])) / max(1, len(route_fallback.get(int(row["route"]), [])))
            elif self.decay:
                weighted = [(self.decay ** ((cutoff - d).days / 7), v) for d, v in values]
                prediction = sum(w * v for w, v in weighted) / sum(w for w, _ in weighted)
            elif self.statistic == "median":
                prediction = statistics.median(v for _, v in values)
            else:
                prediction = sum(v for _, v in values) / len(values)
            result.append(max(0.0, prediction))
        return result


class SklearnCandidate:
    def __init__(self, estimator):
        self.estimator = estimator

    def fit(self, rows, sample_weight=None):
        x, y = _xy(rows)
        kwargs = {"sample_weight": sample_weight} if sample_weight is not None else {}
        try:
            self.estimator.fit(x, y, **kwargs)
        except TypeError:
            self.estimator.fit(x, y)
        return self

    def predict(self, rows):
        import numpy as np
        x = np.asarray([[float(row[name]) for name in FEATURE_NAMES] for row in rows], dtype="float32")
        values = self.estimator.predict(x)
        if not np.isfinite(values).all():
            raise ValueError("model returned non-finite predictions")
        return np.maximum(values, 0).astype(float).tolist()


def create_candidate(parameters, backend="cpu", seed=42):
    """Create a candidate, importing an optional library only when selected."""
    kind = parameters["kind"]
    if kind == "seasonal":
        return SeasonalCandidate()
    if kind in {"mean", "median", "decay"}:
        return WindowCandidate(parameters.get("weeks", 8), kind, parameters.get("decay", 0.85) if kind == "decay" else None)
    if kind in {"ridge", "poisson", "extra_trees", "random_forest", "hist_gradient_boosting"}:
        if kind == "ridge":
            from sklearn.linear_model import Ridge
            estimator = Ridge(alpha=parameters.get("alpha", 1.0))
        elif kind == "poisson":
            from sklearn.linear_model import PoissonRegressor
            estimator = PoissonRegressor(alpha=parameters.get("alpha", 1.0), max_iter=500)
        elif kind == "extra_trees":
            from sklearn.ensemble import ExtraTreesRegressor
            estimator = ExtraTreesRegressor(n_estimators=parameters.get("n_estimators", 100), max_depth=parameters.get("max_depth"), random_state=seed, n_jobs=1)
        elif kind == "random_forest":
            from sklearn.ensemble import RandomForestRegressor
            estimator = RandomForestRegressor(n_estimators=parameters.get("n_estimators", 100), max_depth=parameters.get("max_depth"), random_state=seed, n_jobs=1)
        else:
            from sklearn.ensemble import HistGradientBoostingRegressor
            estimator = HistGradientBoostingRegressor(loss=parameters.get("loss", "absolute_error"), max_iter=parameters.get("max_iter", 500), random_state=seed)
        return SklearnCandidate(estimator)
    if kind == "xgboost":
        from xgboost import XGBRegressor
        device = "cuda" if backend == "gpu" else "cpu"
        return SklearnCandidate(XGBRegressor(
            objective=parameters.get("objective", "reg:absoluteerror"),
            n_estimators=parameters.get("n_estimators", 500), max_depth=parameters.get("max_depth", 6),
            learning_rate=parameters.get("learning_rate", 0.05), random_state=seed,
            n_jobs=1, device=device,
        ))
    if kind == "catboost":
        from catboost import CatBoostRegressor
        return SklearnCandidate(CatBoostRegressor(
            loss_function=parameters.get("loss_function", "MAE"), iterations=parameters.get("iterations", 500),
            depth=parameters.get("depth", 6), learning_rate=parameters.get("learning_rate", 0.05),
            random_seed=seed, task_type="GPU" if backend == "gpu" else "CPU", verbose=False,
            thread_count=1,
        ))
    if kind == "lightgbm":
        from lightgbm import LGBMRegressor
        return SklearnCandidate(LGBMRegressor(
            objective=parameters.get("objective", "l1"), n_estimators=parameters.get("n_estimators", 500),
            num_leaves=parameters.get("num_leaves", 31), learning_rate=parameters.get("learning_rate", 0.05),
            random_state=seed, n_jobs=1, device_type="cpu" if backend == "cpu" else "gpu",
        ))
    if kind in {"mlp", "dlinear"}:
        from neural_models import TorchCandidate
        return TorchCandidate(kind, parameters, backend, seed)
    raise ValueError(f"unknown model kind: {kind}")


def save_candidate(candidate, path, metadata=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as stream:
        pickle.dump({"candidate": candidate, "metadata": metadata or {}, "features": FEATURE_NAMES}, stream)
    temporary.replace(path)


def load_candidate(path):
    with Path(path).open("rb") as stream:
        return pickle.load(stream)


def catalogue_availability():
    import importlib.util
    return {
        "baseline": True,
        "window": True,
        "sklearn": importlib.util.find_spec("sklearn") is not None,
        "lightgbm": importlib.util.find_spec("lightgbm") is not None,
        "catboost": importlib.util.find_spec("catboost") is not None,
        "xgboost": importlib.util.find_spec("xgboost") is not None,
        "torch": importlib.util.find_spec("torch") is not None,
        "n_hits": False,
    }
