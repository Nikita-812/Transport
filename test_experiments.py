import math
import pickle
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import experiments


def rows(days=42):
    result = []
    start = date(2025, 1, 1)
    for offset in range(days):
        day = start + timedelta(days=offset)
        for route in (1, 5):
            result.append({
                "route": route,
                "date": day,
                "hour": 8,
                "boardings": 0 if route == 5 else 10 + day.weekday(),
                "weekday": day.weekday(),
                "month": day.month,
                "is_weekend": int(day.weekday() >= 5),
                "is_holiday": 0,
                "is_workday": int(day.weekday() < 5),
                "is_preholiday": 0,
            })
    return result


class ExperimentsTest(unittest.TestCase):
    def test_combined_score_uses_ratio_of_sums_and_rejects_nonfinite_predictions(self):
        self.assertEqual(experiments.combined_score([(10, 100), (90, 300)]), 0.75)
        with self.assertRaisesRegex(ValueError, "finite"):
            experiments.validate_predictions([0.0, math.nan])

    def test_score_rejects_missing_predictions(self):
        with self.assertRaisesRegex(ValueError, "count"):
            experiments._score(rows(1), [10.0])

    def test_all_cpu_families_fit_predict_and_round_trip(self):
        sample = rows()
        train, validation = sample[:60], sample[60:]
        for name, factory in experiments.smoke_model_catalog().items():
            with self.subTest(name=name):
                model = factory()
                model.fit(experiments.feature_matrix(train), [row["boardings"] for row in train])
                expected = experiments.validate_predictions(model.predict(experiments.feature_matrix(validation)))
                actual = experiments.validate_predictions(pickle.loads(pickle.dumps(model)).predict(experiments.feature_matrix(validation)))
                self.assertEqual(len(actual), len(validation))
                self.assertTrue(all(value >= 0 for value in actual))
                for left, right in zip(expected, actual):
                    self.assertAlmostEqual(left, right)

    def test_window_seasonal_uses_only_recent_history(self):
        sample = rows(70)
        for row in sample:
            if row["route"] == 1:
                row["boardings"] = 10 if row["date"] < date(2025, 2, 12) else 30
        model = experiments.SeasonalWindowRegressor(days=28).fit(
            experiments.feature_matrix(sample), [row["boardings"] for row in sample]
        )
        prediction = model.predict(experiments.feature_matrix([sample[-2]]))[0]
        self.assertEqual(prediction, 30)

    def test_seasonal_median_and_decay_have_known_values(self):
        sample = rows(3)[::2]
        for row, value in zip(sample, (0, 10, 100)):
            row["boardings"] = value
            row["weekday"] = 0
        features = experiments.feature_matrix(sample)
        median_model = experiments.SeasonalWindowRegressor(statistic="median").fit(features, (0, 10, 100))
        decay_model = experiments.SeasonalWindowRegressor(half_life=1).fit(features, (0, 10, 100))
        self.assertEqual(median_model.predict(features[-1:])[0], 10)
        self.assertAlmostEqual(decay_model.predict(features[-1:])[0], 60)

    def test_common_postprocessing_keeps_zero_history_route_at_zero(self):
        sample = rows()
        train, validation = sample[:60], [row for row in sample[60:] if row["route"] == 5]
        predictions = experiments._fit_predict(experiments.smoke_model_catalog()["ridge"], train, validation)
        self.assertEqual(predictions, [0.0] * len(validation))

    def test_freeze_detects_tampering_before_late_check(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "freeze.json"
            experiments.write_freeze(path, [{"name": "winner", "early_wape_score": 0.9}], {"history_sha256": "abc"})
            self.assertEqual(experiments.load_freeze(path)["finalists"][0]["name"], "winner")
            payload = json.loads(path.read_text())
            payload["finalists"][0]["name"] = "changed"
            path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "hash"):
                experiments.load_freeze(path)

    def test_report_keeps_baseline_next_to_ranked_runs(self):
        report = {
            "runs": [
                {"name": "candidate", "early_wape_score": 0.9, "late_wape_score": 0.8, "slices": {}},
                {"name": "baseline", "early_wape_score": 0.7, "late_wape_score": 0.75, "slices": {}},
            ]
        }
        text = experiments.render_summary(report)
        self.assertIn("candidate", text)
        self.assertIn("0.90000", text)
        self.assertIn("baseline", text)
        self.assertIn("0.70000", text)
        self.assertIn("не является независимым", text)

    def test_report_renders_null_scores(self):
        text = experiments.render_summary({"runs": [{
            "name": "zero-target", "early_wape_score": None, "late_wape_score": None, "slices": {}
        }]})
        self.assertIn("| zero-target |", text)


if __name__ == "__main__":
    unittest.main()
