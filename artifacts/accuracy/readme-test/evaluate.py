"""Run from repository root: python3 artifacts/accuracy/readme-test/evaluate.py."""
import csv
import hashlib
import io
import json
import math
import platform
import sys
import time
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import accuracy
import pipeline
import sklearn
from threadpoolctl import threadpool_limits

OUT = Path(__file__).parent
FIELDS = ("route", "date", "hour", "prediction")


def key(row):
    return int(row["route"]), date.fromisoformat(str(row["date"])), int(row["hour"])


def write_and_validate(path, rows, predictions, start, end):
    assert len(rows) == len(predictions)
    assert all(math.isfinite(p) and p >= 0 for p in predictions)
    pipeline._write_csv(path, FIELDS, (
        {**{field: row[field] for field in FIELDS[:3]}, "prediction": round(prediction)}
        for row, prediction in zip(rows, predictions, strict=True)
    ))
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        assert reader.fieldnames == list(FIELDS)
        saved = list(reader)
    keys = [key(row) for row in saved]
    assert len(keys) == len(set(keys))
    assert set(keys) == pipeline._expected_keys(start, end)
    assert all(str(key(row)[1]) == row["date"] for row in saved)
    assert all(int(row["prediction"]) >= 0 for row in saved)
    return saved


def score(saved, truth):
    assert {key(row) for row in saved} == set(truth)
    error = sum(abs(truth[key(row)] - int(row["prediction"])) for row in saved)
    total = sum(truth.values())
    assert total > 0, "WAPE is undefined for an all-zero target"
    return {"rows": len(saved), "absolute_error": error, "target_sum": total,
            "wape": error / total, "wape_score": max(0.0, 1 - error / total)}


def main():
    # Small runnable metric check: zeros, weighting, and clipping at zero.
    toy = [{"route": 1, "date": "2025-09-01", "hour": h, "prediction": p}
           for h, p in enumerate((2, 8))]
    assert score(toy, {key(toy[0]): 0, key(toy[1]): 10})["wape_score"] == 0.6
    assert score(toy, {key(toy[0]): 0, key(toy[1]): 1})["wape_score"] == 0

    started = time.perf_counter()
    history = pipeline.read_history(ROOT / "data/processed/history.csv")
    assert len(history) == len({key(row) for row in history}) == 72960
    assert {key(row) for row in history} == pipeline._expected_keys(date(2025, 1, 1), pipeline.HISTORY_END)
    with zipfile.ZipFile(ROOT / "Archive (1).zip") as archive:
        labels = {}
        for member, start, end in pipeline.LABEL_MEMBERS:
            values, _ = pipeline.read_labels(archive, member, start, end)
            labels.update(values)
        assert all(row["boardings"] == labels.get(key(row), 0) for row in history)
        pipeline.read_submission_keys(archive)
        template = list(csv.DictReader(io.StringIO(archive.read("test_submission.csv").decode("utf-8-sig")), delimiter=";"))

    report = {
        "candidate": accuracy.POOLED_ROUTE_BLEND_CONFIG,
        "protocol": "Fixed-origin two-month forecasts, no refitting within horizon; same WAPE formula as archive README; integer CSV predictions.",
        "rounding": "Python round: nearest integer, ties to even; organizer tie rule is unspecified",
        "limitations": ["November-December ground truth unavailable; official score unknown.",
                        "Early slices used for model selection; September-October previously examined in EDA.",
                        "Official baseline ~0.48 is on a different, hidden period and cannot be directly compared."],
        "versions": {"python": platform.python_version(), "sklearn": sklearn.__version__},
        "sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                   for name in ("accuracy.py", "experiments.py", "pipeline.py", "calendar_2025.json", "data/processed/history.csv")},
        "slices": {},
    }
    for name, cutoff, start, end in pipeline.SLICES:
        train = [row for row in history if row["date"] <= cutoff]
        validation = [row for row in history if start <= row["date"] <= end]
        features = [{k: v for k, v in row.items() if k != "boardings"} for row in validation]
        predictions = accuracy.pooled_route_blend_predictions(train, features)
        saved = write_and_validate(OUT / f"{name}.csv", features, predictions, start, end)
        truth = {key(row): row["boardings"] for row in validation}
        result = score(saved, truth)
        scored = [{**row, "prediction": int(pred["prediction"])} for row, pred in zip(validation, saved, strict=True)]
        assert pipeline.metric(scored) == result
        raw = pipeline.metric({**row, "prediction": p} for row, p in zip(validation, predictions, strict=True))
        report["slices"][name] = {"cutoff": str(cutoff), "horizon": [str(start), str(end)],
                                  **result, "unrounded": raw, "breakdown": pipeline.build_metrics(scored)}
        print(name, json.dumps(result), flush=True)

    early = [report["slices"][name] for name, *_ in pipeline.SLICES[:2]]
    report["combined_early"] = {"wape": sum(s["absolute_error"] for s in early) / sum(s["target_sum"] for s in early)}
    report["combined_early"]["wape_score"] = max(0, 1 - report["combined_early"]["wape"])
    calendar = pipeline.load_calendar(ROOT / "calendar_2025.json")
    future = [{"route": key(row)[0], "date": key(row)[1], "hour": key(row)[2],
               **pipeline.calendar_features(key(row)[1], calendar)} for row in template]
    predictions = accuracy.pooled_route_blend_predictions(history, future)
    saved = write_and_validate(OUT / "submission.csv", future, predictions, pipeline.FUTURE_START, pipeline.FUTURE_END)
    assert [key(row) for row in saved] == [key(row) for row in template]
    report["submission"] = {"rows": len(saved), "format_valid": True, "template_order_preserved": True,
                            "official_wape_score": None, "sha256": hashlib.sha256((OUT / "submission.csv").read_bytes()).hexdigest()}
    report["seconds"] = time.perf_counter() - started
    (OUT / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("combined_early", "submission", "seconds")}, indent=2))


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
