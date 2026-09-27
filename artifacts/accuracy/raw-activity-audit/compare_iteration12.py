"""Prediction-only fixed 50/50 diagnostic for iterations 7 and 12."""
import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).with_name("iteration12-vs-iteration7.json")


def load(iteration, name):
    with (ROOT / "artifacts" / "accuracy" / iteration / f"{name}-predictions.csv").open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream, delimiter=";"))


def main():
    report, pairs = {"protocol": "saved early predictions only; fixed 50/50 average is diagnostic, not a selected weight"}, []
    for name in ("may-june", "july-august"):
        best, fare = load("iteration-7", name), load("iteration-12", name)
        keys = [(row["route"], row["date"], row["hour"], row["target"]) for row in best]
        if keys != [(row["route"], row["date"], row["hour"], row["target"]) for row in fare]:
            raise ValueError(f"{name}: saved predictions do not align")
        residuals = [(float(a["prediction"]) - float(a["target"]), float(b["prediction"]) - float(b["target"])) for a, b in zip(best, fare)]
        nonzero = [(left, right) for left, right in residuals if left and right]
        blend = [(float(a["prediction"]) + float(b["prediction"])) / 2 for a, b in zip(best, fare)]
        error = sum(abs(float(row["target"]) - value) for row, value in zip(best, blend))
        target = sum(float(row["target"]) for row in best)
        report[name] = {"residual_sign_agreement": sum(left * right > 0 for left, right in nonzero) / len(nonzero),
                        "nonzero_residual_pairs": len(nonzero),
                        "fixed_50_50": {"absolute_error": error, "target_sum": target, "wape_score": 1 - error / target}}
        pairs.append((error, target))
    report["fixed_50_50_combined_wape_score"] = 1 - sum(error for error, _ in pairs) / sum(target for _, target in pairs)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
