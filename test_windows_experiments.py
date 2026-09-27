import copy
import csv
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import benchmark
import windows_experiments as experiments
import features
import pipeline
import windows_forecast_api as forecast_api
from models import WindowCandidate, create_candidate, load_candidate, save_candidate


class ExperimentContractsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest_path = Path(__file__).with_name("configs") / "experiments.windows.json"

    def tearDown(self):
        self.temp.cleanup()

    def test_manifest_rejects_duplicates_bad_phases_and_devices(self):
        value = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        for name, mutate, message in (
            ("duplicate", lambda x: x["runs"].append(copy.deepcopy(x["runs"][0])), "duplicate"),
            ("device", lambda x: x["runs"][0].update(device="linux"), "unknown device"),
            ("phase", lambda x: x["runs"][0].update(phase="later"), "unknown phase"),
        ):
            with self.subTest(name=name):
                changed = copy.deepcopy(value); mutate(changed); path = self.root / f"{name}.json"
                path.write_text(json.dumps(changed), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message): experiments.load_manifest(path)

    def test_random_search_is_reproducible_and_unique(self):
        first = experiments.random_search_configs(42, 20)
        self.assertEqual(first, experiments.random_search_configs(42, 20))
        self.assertEqual(len(first), len({experiments.canonical_hash(item) for item in first}))
        self.assertTrue({item["kind"] for item in first} >= {"xgboost", "extra_trees", "random_forest", "hist_gradient_boosting"})

    def test_origin_features_ignore_future_and_repeat_weights_sum_to_one(self):
        calendar = pipeline.load_calendar(Path(__file__).with_name("calendar_2025.json"))
        rows = []
        start = date(2025, 1, 1)
        for offset in range(70):
            day = start + timedelta(days=offset)
            rows.append({"route": 1, "date": day, "hour": 8, "boardings": offset + 1})
        origin = date(2025, 2, 15); target = date(2025, 2, 20)
        first = features.feature_row(rows, origin, 1, target, 8, calendar)
        changed = [dict(r, boardings=99999) if r["date"] > origin else r for r in rows]
        self.assertEqual(first, features.feature_row(changed, origin, 1, target, 8, calendar))
        examples = features.origin_examples(rows, date(2025, 3, 1), calendar, max_horizon=14)
        sums = {}
        for row in examples:
            key = (row["route"], row["target_date"], row["hour"]); sums[key] = sums.get(key, 0) + row["weight"]
        self.assertTrue(sums); self.assertTrue(all(abs(value - 1) < 1e-12 for value in sums.values()))
        self.assertTrue(all(row["target_date"] <= date(2025, 3, 1) for row in examples))

    def test_postprocess_finite_and_zero_route(self):
        rows = [{"route": 1, "date": date(2025, 1, 1), "boardings": 0}, {"route": 5, "date": date(2025, 1, 1), "boardings": 2}]
        self.assertEqual(features.postprocess([(1, 10), (5, -2)], rows, date(2025, 1, 1)), [0, 0])
        with self.assertRaisesRegex(ValueError, "finite"):
            features.postprocess([(5, float("nan"))], rows, date(2025, 1, 1))

    def test_window_predictions_and_pickle_roundtrip(self):
        rows = []
        for n, value in enumerate((2, 4, 8, 16)):
            day = date(2025, 1, 6) + timedelta(days=7*n)
            rows.append({"route": 1, "date": day, "hour": 8, "weekday": 0, "boardings": value})
        query = [{"route": 1, "date": date(2025, 2, 3), "hour": 8, "weekday": 0}]
        model = WindowCandidate(4, "mean").fit(rows)
        self.assertEqual(model.predict(query), [7.5])
        path = self.root / "model.pkl"; save_candidate(model, path, {"test": True}); loaded = load_candidate(path)
        self.assertEqual(loaded["candidate"].predict(query), [7.5])

    def test_combined_wape_is_ratio_of_sums(self):
        metrics = [{"overall": {"target_sum": 10, "absolute_error": 5}}, {"overall": {"target_sum": 90, "absolute_error": 9}}]
        self.assertEqual(features.combined_wape(metrics), .14)

    def test_percentiles_and_freeze_integrity(self):
        self.assertEqual(benchmark.percentiles([.001, .002, .003])["p95_ms"], 3)
        merge = self.root / "merge.json"; merge.write_text(json.dumps({"ranked": [{"run_id": "a", "wape": .1}]}), encoding="utf-8")
        frozen = self.root / "freeze.json"; experiments.freeze(merge, frozen)
        self.assertEqual(experiments.validate_freeze(frozen)["selected"], "a")
        changed = json.loads(frozen.read_text(encoding="utf-8")); changed["selected"] = "b"; frozen.write_text(json.dumps(changed), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "hash"):
            experiments.validate_freeze(frozen)

    def test_api_snapshot_contract(self):
        from fastapi.testclient import TestClient
        path = self.root / "forecast.csv"
        calendar = pipeline.load_calendar(Path(__file__).with_name("calendar_2025.json"))
        rows = []
        for route in pipeline.ROUTES:
            for day in pipeline.dates(pipeline.FUTURE_START, pipeline.FUTURE_END):
                for hour in range(24):
                    rows.append({"route": route, "date": day.isoformat(), "hour": hour, "prediction": route + hour})
        pipeline._write_csv(path, ("route", "date", "hour", "prediction"), rows)
        client = TestClient(forecast_api.create_app(path))
        self.assertTrue(client.get("/health").json()["ready"])
        response = client.get("/forecasts", params={"route": 17, "start_date": "2025-11-03", "end_date": "2025-11-03"})
        self.assertEqual(response.status_code, 200); self.assertEqual(len(response.json()["rows"]), 24)
        response = client.get("/forecasts", params={"route": 17, "start_date": "2025-11-03", "end_date": "2025-11-03", "hour": 8})
        self.assertEqual(len(response.json()["rows"]), 1)
        self.assertEqual(client.get("/forecasts", params={"route": 99, "start_date": "2025-11-03", "end_date": "2025-11-03"}).status_code, 422)
        self.assertEqual(len(client.get("/forecasts.csv").content.splitlines()), 14_641)
        rows.pop(); pipeline._write_csv(path, ("route", "date", "hour", "prediction"), rows)
        with self.assertRaisesRegex(ValueError, "14640"):
            forecast_api.load_snapshot(path)


if __name__ == "__main__":
    unittest.main()
