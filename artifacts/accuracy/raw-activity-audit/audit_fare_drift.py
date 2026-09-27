"""Cutoff-local fare-mix drift audit; no forecast labels or horizon fares enter it."""
import csv
import hashlib
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "data" / "processed" / "raw_fares.csv"
METADATA = SOURCE.with_suffix(".metadata.json")
OUTPUT = Path(__file__).with_name("fare-drift.json")
CUTOFFS = (date(2025, 4, 30), date(2025, 6, 30))
TOP_K = 8


def fare_key(row):
    return row["good_type"], row["good_type_missing"]


def fare_label(key):
    return {"good_type": key[0], "good_type_missing": key[1]}


def visible(rows, cutoff):
    return [row for row in rows if row["date"] <= cutoff]


def top_groups(rows):
    totals = defaultdict(int)
    for row in rows:
        totals[fare_key(row)] += row["boardings"]
    kept = [key for key, _ in sorted(totals.items(), key=lambda item: (-item[1], item[0]))[:TOP_K]]
    return kept


def shares(rows, kept):
    totals = defaultdict(int)
    for row in rows:
        key = fare_key(row)
        totals[key if key in kept else None] += row["boardings"]
    total = sum(totals.values())
    return {key: totals[key] / total if total else 0.0 for key in [*kept, None]}


def total_variation(left, right):
    return sum(abs(left[key] - right[key]) for key in left) / 2


def pair(rows, end, kept):
    recent_start = end - timedelta(days=27)
    prior_end = recent_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=27)
    recent = [row for row in rows if recent_start <= row["date"] <= end]
    prior = [row for row in rows if prior_start <= row["date"] <= prior_end]
    left, right = shares(recent, kept), shares(prior, kept)
    return {"recent_window": [recent_start.isoformat(), end.isoformat()], "prior_window": [prior_start.isoformat(), prior_end.isoformat()],
            "total_variation": total_variation(left, right),
            "signed_share_shifts": [{**fare_label(key), "shift": left[key] - right[key]} for key in [*kept, None] if key is not None] + [{"group": "OTHER", "shift": left[None] - right[None]}]}


def self_check():
    cutoff = date(2025, 1, 31)
    records = [
        {"date": cutoff, "good_type": "a", "good_type_missing": 0, "boardings": 8},
        {"date": cutoff, "good_type": "b", "good_type_missing": 0, "boardings": 2},
        {"date": cutoff + timedelta(days=1), "good_type": "future", "good_type_missing": 0, "boardings": 1_000_000},
    ]
    past = visible(records, cutoff)
    assert {fare_key(row) for row in past} == {("a", 0), ("b", 0)}
    assert math.isclose(total_variation({"a": 0.8, "b": 0.2}, {"a": 0.2, "b": 0.8}), 0.6)


def main():
    self_check()
    with SOURCE.open(encoding="utf-8", newline="") as stream:
        rows = [{"route": int(row["route"]), "date": date.fromisoformat(row["date"]), "good_type": row["good_type"],
                 "good_type_missing": int(row["good_type_missing"]), "boardings": int(row["boardings"])}
                for row in csv.DictReader(stream, delimiter=";")]
    report = {"protocol": "each route's top-8-plus-other groups and every compared window use rows at or before the fixed cutoff",
              "raw_fares_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              "raw_fares_metadata_sha256": hashlib.sha256(METADATA.read_bytes()).hexdigest(), "cutoffs": {}}
    first_day = min(row["date"] for row in rows)
    for cutoff in CUTOFFS:
        by_route = defaultdict(list)
        for row in visible(rows, cutoff):
            by_route[row["route"]].append(row)
        routes = {}
        for route, route_rows in sorted(by_route.items()):
            kept = top_groups(route_rows)
            current = pair(route_rows, cutoff, kept)
            historic = []
            end = cutoff - timedelta(days=28)
            while end - timedelta(days=55) >= first_day:
                historic.append(pair(route_rows, end, kept))
                end -= timedelta(days=28)
            historic_values = [item["total_variation"] for item in historic]
            routes[str(route)] = {"kept_fares": [fare_label(key) for key in kept], "current": current,
                                  "historic_adjacent_windows": historic,
                                  "historic_count": len(historic_values),
                                  "historic_max": max(historic_values, default=None),
                                  "historic_at_least_current_count": sum(value >= current["total_variation"] for value in historic_values)}
        report["cutoffs"][cutoff.isoformat()] = {"route_rank_by_current_tv": [route for route, _ in sorted(routes.items(), key=lambda item: item[1]["current"]["total_variation"], reverse=True)], "routes": routes}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
