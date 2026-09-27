"""Prediction-only diagnostic for fixed iteration 7 versus iteration 10."""
import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).with_name("iteration10-vs-iteration7.json")
SLICES = ("may-june", "july-august")


def load(iteration, name):
    with (ROOT / "artifacts" / "accuracy" / iteration / f"{name}-predictions.csv").open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream, delimiter=";"))


def score(rows, predictions):
    target = sum(float(row["target"]) for row in rows)
    error = sum(abs(float(row["target"]) - value) for row, value in zip(rows, predictions))
    return {"absolute_error": error, "target_sum": target, "wape_score": 1 - error / target}


def main():
    report, pairs = {"protocol": "saved early predictions only; fixed 50/50 average is diagnostic, not a selected weight"}, []
    for name in SLICES:
        best, density = load("iteration-7", name), load("iteration-10", name)
        keys = [(row["route"], row["date"], row["hour"], row["target"]) for row in best]
        if keys != [(row["route"], row["date"], row["hour"], row["target"]) for row in density]:
            raise ValueError(f"{name}: saved predictions do not align")
        best_values = [float(row["prediction"]) for row in best]
        density_values = [float(row["prediction"]) for row in density]
        residuals = [(left - float(row["target"]), right - float(row["target"])) for row, left, right in zip(best, best_values, density_values)]
        nonzero = [(left, right) for left, right in residuals if left and right]
        route_errors = defaultdict(lambda: [0.0, 0.0])
        for row, left, right in zip(best, best_values, density_values):
            route_errors[row["route"]][0] += abs(float(row["target"]) - left)
            route_errors[row["route"]][1] += abs(float(row["target"]) - right)
        blend = [(left + right) / 2 for left, right in zip(best_values, density_values)]
        blend_score = score(best, blend)
        pairs.append((blend_score["absolute_error"], blend_score["target_sum"]))
        density_score = score(best, density_values)
        report[name] = {
            "residual_sign_agreement": sum(left * right > 0 for left, right in nonzero) / len(nonzero),
            "nonzero_residual_pairs": len(nonzero),
            "fixed_50_50": blend_score,
            "route_absolute_error": {
                route: {"iteration_7": errors[0], "iteration_10": errors[1], "iteration_10_minus_7": errors[1] - errors[0],
                        "iteration_10_share": errors[1] / density_score["absolute_error"]}
                for route, errors in sorted(route_errors.items())
            },
        }
    report["fixed_50_50_combined_wape_score"] = 1 - sum(error for error, _ in pairs) / sum(target for _, target in pairs)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
