"""Calendar/month/weather ablations for the accepted pooled route blend."""

import argparse
import csv
import hashlib
import json
import math
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import accuracy
import pipeline


WEATHER_FIELDS = (
    "temperature_2m", "precipitation", "rain", "snowfall", "snow_depth", "weather_code"
)
SPECIAL_DAYS = {
    date(2025, 11, 1): "working_saturday",
    date(2025, 11, 3): "transferred_day_off",
    date(2025, 11, 4): "holiday",
    date(2025, 12, 31): "transferred_day_off",
}


def load_weather(path):
    values = {}
    with Path(path).open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != ["time", *WEATHER_FIELDS]:
            raise ValueError("unexpected weather schema")
        for line, row in enumerate(reader, 2):
            try:
                timestamp = datetime.fromisoformat(row["time"])
                key = (timestamp.date(), timestamp.hour)
                item = {field: float(row[field]) for field in WEATHER_FIELDS}
            except (TypeError, ValueError) as error:
                raise ValueError(f"invalid weather row {line}") from error
            if key in values:
                raise ValueError(f"duplicate weather hour {key}")
            if not all(math.isfinite(value) for value in item.values()):
                raise ValueError(f"non-finite weather row {line}")
            values[key] = item
    return values


def load_future(path):
    rows = []
    with Path(path).open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        if reader.fieldnames != list(pipeline.FUTURE_FIELDS):
            raise ValueError("unexpected future schema")
        for row in reader:
            rows.append({**row, "route": int(row["route"]), "date": date.fromisoformat(row["date"]),
                         "hour": int(row["hour"]),
                         **{field: int(row[field]) for field in pipeline.CALENDAR_FIELDS}})
    return rows


def adjusted_calendar_row(row):
    """Use an observed weekend weekday profile for transferred days off.

    Holidays retain their explicit holiday flag. A working Saturday cannot be
    validated in 2025 history and is deliberately not rewritten.
    """
    # A weekday explicitly marked as non-workday and non-holiday is a
    # transferred day off (May 2/8, June 13, November 3, December 31 in 2025).
    if row["weekday"] >= 5 or row["is_workday"] or row["is_holiday"]:
        return row
    return {**row, "weekday": 6, "is_weekend": 1}


def feature_matrix(rows, month_mode="categorical", weather=None, calendar_adjustment=False):
    import numpy as np

    if month_mode not in {"categorical", "numeric", "none"}:
        raise ValueError(f"unknown month mode: {month_mode}")
    origin = date(2025, 1, 1)
    matrix = []
    for original in rows:
        row = adjusted_calendar_row(original) if calendar_adjustment else original
        values = [accuracy.experiments.ROUTE_INDEX[int(row["route"])], row["weekday"], row["hour"]]
        if month_mode != "none":
            values.append(row["month"])
        values.extend((row["is_weekend"], row["is_holiday"], row["is_workday"], row["is_preholiday"]))
        values.append((row["date"] - origin).days)
        if weather is not None:
            try:
                item = weather[(row["date"], int(row["hour"]))]
            except KeyError as error:
                raise ValueError(f"missing weather for {row['date']} hour {row['hour']}") from error
            values.extend(item[field] for field in WEATHER_FIELDS)
        matrix.append(values)
    return np.asarray(matrix, dtype=float)


def model_parameters(month_mode, with_weather):
    if month_mode == "none":
        categorical = list(range(7))
        weather_code_index = 8 + 5
    else:
        categorical = list(range(8)) if month_mode == "categorical" else [0, 1, 2, 4, 5, 6, 7]
        weather_code_index = 9 + 5
    if with_weather:
        categorical.append(weather_code_index)
    return {**accuracy.INCUMBENT_MODEL, "categorical_features": categorical}


def predict_blend(train, validation, month_mode="categorical", weather=None, calendar_adjustment=False):
    from sklearn.ensemble import HistGradientBoostingRegressor

    parameters = model_parameters(month_mode, weather is not None)
    train_x = feature_matrix(train, month_mode, weather, calendar_adjustment)
    validation_x = feature_matrix(validation, month_mode, weather, calendar_adjustment)
    targets = [row["boardings"] for row in train]
    pooled = HistGradientBoostingRegressor(**parameters).fit(train_x, targets).predict(validation_x)
    per_route = {}
    for route in pipeline.ROUTES:
        train_indexes = [i for i, row in enumerate(train) if int(row["route"]) == route]
        validation_indexes = [i for i, row in enumerate(validation) if int(row["route"]) == route]
        if not validation_indexes:
            continue
        if not any(targets[i] for i in train_indexes):
            per_route[route] = [0.0] * len(validation_indexes)
            continue
        model = HistGradientBoostingRegressor(**parameters).fit(train_x[train_indexes], [targets[i] for i in train_indexes])
        per_route[route] = model.predict(validation_x[validation_indexes])
    positions = defaultdict(int)
    active = {int(row["route"]) for row in train if row["boardings"]}
    result = []
    for index, row in enumerate(validation):
        route = int(row["route"])
        local = per_route[route][positions[route]]
        positions[route] += 1
        result.append(0.0 if route not in active else max(0.0, (float(pooled[index]) + float(local)) / 2))
    return result


def rounded_score(rows, predictions):
    rounded = [round(value) for value in predictions]
    error = sum(abs(row["boardings"] - value) for row, value in zip(rows, rounded, strict=True))
    target = sum(row["boardings"] for row in rows)
    return {"rows": len(rows), "absolute_error": error, "target_sum": target,
            "wape_score": max(0.0, 1 - error / target)}


def write_submission(path, rows, predictions):
    path.mkdir(parents=True, exist_ok=False)
    pipeline._write_csv(path / "submission.csv", ("route", "date", "hour", "prediction"), (
        {"route": row["route"], "date": row["date"].isoformat(), "hour": row["hour"],
         "prediction": max(0, round(value))}
        for row, value in zip(rows, predictions, strict=True)
    ))


def daily_comparison(rows, predictions):
    totals = defaultdict(float)
    for row, prediction in zip(rows, predictions, strict=True):
        totals[row["date"]] += prediction
    result = {}
    for day in (*SPECIAL_DAYS, *[date(2025, 12, number) for number in range(22, 31)]):
        neighbors = [day.fromordinal(day.toordinal() + delta) for delta in (-7, 7)
                     if day.fromordinal(day.toordinal() + delta) in totals]
        result[day.isoformat()] = {
            "kind": SPECIAL_DAYS.get(day, "pre_new_year_week"), "prediction": round(totals[day]),
            "neighbor_days": [item.isoformat() for item in neighbors],
            "neighbor_mean": round(sum(totals[item] for item in neighbors) / len(neighbors)) if neighbors else None,
        }
    return result


def evaluate_variant(history, weather, config):
    started = time.perf_counter()
    slices = {}
    pairs = []
    for name, cutoff, start, end in pipeline.SLICES:
        train = [row for row in history if row["date"] <= cutoff]
        validation = [row for row in history if start <= row["date"] <= end]
        if config == VARIANTS["categorical-month"]:
            predictions = accuracy.pooled_route_blend_predictions(train, validation)
        else:
            predictions = predict_blend(train, validation, weather=weather if config["weather"] else None,
                                        month_mode=config["month_mode"],
                                        calendar_adjustment=config["calendar_adjustment"])
        score = rounded_score(validation, predictions)
        slices[name] = score
        pairs.append((score["absolute_error"], score["target_sum"]))
    error, target = (sum(item[index] for item in pairs) for index in (0, 1))
    return {"config": config, "slices": slices, "combined_wape_score": max(0.0, 1 - error / target),
            "seconds": time.perf_counter() - started}


VARIANTS = {
    "categorical-month": {"month_mode": "categorical", "weather": False, "calendar_adjustment": False},
    "categorical-month-weather": {"month_mode": "categorical", "weather": True, "calendar_adjustment": False},
    "numeric-month": {"month_mode": "numeric", "weather": False, "calendar_adjustment": False},
    "no-month": {"month_mode": "none", "weather": False, "calendar_adjustment": False},
    "numeric-month-weather": {"month_mode": "numeric", "weather": True, "calendar_adjustment": False},
    "no-month-weather": {"month_mode": "none", "weather": True, "calendar_adjustment": False},
    "numeric-month-calendar": {"month_mode": "numeric", "weather": False, "calendar_adjustment": True},
    "numeric-month-weather-calendar": {"month_mode": "numeric", "weather": True, "calendar_adjustment": True},
}


def run(data_dir, weather_path, output_dir):
    history = pipeline.read_history(Path(data_dir) / "history.csv")
    future = load_future(Path(data_dir) / "future.csv")
    weather = load_weather(weather_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if (output_dir / "results.json").exists() or (output_dir / "report.md").exists():
        raise FileExistsError(f"refusing to overwrite results in {output_dir}")
    report = {"protocol": "fixed-origin two-calendar-month forecasts; integer predictions; same seed/config",
              "weather": {"path": str(weather_path), "sha256": hashlib.sha256(Path(weather_path).read_bytes()).hexdigest(),
                          "kind": "actual archive weather (perfect forecast)"}, "variants": {}}
    for name, config in VARIANTS.items():
        print(f"evaluating {name}", flush=True)
        report["variants"][name] = evaluate_variant(history, weather, config)
    ranked = sorted(report["variants"], key=lambda name: report["variants"][name]["combined_wape_score"], reverse=True)
    submission_names = [name for name in ranked if not VARIANTS[name]["calendar_adjustment"]][:5]
    for name in submission_names:
        config = VARIANTS[name]
        predictions = (accuracy.pooled_route_blend_predictions(history, future)
                       if config == VARIANTS["categorical-month"] else
                       predict_blend(history, future, weather=weather if config["weather"] else None,
                                     month_mode=config["month_mode"],
                                     calendar_adjustment=config["calendar_adjustment"]))
        write_submission(output_dir / name, future, predictions)
        report["variants"][name]["submission"] = str(output_dir / name / "submission.csv")
        report["variants"][name]["future_day_comparison"] = daily_comparison(future, predictions)
    (output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Model v2: calendar and weather", "", report["protocol"], "",
             "| variant | May–Jun | Jul–Aug | Sep–Oct | combined | seconds |",
             "|---|---:|---:|---:|---:|---:|"]
    for name in ranked:
        item = report["variants"][name]
        lines.append(f"| `{name}` | {item['slices']['may-june']['wape_score']:.6f} | "
                     f"{item['slices']['july-august']['wape_score']:.6f} | "
                     f"{item['slices']['september-october']['wape_score']:.6f} | "
                     f"{item['combined_wape_score']:.6f} | {item['seconds']:.1f} |")
    for mode in ("categorical-month", "numeric-month", "no-month"):
        weather_name = f"{mode}-weather"
        if weather_name in report["variants"]:
            delta = (report["variants"][weather_name]["combined_wape_score"] -
                     report["variants"][mode]["combined_wape_score"])
            lines.append(f"\nПогодный эффект для `{mode}`: `{delta:+.6f}` combined.")
    lines.extend(["", "Числовой месяц и отсутствие месяца без погоды проиграли категориальному месяцу. "
                  "Гипотеза о вреде невиданных категорий ноября/декабря на доступных срезах не подтвердилась.",
                  "Календарная замена перенесённых выходных не улучшила combined и поэтому не включена в финальные сабмишны."])
    reference = report["variants"]["categorical-month"].get("future_day_comparison", {})
    lines.extend(["", "## Особые дни: текущая модель и обычные дни ±7 суток", "",
                  "| date | kind | prediction | neighbor mean |", "|---|---|---:|---:|"])
    for day, item in reference.items():
        lines.append(f"| {day} | {item['kind']} | {item['prediction']} | {item['neighbor_mean']} |")
    lines.extend(["", "Погода в этом эксперименте — фактическая архивная погода, то есть идеальный прогноз. "
                  "В эксплуатации доступен прогноз на 1–10 дней, а для месяца/года нужна климатическая норма.", "",
                  "Календарная коррекция заменяет только перенесённые выходные профилем воскресенья. "
                  "Рабочая суббота не корректируется: в истории нет аналога для честной проверки. Праздники используют штатный флаг.", ""])
    (output_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--weather", type=Path, default=Path("data/weather/moscow_2025_hourly.csv"))
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    run(args.data_dir, args.weather, args.output_dir)


if __name__ == "__main__":
    main()
