"""Measure weather effects from fixed-origin forecasts without weather features."""

import argparse
import json
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import accuracy
import model_v2
import pipeline


SOURCE_URL = "https://open-meteo.com/en/docs/historical-weather-api"
DEFAULT_BOOTSTRAP_ITERATIONS = 10_000
DEFAULT_SEED = 42


@dataclass(frozen=True)
class Category:
    name: str
    label_ru: str

    def matches(self, weather):
        if self.name == "no_precipitation":
            return weather["precipitation"] == 0
        if self.name == "rain":
            return weather["rain"] > 0.2
        if self.name == "snowfall":
            return weather["snowfall"] > 0
        if self.name == "frost_below_minus_10":
            return weather["temperature_2m"] < -10
        if self.name == "frost_below_minus_20":
            return weather["temperature_2m"] < -20
        if self.name == "heat_above_25":
            return weather["temperature_2m"] > 25
        raise ValueError(f"unknown weather category: {self.name}")


CATEGORIES = (
    Category("no_precipitation", "Без осадков (база)"),
    Category("rain", "Дождь (> 0,2 мм/ч)"),
    Category("snowfall", "Снегопад"),
    Category("frost_below_minus_10", "Мороз ниже −10 °C"),
    Category("frost_below_minus_20", "Мороз ниже −20 °C"),
    Category("heat_above_25", "Жара выше +25 °C"),
)
BASE_CATEGORY = CATEGORIES[0].name


def build_hourly_observations(slice_name, rows, predictions, weather):
    """Aggregate route-level targets and predictions to Moscow clock hours."""
    if len(rows) != len(predictions):
        raise ValueError("prediction count does not match validation rows")
    totals = defaultdict(lambda: [0.0, 0.0])
    for row, prediction in zip(rows, predictions, strict=True):
        key = (row["date"], int(row["hour"]))
        totals[key][0] += float(row["boardings"])
        totals[key][1] += float(prediction)
    observations = []
    for (day, hour), (actual, prediction) in sorted(totals.items()):
        try:
            hour_weather = weather[(day, hour)]
        except KeyError as error:
            raise ValueError(f"missing weather for {day} hour {hour}") from error
        observations.append({
            "slice": slice_name,
            "date": day,
            "hour": hour,
            "actual": actual,
            "prediction": prediction,
            "weather": hour_weather,
        })
    return observations


def _daily_category_totals(observations):
    totals = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    for observation in observations:
        day_key = (observation["slice"], observation["date"])
        for category in CATEGORIES:
            if category.matches(observation["weather"]):
                values = totals[day_key][category.name]
                values[0] += observation["actual"]
                values[1] += observation["prediction"]
                values[2] += 1
    return totals


def _aggregate_sample(daily_totals, sampled_days):
    by_slice = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0]))
    for day_key in sampled_days:
        slice_name, _ = day_key
        for category, values in daily_totals[day_key].items():
            target = by_slice[slice_name][category]
            target[0] += values[0]
            target[1] += values[1]
            target[2] += values[2]
    return by_slice


def _normalized_multipliers(by_slice):
    numerators = defaultdict(float)
    denominators = defaultdict(float)
    hours = defaultdict(int)
    for category_totals in by_slice.values():
        base_actual, base_prediction, _ = category_totals[BASE_CATEGORY]
        if base_prediction <= 0:
            continue
        base_ratio = base_actual / base_prediction
        for category in CATEGORIES:
            actual, prediction, count = category_totals[category.name]
            numerators[category.name] += actual
            denominators[category.name] += prediction * base_ratio
            hours[category.name] += count
    multipliers = {
        category.name: (
            numerators[category.name] / denominators[category.name]
            if denominators[category.name] > 0 else None
        )
        for category in CATEGORIES
    }
    return multipliers, hours


def _percentile(values, probability):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def _rounded(value):
    return round(value, 6) if value is not None else None


def estimate_effects(observations, bootstrap_iterations=DEFAULT_BOOTSTRAP_ITERATIONS, seed=DEFAULT_SEED):
    if bootstrap_iterations < 1:
        raise ValueError("bootstrap_iterations must be positive")
    daily_totals = _daily_category_totals(observations)
    days_by_slice = defaultdict(list)
    for day_key in sorted(daily_totals):
        days_by_slice[day_key[0]].append(day_key)
    point, hours = _normalized_multipliers(_aggregate_sample(daily_totals, daily_totals))

    rng = random.Random(seed)
    samples = defaultdict(list)
    for _ in range(bootstrap_iterations):
        sampled_days = []
        for days in days_by_slice.values():
            sampled_days.extend(rng.choices(days, k=len(days)))
        multipliers, _ = _normalized_multipliers(_aggregate_sample(daily_totals, sampled_days))
        for category, value in multipliers.items():
            if value is not None:
                samples[category].append(value)

    result = []
    for category in CATEGORIES:
        value = point[category.name]
        result.append({
            "category": category.name,
            "label_ru": category.label_ru,
            "multiplier": _rounded(value),
            "ci_low": _rounded(_percentile(samples[category.name], 0.025)),
            "ci_high": _rounded(_percentile(samples[category.name], 0.975)),
            "hours": hours[category.name],
            "enough_data": hours[category.name] >= 50,
        })
    return result


def run(data_dir, weather_path, output_path, bootstrap_iterations=DEFAULT_BOOTSTRAP_ITERATIONS, seed=DEFAULT_SEED):
    history = pipeline.read_history(Path(data_dir) / "history.csv")
    weather = model_v2.load_weather(weather_path)
    observations = []
    periods = []
    for name, cutoff, start, end in pipeline.SLICES:
        train = [row for row in history if row["date"] <= cutoff]
        validation = [row for row in history if start <= row["date"] <= end]
        model_rows = [{key: value for key, value in row.items() if key != "boardings"} for row in validation]
        predictions = accuracy.pooled_route_blend_predictions(train, model_rows)
        observations.extend(build_hourly_observations(name, validation, predictions, weather))
        periods.append({
            "name": name,
            "train_through": cutoff.isoformat(),
            "start": start.isoformat(),
            "end": end.isoformat(),
        })

    result = {
        "source_url": SOURCE_URL,
        "period": {
            "start": min(item["date"] for item in observations).isoformat(),
            "end": max(item["date"] for item in observations).isoformat(),
            "slices": periods,
        },
        "model": "pooled_route_blend",
        "method": (
            "For each fixed-origin slice, sum actual and raw out-of-sample predictions by weather category; "
            "divide the category actual/prediction ratio by the no-precipitation ratio from the same slice; "
            "pool slices using category forecast volume."
        ),
        "bootstrap": {
            "unit": "day, resampled independently within each slice",
            "iterations": bootstrap_iterations,
            "confidence": 0.95,
            "seed": seed,
        },
        "effects": estimate_effects(observations, bootstrap_iterations, seed),
    }
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--weather", type=Path, default=Path("data/weather/moscow_2025_hourly.csv"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("weather_effects.json"))
    parser.add_argument("--bootstrap-iterations", type=int, default=DEFAULT_BOOTSTRAP_ITERATIONS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args(argv)
    result = run(args.data_dir, args.weather, args.output, args.bootstrap_iterations, args.seed)
    # ASCII escapes keep the command usable in legacy Windows console encodings.
    print(json.dumps(result["effects"], ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
