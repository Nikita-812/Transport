"""Train-only operational-signal audit for the fixed early forecast origins."""
import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "data/processed/raw_activity.csv"
OUTPUT = Path(__file__).with_name("results.json")
FIELDS = ("events", "active_vehicles", "active_exits", "active_devices")
CUTOFFS = (date(2025, 4, 30), date(2025, 6, 30))


def mean(values):
    return sum(values) / len(values) if values else 0.0


def load():
    with SOURCE.open(encoding="utf-8", newline="") as stream:
        return [
            {"route": int(row["route"]), "date": date.fromisoformat(row["date"]),
             "boardings": int(row["boardings"]), **{field: int(row[field]) for field in FIELDS}}
            for row in csv.DictReader(stream, delimiter=";")
        ]


def window(rows, start, end):
    return [row for row in rows if start <= row["date"] <= end]


def describe(rows):
    by_route = defaultdict(list)
    for row in rows:
        by_route[row["route"]].append(row)
    result = {}
    for route, values in sorted(by_route.items()):
        summary = {}
        eventful = [row for row in values if row["events"]]
        for field in FIELDS:
            counts = [row[field] for row in values]
            summary[field] = {"mean": mean(counts), "min": min(counts), "max": max(counts)}
            if field != "events":
                summary[field]["zero_when_eventful_fraction"] = (
                    sum(not row[field] for row in eventful) / len(eventful) if eventful else 0.0
                )
        result[str(route)] = summary
    return result


def denominator_audit(rows):
    by_route = defaultdict(list)
    for row in rows:
        by_route[row["route"]].append(row)
    result = {}
    for route, values in sorted(by_route.items()):
        devices = sorted(row["boardings"] / row["active_devices"] for row in values if row["active_devices"])
        result[str(route)] = {
            "positive_boardings_with_zero_devices": sum(row["boardings"] > 0 and not row["active_devices"] for row in values),
            "positive_boardings_with_zero_vehicles": sum(row["boardings"] > 0 and not row["active_vehicles"] for row in values),
            "boardings_with_zero_devices": sum(row["boardings"] for row in values if not row["active_devices"]),
            "density_per_device": {
                "median": median(devices) if devices else 0.0,
                "p95": devices[int(0.95 * (len(devices) - 1))] if devices else 0.0,
                "max": devices[-1] if devices else 0.0,
            },
        }
    return result


def main():
    rows = load()
    report = {"protocol": "each cutoff uses only rows dated at or before it; 28-day windows contain four of each weekday"}
    for cutoff in CUTOFFS:
        recent_start = cutoff - timedelta(days=27)
        prior_end = recent_start - timedelta(days=1)
        prior_start = prior_end - timedelta(days=27)
        recent, prior = window(rows, recent_start, cutoff), window(rows, prior_start, prior_end)
        recent_summary, prior_summary = describe(recent), describe(prior)
        deltas = {
            route: {field: recent_summary[route][field]["mean"] - prior_summary[route][field]["mean"] for field in FIELDS}
            for route in recent_summary
        }
        report[cutoff.isoformat()] = {
            "recent_window": [recent_start.isoformat(), cutoff.isoformat()],
            "prior_window": [prior_start.isoformat(), prior_end.isoformat()],
            "recent": recent_summary, "mean_28_minus_prior_28": deltas,
            "density_denominator_audit": denominator_audit(window(rows, date(2025, 1, 1), cutoff)),
        }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
