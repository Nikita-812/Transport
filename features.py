"""Leakage-safe feature construction for fixed-origin tram forecasts."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, timedelta

from pipeline import CALENDAR_FIELDS, calendar_features


PROFILE_WEEKS = (4, 8, 12)


def _mean(values):
    return sum(values) / len(values) if values else None


def history_index(rows, cutoff):
    """Index only observations visible at *cutoff*."""
    index = defaultdict(list)
    route_values = defaultdict(list)
    for row in rows:
        if row["date"] <= cutoff:
            key = (int(row["route"]), int(row["hour"]), int(row["date"].weekday()))
            value = float(row["boardings"])
            index[key].append((row["date"], value))
            route_values[int(row["route"])].append((row["date"], value))
    return index, route_values


def feature_row(rows, origin, route, target_date, hour, calendar):
    """Build features whose statistics cannot see past ``origin``."""
    if target_date <= origin:
        raise ValueError("target_date must be after origin")
    index, route_values = history_index(rows, origin)
    values = index.get((int(route), int(hour), target_date.weekday()), [])
    route_history = route_values.get(int(route), [])
    result = {
        "route": int(route),
        "hour": int(hour),
        "horizon_days": (target_date - origin).days,
        **calendar_features(target_date, calendar),
    }
    for weeks in PROFILE_WEEKS:
        start = origin - timedelta(days=7 * weeks - 1)
        window = [value for day, value in values if start <= day <= origin]
        result[f"profile_mean_{weeks}w"] = _mean(window)
        result[f"profile_count_{weeks}w"] = len(window)
    route_hour = [v for _, v in values]
    route_only = [v for _, v in route_history]
    fallback = _mean(route_hour)
    if fallback is None:
        fallback = _mean(route_only)
    result["profile_fallback"] = fallback or 0.0
    recent_start = origin - timedelta(days=27)
    previous_start = origin - timedelta(days=55)
    recent = [v for d, v in values if recent_start <= d <= origin]
    previous = [v for d, v in values if previous_start <= d < recent_start]
    recent_mean = _mean(recent)
    previous_mean = _mean(previous)
    result["recent_level"] = recent_mean if recent_mean is not None else result["profile_fallback"]
    result["recent_change"] = (
        result["recent_level"] - previous_mean if previous_mean is not None else 0.0
    )
    for weeks in PROFILE_WEEKS:
        key = f"profile_mean_{weeks}w"
        if result[key] is None:
            result[key] = result["profile_fallback"]
    if any(not math.isfinite(float(v)) for v in result.values() if isinstance(v, (int, float))):
        raise ValueError("non-finite feature")
    return result


def historical_origins(rows, cutoff, min_history_days=28, step_days=7):
    start = min(row["date"] for row in rows)
    current = start + timedelta(days=min_history_days - 1)
    while current < cutoff:
        yield current
        current += timedelta(days=step_days)


def origin_examples(rows, cutoff, calendar, max_horizon=62):
    """Return origin-expanded examples and inverse-repeat target weights."""
    target_lookup = {
        (int(r["route"]), r["date"], int(r["hour"])): float(r["boardings"])
        for r in rows if r["date"] <= cutoff
    }
    examples = []
    for origin in historical_origins(rows, cutoff):
        end = min(cutoff, origin + timedelta(days=max_horizon))
        for (route, day, hour), target in target_lookup.items():
            if origin < day <= end:
                item = feature_row(rows, origin, route, day, hour, calendar)
                item.update({"origin": origin, "target_date": day, "target": target})
                examples.append(item)
    repetitions = Counter((r["route"], r["target_date"], r["hour"]) for r in examples)
    for row in examples:
        row["weight"] = 1.0 / repetitions[(row["route"], row["target_date"], row["hour"])]
    return examples


def inner_split(rows, outer_cutoff, days=28):
    inner_start = outer_cutoff - timedelta(days=days - 1)
    train = [r for r in rows if r["date"] < inner_start]
    validation = [r for r in rows if inner_start <= r["date"] <= outer_cutoff]
    return train, validation, inner_start - timedelta(days=1)


def combined_wape(metrics_by_slice):
    target = sum(item["overall"]["target_sum"] for item in metrics_by_slice)
    error = sum(item["overall"]["absolute_error"] for item in metrics_by_slice)
    return error / target if target else None


def postprocess(predictions, rows, cutoff):
    active = defaultdict(float)
    for row in rows:
        if row["date"] <= cutoff:
            active[int(row["route"])] += float(row["boardings"])
    result = []
    for route, value in predictions:
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("prediction must be finite")
        result.append(0.0 if active[int(route)] == 0 else max(0.0, value))
    return result
