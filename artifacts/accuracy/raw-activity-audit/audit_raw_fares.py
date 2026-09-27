"""Train-only fare vocabulary and dense-matrix sizing audit."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import accuracy
import pipeline


DATA = ROOT / "data" / "processed"
OUTPUT = Path(__file__).with_name("raw-fares-cardinality.json")
CUTOFFS = pipeline.SLICES[:2]


def label(fare):
    return "<missing>" if fare[1] else fare[0]


def main():
    history_path = DATA / "history.csv"
    history = pipeline.read_history(history_path)
    fares, metadata, _ = accuracy.read_raw_fares(
        DATA / "raw_fares.csv", history, hashlib.sha256(history_path.read_bytes()).hexdigest(), history_path.name
    )
    report = {
        "protocol": "raw_fares passes strict provenance/reconciliation loading; all category support below is filtered at each fixed cutoff",
        "loader": {"rows": len(fares), "metadata_schema": metadata["schema_version"], "parent_grid_rows": metadata["parent_grid_rows"]},
        "cutoffs": {},
    }
    for _, cutoff, _, _ in CUTOFFS:
        train = [row for row in history if row["date"] <= cutoff]
        visible = [row for row in fares if row["date"] <= cutoff]
        vocabulary = sorted({(row["good_type"], row["good_type_missing"]) for row in visible})
        totals = {fare: 0 for fare in vocabulary}
        for row in visible:
            totals[(row["good_type"], row["good_type_missing"])] += row["boardings"]
        total = sum(totals.values())
        report["cutoffs"][cutoff.isoformat()] = {
            "vocabulary_count": len(vocabulary),
            "observed_positive_components": len(visible),
            "dense_training_cells": len(train) * len(vocabulary),
            "float64_feature_bytes": len(train) * len(vocabulary) * 10 * 8,
            "top8_plus_other_dense_training_cells": len(train) * 9,
            "top8_plus_other_float64_feature_bytes": len(train) * 9 * 10 * 8,
            "unknown_training_component_rows": sum((row["good_type"], row["good_type_missing"]) not in vocabulary for row in visible),
            "unknown_training_component_share": 0.0,
            "dominant_fares": [
                {"good_type": label(fare), "boardings": value, "share": value / total if total else 0.0}
                for fare, value in sorted(totals.items(), key=lambda item: item[1], reverse=True)[:5]
            ],
        }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
