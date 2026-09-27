"""Repair only iteration-11's fare diagnostic totals; never fit or predict."""
import copy
import hashlib
import json
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import accuracy
import pipeline


RESULTS = Path(__file__).with_name("results.json")
OUTPUT = Path(__file__).with_name("results-corrected.json")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def report_hash(report):
    payload = dict(report)
    payload.pop("sha256", None)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    original_bytes = RESULTS.read_bytes()
    original = json.loads(original_bytes)
    raw = original["raw_fares"]
    raw_path = ROOT / raw["path"]
    metadata_path = ROOT / raw["metadata_path"]
    if sha256(raw_path) != raw["sha256"] or sha256(metadata_path) != raw["metadata_sha256"]:
        raise ValueError("raw fare files no longer match the measured iteration-11 provenance")
    history_path = ROOT / "data/processed/history.csv"
    if sha256(history_path) != original["history_sha256"]:
        raise ValueError("history no longer matches the measured iteration-11 provenance")
    history = pipeline.read_history(history_path)
    fares, _, _ = accuracy.read_raw_fares(raw_path, history, original["history_sha256"], history_path.name)
    corrected = copy.deepcopy(original)
    changed = 0
    for slice_report in corrected["slices"].values():
        cutoff = date.fromisoformat(slice_report["cutoff"])
        totals = {}
        for row in fares:
            if row["date"] <= cutoff:
                key = (row["good_type"], row["good_type_missing"])
                totals[key] = totals.get(key, 0) + row["boardings"]
        expected = [fare for fare, _ in sorted(totals.items(), key=lambda item: (-item[1], item[0]))[:8]]
        diagnostics = slice_report["fare_components"]
        kept = [(item["good_type"], item["good_type_missing"]) for item in diagnostics["kept_fares"]]
        if kept != expected:
            raise ValueError("saved kept-fare labels do not match the measured cutoff-local ranking")
        other_total = sum(value for fare, value in totals.items() if fare not in set(kept))
        if diagnostics["other"]["boardings"] != other_total:
            raise ValueError("saved OTHER total is not reproducible from the measured raw fares")
        for item in diagnostics["kept_fares"]:
            item["boardings"] = totals[(item["good_type"], item["good_type_missing"])]
            changed += 1
    corrected["sha256"] = report_hash(corrected)
    envelope = {
        "kind": "reporting_only_correction",
        "original_report_sha256": original["sha256"],
        "original_results_file_sha256": hashlib.sha256(original_bytes).hexdigest(),
        "correction_code_sha256": sha256(__file__),
        "provenance": {"history_sha256": original["history_sha256"], "raw_fares_sha256": raw["sha256"], "raw_fares_metadata_sha256": raw["metadata_sha256"]},
        "changed_kept_fare_boarding_fields": changed,
        "corrected_report_sha256": corrected["sha256"],
        "corrected_report": corrected,
    }
    OUTPUT.write_text(json.dumps(envelope, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
