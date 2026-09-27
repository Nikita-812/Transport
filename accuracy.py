import argparse
import csv
import hashlib
import json
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from statistics import median

import experiments
import pipeline


INCUMBENT_SCORE = 0.8426582436223181
INCUMBENT_MODEL = {
    "loss": "absolute_error", "max_depth": 8, "learning_rate": 0.1, "max_iter": 300,
    "l2_regularization": 1.0, "random_state": 42, "categorical_features": list(range(8)),
    "early_stopping": False,
}
PROFILE_CONFIG = {
    "variant": "profiles",
    "model": {"loss": "absolute_error", "max_depth": 8, "learning_rate": 0.1, "max_iter": 300, "l2_regularization": 1.0,
              "random_state": 42, "categorical_features": list(range(8)), "early_stopping": False},
    "features": ["horizon_days", "all_route_weekday_hour_mean", "56d_route_weekday_hour_mean",
                 "56d_route_weekday_hour_median", "28d_route_hour_mean", "28d_route_daily_mean", "28d_minus_84d_route_daily_mean"],
}
RAW_ACTIVITY_CONFIG = {
    **PROFILE_CONFIG,
    "variant": "raw_activity_hgb",
    "raw_activity_features": [
        "28d_route_weekday_hour_events_mean",
        "28d_route_weekday_hour_active_vehicles_mean",
        "28d_route_weekday_hour_active_exits_mean",
        "28d_route_weekday_hour_active_devices_mean",
        "28d_minus_all_route_weekday_hour_events_mean",
        "28d_minus_all_route_weekday_hour_active_vehicles_mean",
        "28d_minus_all_route_weekday_hour_active_exits_mean",
        "28d_minus_all_route_weekday_hour_active_devices_mean",
    ],
    "raw_activity_provenance": "raw_activity.csv is frozen at each forecast origin; raw boardings only reconcile the source and are not model features",
}
DEVICE_DENSITY_CONFIG = {
    "variant": "per_route_device_density",
    "model": INCUMBENT_MODEL,
    "target": "boardings / active_devices for positive active_devices only",
    "sample_weight": "active_devices; weighted absolute density loss equals boarding absolute error at observed exposure",
    "exposure": "28-day mean active_devices by route×calendar-day-key×hour, exact all-history fallback, then zero; frozen at each cutoff",
    "postprocessing": "nonnegative density; zero expected exposure and all-zero route histories remain zero",
}
FARE_COMPONENT_MODEL = {**INCUMBENT_MODEL, "categorical_features": [*range(8), 9]}
FARE_COMPONENT_CONFIG = {
    "variant": "pooled_fare_components",
    "model": FARE_COMPONENT_MODEL,
    "target": "zero-filled route×date×hour×(top-8-fare-or-other) boardings; one pooled categorical fare model",
    "vocabulary": "top 8 (good_type, good_type_missing) pairs by pre-cutoff boardings, deterministic tuple tiebreak; all remaining pairs map to an internal OTHER group",
    "prediction": "sum nonnegative predictions for each cutoff-local component group; unseen future fares receive no component",
    "categorical_feature_index": 9,
}
PER_ROUTE_FARE_COMPONENT_CONFIG = {
    **FARE_COMPONENT_CONFIG,
    "variant": "per_route_fare_components",
    "fit": "one frozen pooled-fare-component HGB per active route; top-8-plus-other is selected within that route and cutoff",
}
RESIDUAL_CONFIG = {
    **PROFILE_CONFIG,
    "variant": "residual",
    "anchor": "frozen 56d route×weekday×hour mean; fallback to all-history route×weekday×hour mean, then 28d route×hour mean",
}
DAILY_SHARE_CONFIG = {
    "variant": "daily_share",
    "daily_total": "56-day route×calendar-day profile; all-history fallback",
    "hourly_share": "all-history route×calendar-day×hour share, normalized per route-day",
}
CALIBRATED_HGB_CONFIG = {
    "variant": "calibrated_hgb",
    "base_model": "frozen incumbent HGB",
    "base_model_parameters": INCUMBENT_MODEL,
    "calibration": "median train-only fixed-origin target/prediction daily-total ratio by route×calendar-day",
}
PER_ROUTE_HGB_CONFIG = {
    "variant": "per_route_hgb",
    "model": "HistGradientBoostingRegressor",
    "parameters": INCUMBENT_MODEL,
    "fit": "one frozen-config model per active route; route 5 remains zero from its all-zero history",
}
HIERARCHICAL_HGB_CONFIG = {
    "variant": "hierarchical_hgb",
    "daily_model_parameters": INCUMBENT_MODEL,
    "share_model_parameters": INCUMBENT_MODEL,
    "fit": "one daily-total HGB and one hourly-share HGB per active route; normalized shares sum to each predicted route-day total",
}
POOLED_ROUTE_BLEND_CONFIG = {
    "variant": "pooled_route_blend",
    "pooled_model_parameters": INCUMBENT_MODEL,
    "per_route_model_parameters": INCUMBENT_MODEL,
    "per_route_weight": 0.5,
    "postprocessing": "nonnegative predictions; routes with all-zero training targets remain zero",
}
SEASONAL_INTERACTION_CONFIG = {
    "variant": "seasonal_interaction",
    "model": "sklearn.linear_model.Ridge",
    "alpha": 1.0,
    "categorical_features": ["route×weekday×hour", "calendar-event×hour"],
    "trend": {
        "kind": "route-specific linear",
        "feature_scale": 0.02,
        "post_origin_damping": 0.25,
        "origin": "each fixed forecast cutoff",
    },
    "inner_selection": "none; alpha and damping are predeclared",
    "postprocessing": "nonnegative predictions; routes with all-zero training targets remain zero",
}
VARIANTS = {
    "profiles": PROFILE_CONFIG, "residual": RESIDUAL_CONFIG, "daily_share": DAILY_SHARE_CONFIG,
    "calibrated_hgb": CALIBRATED_HGB_CONFIG, "per_route_hgb": PER_ROUTE_HGB_CONFIG,
    "hierarchical_hgb": HIERARCHICAL_HGB_CONFIG,
    "pooled_route_blend": POOLED_ROUTE_BLEND_CONFIG,
    "seasonal_interaction": SEASONAL_INTERACTION_CONFIG,
    "raw_activity_hgb": RAW_ACTIVITY_CONFIG,
    "per_route_device_density": DEVICE_DENSITY_CONFIG,
    "pooled_fare_components": FARE_COMPONENT_CONFIG,
    "per_route_fare_components": PER_ROUTE_FARE_COMPONENT_CONFIG,
}


def _mean(values, fallback=0.0):
    return sum(values) / len(values) if values else fallback


def profile_snapshot(rows, origin):
    rows = [row for row in rows if row["date"] <= origin]
    exact_all, exact_56, route_hour_28 = defaultdict(list), defaultdict(list), defaultdict(list)
    route_day = defaultdict(lambda: defaultdict(int))
    for row in rows:
        value = float(row["boardings"])
        route = int(row["route"])
        key = (route, int(row["weekday"]), int(row["hour"]))
        exact_all[key].append(value)
        route_day[route][row["date"]] += value
        if row["date"] > origin - timedelta(days=56):
            exact_56[key].append(value)
        if row["date"] > origin - timedelta(days=28):
            route_hour_28[(route, int(row["hour"]))].append(value)

    daily_28, daily_84 = {}, {}
    for route, totals in route_day.items():
        daily_28[route] = _mean([value for day, value in totals.items() if day > origin - timedelta(days=28)])
        daily_84[route] = _mean([value for day, value in totals.items() if day > origin - timedelta(days=84)])
    return {
        "exact_all": {key: _mean(values) for key, values in exact_all.items()},
        "exact_56_mean": {key: _mean(values) for key, values in exact_56.items()},
        "exact_56_median": {key: median(values) for key, values in exact_56.items()},
        "route_hour_28": {key: _mean(values) for key, values in route_hour_28.items()},
        "daily_28": daily_28,
        "daily_trend": {route: daily_28[route] - daily_84.get(route, daily_28[route]) for route in daily_28},
    }


RAW_ACTIVITY_FIELDS = ("events", "active_vehicles", "active_exits", "active_devices")
RAW_ACTIVITY_HEADER = ("route", "date", "hour", "boardings", *RAW_ACTIVITY_FIELDS)
RAW_FARE_HEADER = ("route", "date", "hour", "good_type", "good_type_missing", "boardings")


def read_raw_activity(path, history, history_sha256, history_name):
    """Read the reconciled raw aggregate once and reject a mismatched grid."""
    path = Path(path)
    metadata_path = path.with_suffix(".metadata.json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{metadata_path}: valid provenance metadata is required") from error
    reconciliation = metadata.get("reconciliation", {})
    if (
        metadata.get("schema_version") != 1
        or metadata.get("output_sha256") != hashlib.sha256(path.read_bytes()).hexdigest()
        or reconciliation.get("history") != history_name
        or reconciliation.get("history_sha256") != history_sha256
        or reconciliation.get("mismatches") != 0
    ):
        raise ValueError(f"{path}: provenance metadata does not match this activity or history file")
    values = {}
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if tuple(reader.fieldnames or ()) != RAW_ACTIVITY_HEADER:
            raise ValueError(f"{path}: schema must be {';'.join(RAW_ACTIVITY_HEADER)}")
        for line, row in enumerate(reader, 2):
            try:
                route, hour = int(row["route"]), int(row["hour"])
                day = date.fromisoformat(row["date"])
                metrics = {field: int(row[field]) for field in ("boardings", *RAW_ACTIVITY_FIELDS)}
            except (TypeError, ValueError) as error:
                raise ValueError(f"{path} line {line}: expected ISO date and integer counts") from error
            if (
                route not in pipeline.ROUTES or not 0 <= hour <= 23 or any(value < 0 for value in metrics.values())
                or metrics["boardings"] > metrics["events"]
                or any(metrics[field] > metrics["events"] for field in RAW_ACTIVITY_FIELDS[1:])
            ):
                raise ValueError(f"{path} line {line}: invalid route, hour, or negative count")
            key = (route, day, hour)
            if key in values:
                raise ValueError(f"{path} line {line}: duplicate key {key}")
            values[key] = metrics
    history_by_key = {(int(row["route"]), row["date"], int(row["hour"])): row for row in history}
    history_values = {key: int(row["boardings"]) for key, row in history_by_key.items()}
    if (
        values.keys() != history_values.keys()
        or metadata.get("rows") != len(history_values)
        or reconciliation.get("keys") != len(history_values)
        or reconciliation.get("boardings") != sum(history_values.values())
    ):
        raise ValueError(f"{path}: keys do not match history grid")
    if any(values[key]["boardings"] != target for key, target in history_values.items()):
        raise ValueError(f"{path}: boardings do not match history")
    return [
        {
            "route": route, "date": day, "hour": hour, **values[(route, day, hour)],
            **{field: history_by_key[(route, day, hour)][field] for field in pipeline.CALENDAR_FIELDS},
        }
        for route, day, hour in history_values
    ], metadata, metadata_path


def read_raw_fares(path, history, history_sha256, history_name):
    """Read positive sparse fare components and reconcile them to every parent key."""
    path = Path(path)
    metadata_path = path.with_suffix(".metadata.json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{metadata_path}: valid provenance metadata is required") from error
    reconciliation = metadata.get("reconciliation", {})
    if (
        metadata.get("schema_version") != 1
        or metadata.get("output_sha256") != hashlib.sha256(path.read_bytes()).hexdigest()
        or metadata.get("parent_grid_rows") != len(history)
        or reconciliation.get("history") != history_name
        or reconciliation.get("history_sha256") != history_sha256
        or reconciliation.get("keys") != len(history)
        or reconciliation.get("mismatches") != 0
    ):
        raise ValueError(f"{path}: provenance metadata does not match this fare or history file")
    values, parent_totals = {}, defaultdict(int)
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if tuple(reader.fieldnames or ()) != RAW_FARE_HEADER:
            raise ValueError(f"{path}: schema must be {';'.join(RAW_FARE_HEADER)}")
        for line, row in enumerate(reader, 2):
            try:
                route, hour, missing, boardings = (int(row[field]) for field in ("route", "hour", "good_type_missing", "boardings"))
                day = date.fromisoformat(row["date"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"{path} line {line}: expected ISO date and integer counts") from error
            fare = row["good_type"]
            if (
                route not in pipeline.ROUTES or not 0 <= hour <= 23 or missing not in (0, 1) or boardings <= 0
                or (missing == 1) != (fare == "")
            ):
                raise ValueError(f"{path} line {line}: invalid fare component")
            key = (route, day, hour, fare, missing)
            if key in values:
                raise ValueError(f"{path} line {line}: duplicate fare component")
            values[key] = boardings
            parent_totals[key[:3]] += boardings
    history_values = {(int(row["route"]), row["date"], int(row["hour"])): int(row["boardings"]) for row in history}
    if set(parent_totals) - set(history_values) or any(parent_totals[key] != target for key, target in history_values.items()):
        raise ValueError(f"{path}: fare components do not reconcile to history")
    if metadata.get("rows") != len(values) or reconciliation.get("boardings") != sum(history_values.values()):
        raise ValueError(f"{path}: fare metadata totals do not match history")
    return [
        {"route": route, "date": day, "hour": hour, "good_type": fare, "good_type_missing": missing, "boardings": boardings}
        for (route, day, hour, fare, missing), boardings in values.items()
    ], metadata, metadata_path


def raw_activity_snapshot(rows, origin):
    """Freeze operational profiles at ``origin``; never read horizon activity."""
    recent, all_history = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["date"] > origin:
            continue
        key = (int(row["route"]), int(row["date"].weekday()), int(row["hour"]))
        for field in RAW_ACTIVITY_FIELDS:
            all_history[key][field].append(float(row[field]))
            if row["date"] > origin - timedelta(days=28):
                recent[key][field].append(float(row[field]))
    return {
        "recent": {key: {field: _mean(values[field]) for field in RAW_ACTIVITY_FIELDS} for key, values in recent.items()},
        "all": {key: {field: _mean(values[field]) for field in RAW_ACTIVITY_FIELDS} for key, values in all_history.items()},
    }


def raw_activity_matrix(rows, profile, raw_profile, origin):
    import numpy as np

    extras = []
    for row in rows:
        key = (int(row["route"]), int(row["weekday"]), int(row["hour"]))
        recent = raw_profile["recent"].get(key, {})
        all_history = raw_profile["all"].get(key, {})
        means = [recent.get(field, all_history.get(field, 0.0)) for field in RAW_ACTIVITY_FIELDS]
        extras.append([*means, *(value - all_history.get(field, 0.0) for value, field in zip(means, RAW_ACTIVITY_FIELDS))])
    return np.column_stack((profile_matrix(rows, profile, origin), np.asarray(extras, dtype=float)))


def device_exposure_snapshot(rows, origin):
    """Estimate future validator exposure only from activity at or before ``origin``."""
    recent, all_history = defaultdict(list), defaultdict(list)
    for row in rows:
        if row["date"] > origin:
            continue
        key = (int(row["route"]), _calendar_day_key(row), int(row["hour"]))
        all_history[key].append(float(row["active_devices"]))
        if row["date"] > origin - timedelta(days=28):
            recent[key].append(float(row["active_devices"]))
    return {
        "recent": {key: _mean(values) for key, values in recent.items()},
        "all": {key: _mean(values) for key, values in all_history.items()},
    }


def device_exposure(row, snapshot):
    key = (int(row["route"]), _calendar_day_key(row), int(row["hour"]))
    return snapshot["recent"].get(key, snapshot["all"].get(key, 0.0))


def per_route_device_density_predictions(train, validation, raw_rows, cutoff):
    """Fit boarding density per active device; forecast devices from frozen history."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    train = [row for row in train if row["date"] <= cutoff]
    activity = {(int(row["route"]), row["date"], int(row["hour"])): row for row in raw_rows}
    exposure = device_exposure_snapshot(raw_rows, cutoff)
    predictions = {}
    for route in pipeline.ROUTES:
        route_train = [row for row in train if int(row["route"]) == route]
        route_validation = [row for row in validation if int(row["route"]) == route]
        if not route_validation:
            continue
        selected = [row for row in route_train if activity[(route, row["date"], int(row["hour"]))]["active_devices"] > 0]
        if not selected or not any(row["boardings"] for row in route_train):
            predictions[route] = [0.0] * len(route_validation)
            continue
        counts = [activity[(route, row["date"], int(row["hour"]))]["active_devices"] for row in selected]
        model = HistGradientBoostingRegressor(**INCUMBENT_MODEL).fit(
            experiments.feature_matrix(selected),
            [row["boardings"] / count for row, count in zip(selected, counts)],
            sample_weight=counts,
        )
        densities = experiments.validate_predictions(model.predict(experiments.feature_matrix(route_validation)))
        predictions[route] = experiments.validate_predictions(
            density * device_exposure(row, exposure) for row, density in zip(route_validation, densities)
        )
    positions = defaultdict(int)
    ordered = []
    for row in validation:
        route = int(row["route"])
        ordered.append(predictions[route][positions[route]])
        positions[route] += 1
    return ordered


def pooled_fare_component_predictions(train, validation, fare_rows, cutoff, diagnostic=None):
    """Forecast each cutoff-local fare component, then sum its route-hour values."""
    from sklearn.ensemble import HistGradientBoostingRegressor
    import numpy as np

    train = [row for row in train if row["date"] <= cutoff]
    routes = {int(row["route"]) for row in train}
    visible = [row for row in fare_rows if row["date"] <= cutoff and int(row["route"]) in routes]
    fare_totals = defaultdict(int)
    for row in visible:
        fare_totals[(row["good_type"], row["good_type_missing"])] += row["boardings"]
    kept = [fare for fare, _ in sorted(fare_totals.items(), key=lambda item: (-item[1], item[0]))[:8]]
    if not kept:
        raise ValueError("no fare components are available at this cutoff")
    groups = len(kept) + 1
    kept_indexes = {fare: index for index, fare in enumerate(kept)}
    other_index = len(kept)
    components = defaultdict(int)
    for row in visible:
        fare = (row["good_type"], row["good_type_missing"])
        group = kept_indexes.get(fare, other_index)
        components[(row["route"], row["date"], row["hour"], group)] += row["boardings"]
    base_train = experiments.feature_matrix(train)
    base_validation = experiments.feature_matrix(validation)
    matrices = []
    targets = []
    for index in range(groups):
        matrices.append(np.column_stack((base_train, np.full(len(train), index, dtype=float))))
        targets.extend(components[(row["route"], row["date"], row["hour"], index)] for row in train)
    model = HistGradientBoostingRegressor(**FARE_COMPONENT_MODEL).fit(np.vstack(matrices), targets)
    predictions = np.zeros(len(validation), dtype=float)
    for index in range(groups):
        matrix = np.column_stack((base_validation, np.full(len(validation), index, dtype=float)))
        predictions += np.asarray(experiments.validate_predictions(model.predict(matrix)))
    active_routes = {int(row["route"]) for row in train if row["boardings"]}
    values = [0.0 if int(row["route"]) not in active_routes else value for row, value in zip(validation, predictions)]
    if diagnostic is not None:
        other_total = sum(value for fare, value in fare_totals.items() if fare not in kept_indexes)
        total = sum(fare_totals.values())
        diagnostic.update({
            "kept_fares": [{"good_type": fare, "good_type_missing": missing, "boardings": fare_totals[(fare, missing)]} for fare, missing in kept],
            "other": {"group_index": other_index, "boardings": other_total, "share": other_total / total if total else 0.0},
            "component_group_count": groups, "training_cells": len(train) * groups, "observed_positive_components": len(visible),
        })
    return experiments.validate_predictions(values)


def per_route_fare_component_predictions(train, validation, fare_rows, cutoff, diagnostic=None):
    """Allocate the unchanged fare-component HGB independently to each route."""
    predictions, route_diagnostics = {}, {}
    for route in pipeline.ROUTES:
        route_train = [row for row in train if int(row["route"]) == route]
        route_validation = [row for row in validation if int(row["route"]) == route]
        if not route_validation:
            continue
        if not any(row["boardings"] for row in route_train):
            predictions[route] = [0.0] * len(route_validation)
            continue
        item = {}
        predictions[route] = pooled_fare_component_predictions(route_train, route_validation, fare_rows, cutoff, item)
        route_diagnostics[str(route)] = item
    positions = defaultdict(int)
    ordered = []
    for row in validation:
        route = int(row["route"])
        ordered.append(predictions[route][positions[route]])
        positions[route] += 1
    if diagnostic is not None:
        diagnostic["routes"] = route_diagnostics
    return ordered


def _profile_values(row, snapshot):
    route, weekday, hour = int(row["route"]), int(row["weekday"]), int(row["hour"])
    exact = (route, weekday, hour)
    route_hour = (route, hour)
    all_mean = snapshot["exact_all"].get(exact, snapshot["route_hour_28"].get(route_hour, 0.0))
    recent_mean = snapshot["exact_56_mean"].get(exact, all_mean)
    return all_mean, recent_mean, snapshot["exact_56_median"].get(exact, recent_mean), route_hour


def profile_anchors(rows, snapshot):
    return [_profile_values(row, snapshot)[1] for row in rows]


def _calendar_day_key(row):
    if row["is_holiday"]:
        return "holiday"
    if row["is_preholiday"]:
        return "preholiday"
    return f"weekday-{row['weekday']}" if row["is_workday"] else "nonworkday"


def daily_share_snapshot(rows, origin):
    """Freeze daily levels and hourly shares at ``origin``."""
    daily_totals = defaultdict(int)
    day_keys = {}
    for row in rows:
        if row["date"] <= origin:
            route_day = (int(row["route"]), row["date"])
            daily_totals[route_day] += int(row["boardings"])
            day_keys[route_day] = (route_day[0], _calendar_day_key(row))

    all_levels, recent_levels = defaultdict(list), defaultdict(list)
    share_numerators, share_denominators = defaultdict(float), defaultdict(float)
    for (route, day), total in daily_totals.items():
        key = day_keys[(route, day)]
        all_levels[key].append(total)
        if day > origin - timedelta(days=56):
            recent_levels[key].append(total)
        share_denominators[key] += total
    for row in rows:
        if row["date"] <= origin:
            key = (int(row["route"]), _calendar_day_key(row))
            share_numerators[(key, int(row["hour"]))] += int(row["boardings"])
    return {
        "daily_all": {key: _mean(values) for key, values in all_levels.items()},
        "daily_56": {key: _mean(values) for key, values in recent_levels.items()},
        "shares": {
            key_hour: numerator / share_denominators[key_hour[0]]
            for key_hour, numerator in share_numerators.items()
            if share_denominators[key_hour[0]]
        },
    }


def daily_share_predictions(rows, origin, validation):
    snapshot = daily_share_snapshot(rows, origin)
    predictions = []
    for row in validation:
        key = (int(row["route"]), _calendar_day_key(row))
        total = snapshot["daily_56"].get(key, snapshot["daily_all"].get(key, 0.0))
        predictions.append(total * snapshot["shares"].get((key, int(row["hour"])), 0.0))
    return experiments.validate_predictions(predictions)


def _incumbent_predictions(train, validation):
    from sklearn.ensemble import HistGradientBoostingRegressor

    model = HistGradientBoostingRegressor(**INCUMBENT_MODEL).fit(
        experiments.feature_matrix(train), [row["boardings"] for row in train]
    )
    return experiments.validate_predictions(model.predict(experiments.feature_matrix(validation)))


def _calibration_origins(cutoff):
    return [origin for origin in _month_ends(cutoff) if origin + timedelta(days=61) <= cutoff]


def calibrated_hgb_predictions(rows, cutoff, validation):
    """Calibrate the frozen HGB's daily volume using only pre-cutoff forecasts."""
    train = [row for row in rows if row["date"] <= cutoff]
    ratios = defaultdict(list)
    for origin in _calibration_origins(cutoff):
        fit_rows = [row for row in train if row["date"] <= origin]
        target_rows = [row for row in train if origin < row["date"] <= origin + timedelta(days=61)]
        predictions = _incumbent_predictions(fit_rows, target_rows)
        daily = defaultdict(lambda: [0.0, 0.0])
        day_keys = {}
        for row, prediction in zip(target_rows, predictions):
            route_day = (int(row["route"]), row["date"])
            daily[route_day][0] += row["boardings"]
            daily[route_day][1] += prediction
            day_keys[route_day] = (route_day[0], _calendar_day_key(row))
        for (route, day), (actual, predicted) in daily.items():
            if predicted > 0:
                ratios[day_keys[(route, day)]].append(actual / predicted)
    factors = {key: median(values) for key, values in ratios.items()}
    base = _incumbent_predictions(train, validation)
    return experiments.validate_predictions(
        prediction * factors.get((int(row["route"]), _calendar_day_key(row)), 1.0)
        for row, prediction in zip(validation, base)
    )


def per_route_hgb_predictions(train, validation):
    """Fit the frozen HGB separately for each route, preserving input order."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    predictions = {}
    for route in pipeline.ROUTES:
        route_train = [row for row in train if int(row["route"]) == route]
        route_validation = [row for row in validation if int(row["route"]) == route]
        if not route_validation:
            continue
        if not any(row["boardings"] for row in route_train):
            predictions[route] = [0.0] * len(route_validation)
            continue
        predictions[route] = experiments._fit_predict(
            lambda: HistGradientBoostingRegressor(**INCUMBENT_MODEL),
            route_train,
            route_validation,
        )
    positions = defaultdict(int)
    ordered = []
    for row in validation:
        route = int(row["route"])
        ordered.append(predictions[route][positions[route]])
        positions[route] += 1
    return ordered


def pooled_hgb_predictions(train, validation):
    from sklearn.ensemble import HistGradientBoostingRegressor

    return experiments._fit_predict(lambda: HistGradientBoostingRegressor(**INCUMBENT_MODEL), train, validation)


def pooled_route_blend_predictions(train, validation):
    pooled = pooled_hgb_predictions(train, validation)
    per_route = per_route_hgb_predictions(train, validation)
    active_routes = {int(row["route"]) for row in train if row["boardings"]}
    return experiments.validate_predictions(
        0.0 if int(row["route"]) not in active_routes else (left + right) / 2
        for row, left, right in zip(validation, pooled, per_route)
    )


def _seasonal_interaction_categories(rows):
    return [
        (
            f"{row['route']}:{row['weekday']}:{row['hour']}",
            f"{row['is_holiday']}:{row['is_workday']}:{row['is_preholiday']}:{row['hour']}",
        )
        for row in rows
    ]


def _seasonal_interaction_matrix(rows, cutoff, encoder):
    from scipy.sparse import csr_matrix, hstack

    cutoff_day = (cutoff - date(2025, 1, 1)).days
    trend_rows, trend_columns, trend_values = [], [], []
    for index, row in enumerate(rows):
        raw_day = (row["date"] - date(2025, 1, 1)).days
        damped_day = raw_day if raw_day <= cutoff_day else cutoff_day + 0.25 * (raw_day - cutoff_day)
        trend_rows.append(index)
        trend_columns.append(experiments.ROUTE_INDEX[int(row["route"])])
        trend_values.append(0.02 * (damped_day - cutoff_day))
    encoded = encoder.transform(_seasonal_interaction_categories(rows))
    trends = csr_matrix((trend_values, (trend_rows, trend_columns)), shape=(len(rows), len(experiments.ROUTE_INDEX)))
    return hstack((encoded, trends), format="csr")


def seasonal_interaction_predictions(train, cutoff, validation):
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import OneHotEncoder

    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=True).fit(_seasonal_interaction_categories(train))
    model = Ridge(alpha=1.0).fit(
        _seasonal_interaction_matrix(train, cutoff, encoder), [row["boardings"] for row in train]
    )
    values = experiments.validate_predictions(model.predict(_seasonal_interaction_matrix(validation, cutoff, encoder)))
    active_routes = {int(row["route"]) for row in train if row["boardings"]}
    return [0.0 if int(row["route"]) not in active_routes else value for row, value in zip(validation, values)]


def _hgb_predictions(train, targets, validation):
    from sklearn.ensemble import HistGradientBoostingRegressor

    model = HistGradientBoostingRegressor(**INCUMBENT_MODEL).fit(experiments.feature_matrix(train), targets)
    return experiments.validate_predictions(model.predict(experiments.feature_matrix(validation)))


def _normalize_daily_predictions(rows, totals, shares):
    by_day = defaultdict(list)
    for index, row in enumerate(rows):
        by_day[(int(row["route"]), row["date"])].append(index)
    result = [0.0] * len(rows)
    for key, indexes in by_day.items():
        denominator = sum(shares[index] for index in indexes)
        if denominator:
            for index in indexes:
                result[index] = totals[index] * shares[index] / denominator
        elif indexes:
            fallback = totals[indexes[0]] / len(indexes)
            for index in indexes:
                result[index] = fallback
    return result


def hierarchical_hgb_predictions(train, validation):
    """Forecast each active route's daily volume and intraday shape separately."""
    predictions = [0.0] * len(validation)
    for route in pipeline.ROUTES:
        route_train = [row for row in train if int(row["route"]) == route]
        positions = [index for index, row in enumerate(validation) if int(row["route"]) == route]
        if not positions or not any(row["boardings"] for row in route_train):
            continue
        daily_totals = defaultdict(int)
        daily_rows = {}
        for row in route_train:
            key = row["date"]
            daily_totals[key] += int(row["boardings"])
            daily_rows[key] = {**row, "hour": 0}
        train_daily = [daily_rows[day] for day in sorted(daily_rows)]
        target_daily = [daily_totals[row["date"]] for row in train_daily]
        validation_daily = {}
        for index in positions:
            row = validation[index]
            validation_daily[row["date"]] = {**row, "hour": 0}
        predicted_daily = _hgb_predictions(train_daily, target_daily, [validation_daily[day] for day in sorted(validation_daily)])
        totals_by_day = dict(zip(sorted(validation_daily), predicted_daily))

        target_shares = [row["boardings"] / daily_totals[row["date"]] if daily_totals[row["date"]] else 0.0 for row in route_train]
        route_validation = [validation[index] for index in positions]
        predicted_shares = _hgb_predictions(route_train, target_shares, route_validation)
        totals = [totals_by_day[row["date"]] for row in route_validation]
        values = _normalize_daily_predictions(route_validation, totals, predicted_shares)
        for index, value in zip(positions, values):
            predictions[index] = value
    return experiments.validate_predictions(predictions)


def profile_matrix(rows, snapshot, origin):
    import numpy as np

    base = experiments.feature_matrix(rows)
    extras = []
    for row in rows:
        all_mean, recent_mean, recent_median, route_hour = _profile_values(row, snapshot)
        level = snapshot["daily_28"].get(int(row["route"]), 0.0)
        extras.append([
            (row["date"] - origin).days, all_mean, recent_mean, recent_median,
            snapshot["route_hour_28"].get(route_hour, all_mean), level,
            snapshot["daily_trend"].get(int(row["route"]), 0.0),
        ])
    return np.column_stack((base, np.asarray(extras, dtype=float)))


def _month_ends(cutoff):
    current = date(2025, 1, 31)
    while current <= cutoff:
        yield current
        if current.month == 12:
            current = date(current.year + 1, 1, 31)
        else:
            next_month = date(current.year, current.month + 1, 1)
            following = date(next_month.year + (next_month.month == 12), (next_month.month % 12) + 1, 1)
            current = following - timedelta(days=1)


def origin_training_rows(rows, cutoff):
    usable = [row for row in rows if row["date"] <= cutoff]
    result = []
    for origin in _month_ends(cutoff):
        end = min(cutoff, origin + timedelta(days=61))
        result.extend((origin, row) for row in usable if origin < row["date"] <= end)
    return result


def residual_predictions(anchors, residuals, validation, active_routes):
    values = experiments.validate_predictions(anchor + residual for anchor, residual in zip(anchors, residuals))
    return [0.0 if row["route"] not in active_routes else value for row, value in zip(validation, values)]


def _fit_predict(rows, cutoff, validation, variant, raw_rows=None, fare_rows=None, diagnostic=None):
    from sklearn.ensemble import HistGradientBoostingRegressor
    import numpy as np

    train = [row for row in rows if row["date"] <= cutoff]
    if variant == "daily_share":
        return daily_share_predictions(train, cutoff, validation)
    if variant == "calibrated_hgb":
        return calibrated_hgb_predictions(train, cutoff, validation)
    if variant == "per_route_hgb":
        return per_route_hgb_predictions(train, validation)
    if variant == "hierarchical_hgb":
        return hierarchical_hgb_predictions(train, validation)
    if variant == "pooled_route_blend":
        return pooled_route_blend_predictions(train, validation)
    if variant == "seasonal_interaction":
        return seasonal_interaction_predictions(train, cutoff, validation)
    if variant in {"raw_activity_hgb", "per_route_device_density"} and raw_rows is None:
        raise ValueError(f"{variant} requires raw activity rows")
    if variant == "per_route_device_density":
        return per_route_device_density_predictions(train, validation, raw_rows, cutoff)
    if variant in {"pooled_fare_components", "per_route_fare_components"}:
        if fare_rows is None:
            raise ValueError(f"{variant} requires raw fare rows")
        if variant == "per_route_fare_components":
            return per_route_fare_component_predictions(train, validation, fare_rows, cutoff, diagnostic)
        return pooled_fare_component_predictions(train, validation, fare_rows, cutoff, diagnostic)
    config = VARIANTS[variant]
    examples = origin_training_rows(train, cutoff)
    if not examples:
        raise ValueError("no origin-aware training examples")
    by_origin = defaultdict(list)
    for origin, row in examples:
        by_origin[origin].append(row)
    matrices, targets = [], []
    for origin, target_rows in by_origin.items():
        snapshot = profile_snapshot(train, origin)
        if variant == "raw_activity_hgb":
            matrices.append(raw_activity_matrix(target_rows, snapshot, raw_activity_snapshot(raw_rows, origin), origin))
        else:
            matrices.append(profile_matrix(target_rows, snapshot, origin))
        anchors = profile_anchors(target_rows, snapshot)
        targets.extend(row["boardings"] - anchor if variant == "residual" else row["boardings"] for row, anchor in zip(target_rows, anchors))
    model = HistGradientBoostingRegressor(**config["model"]).fit(np.vstack(matrices), targets)
    snapshot = profile_snapshot(train, cutoff)
    matrix = (
        raw_activity_matrix(validation, snapshot, raw_activity_snapshot(raw_rows, cutoff), cutoff)
        if variant == "raw_activity_hgb" else profile_matrix(validation, snapshot, cutoff)
    )
    raw_predictions = model.predict(matrix)
    totals = defaultdict(int)
    for row in train:
        totals[row["route"]] += row["boardings"]
    active_routes = {route for route, total in totals.items() if total}
    if variant == "residual":
        return residual_predictions(profile_anchors(validation, snapshot), raw_predictions, validation, active_routes)
    predictions = experiments.validate_predictions(raw_predictions)
    return [0.0 if row["route"] not in active_routes else value for row, value in zip(validation, predictions)]


def _score(rows, predictions):
    if len(rows) != len(predictions):
        raise ValueError(f"prediction count {len(predictions)} does not match target count {len(rows)}")
    score = pipeline.metric(
        {"boardings": row["boardings"], "prediction": prediction}
        for row, prediction in zip(rows, predictions)
    )
    return {"absolute_error": score["absolute_error"], "target_sum": score["target_sum"], "wape_score": score["wape_score"]}


def target_met(scores):
    scores = list(scores)
    return bool(scores) and all(score >= 0.95 for score in scores)


def _write_predictions(path, rows, predictions, cutoff):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter=";", lineterminator="\n")
        writer.writerow(("route", "date", "hour", "target", "prediction", "forecast_origin"))
        for row, prediction in zip(rows, predictions):
            writer.writerow((row["route"], row["date"].isoformat(), row["hour"], row["boardings"], prediction, cutoff.isoformat()))


def evaluate(data_dir=Path("data/processed"), output_dir=Path("artifacts/accuracy/iteration-1"), variant="profiles"):
    if variant not in VARIANTS:
        raise ValueError(f"unknown variant: {variant}")
    history_path = Path(data_dir) / "history.csv"
    rows = pipeline.read_history(history_path)
    raw_path = Path(data_dir) / "raw_activity.csv"
    fare_path = Path(data_dir) / "raw_fares.csv"
    history_sha256 = hashlib.sha256(history_path.read_bytes()).hexdigest()
    raw_rows, raw_metadata, raw_metadata_path = (
        read_raw_activity(raw_path, rows, history_sha256, history_path.name)
        if variant in {"raw_activity_hgb", "per_route_device_density"} else (None, None, None)
    )
    fare_rows, fare_metadata, fare_metadata_path = (
        read_raw_fares(fare_path, rows, history_sha256, history_path.name)
        if variant in {"pooled_fare_components", "per_route_fare_components"} else (None, None, None)
    )
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "protocol": "fixed-origin two-calendar-month evaluation; candidate statistics freeze at each origin and never use validation labels",
        "incumbent_early_wape_score": INCUMBENT_SCORE,
        "target_wape_score": 0.95,
        "target_scope": "early fixed-origin slices only; late slice has not been evaluated",
        "history_sha256": history_sha256,
        "accuracy_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "config": VARIANTS[variant],
        "slices": {},
    }
    if raw_rows is not None:
        report["raw_activity"] = {
            "path": str(raw_path),
            "sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
            "metadata_path": str(raw_metadata_path),
            "metadata_sha256": hashlib.sha256(raw_metadata_path.read_bytes()).hexdigest(),
            "rows": len(raw_rows),
            "provenance": "validated complete history grid; boardings reconciled to history.csv; features exclude raw boardings",
            "source_code_sha256": raw_metadata.get("source_code_sha256"),
            "sources": raw_metadata.get("sources"),
        }
    if fare_rows is not None:
        report["raw_fares"] = {
            "path": str(fare_path), "sha256": hashlib.sha256(fare_path.read_bytes()).hexdigest(),
            "metadata_path": str(fare_metadata_path), "metadata_sha256": hashlib.sha256(fare_metadata_path.read_bytes()).hexdigest(),
            "rows": len(fare_rows), "source_code_sha256": fare_metadata.get("source_code_sha256"),
            "sources": fare_metadata.get("sources"),
            "provenance": "validated sparse fare components reconcile to every history grid key; vocabulary is cutoff-local",
        }
    started = time.perf_counter()
    pairs = []
    for name, cutoff, start, end in pipeline.SLICES[:2]:
        validation = [row for row in rows if start <= row["date"] <= end]
        fare_diagnostic = {} if fare_rows is not None else None
        predictions = _fit_predict(rows, cutoff, validation, variant, raw_rows, fare_rows, fare_diagnostic)
        score = _score(validation, predictions)
        report["slices"][name] = {"cutoff": cutoff.isoformat(), "horizon": [start.isoformat(), end.isoformat()], **score}
        if fare_diagnostic is not None:
            report["slices"][name]["fare_components"] = fare_diagnostic
        pairs.append((score["absolute_error"], score["target_sum"]))
        _write_predictions(output_dir / f"{name}-predictions.csv", validation, predictions, cutoff)
    report["combined_early_wape_score"] = experiments.combined_score(pairs)
    report["combined_early_wape_score"] = max(0.0, report["combined_early_wape_score"])
    report["target_met"] = target_met(item["wape_score"] for item in report["slices"].values())
    report["delta_vs_incumbent"] = report["combined_early_wape_score"] - INCUMBENT_SCORE
    report["seconds"] = time.perf_counter() - started
    payload = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    report["sha256"] = hashlib.sha256(payload.encode()).hexdigest()
    (output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Evaluate a fixed candidate on early fixed-origin slices")
    parser.add_argument("--variant", choices=tuple(VARIANTS), default="profiles")
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args(argv)
    output_dir = args.output_dir or Path(f"artifacts/accuracy/{args.variant}")
    print(json.dumps(evaluate(args.data_dir, output_dir, args.variant), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
