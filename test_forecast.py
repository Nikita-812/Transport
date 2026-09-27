import csv
import hashlib
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import forecast_export
import pipeline


ROUTES = (1, 5, 7, 11, 12, 17, 25, 26, 28, 50)


def write_snapshot(directory, corrupt=False):
    directory = Path(directory)
    rows = []
    for route in ROUTES:
        day = date(2025, 11, 1)
        while day <= date(2025, 12, 31):
            for hour in range(24):
                rows.append((route, day.isoformat(), hour, float(route + hour)))
            day += timedelta(days=1)
    if corrupt:
        rows[-1] = rows[-2]
    content = "route;date;hour;prediction\n" + "".join(
        f"{route};{day};{hour};{prediction}\n" for route, day, hour, prediction in rows
    )
    content_bytes = content.encode("utf-8")
    (directory / "forecast.csv").write_bytes(content_bytes)
    (directory / "metadata.json").write_text(json.dumps({
        "schema_version": 1,
        "rows": len(rows),
        "forecast_sha256": hashlib.sha256(content_bytes).hexdigest(),
        "forecast_version": "winner:" + hashlib.sha256(content_bytes).hexdigest()[:12],
        "quality_passed": True,
        "serving_mode": "production",
    }), encoding="utf-8")


class ForecastApiTest(unittest.TestCase):
    def test_gzip_negotiation_preserves_csv_and_respects_q_zero(self):
        import forecast_api

        self.assertTrue(forecast_api.accepts_gzip("GZip;Q=1, identity"))
        self.assertTrue(forecast_api.accepts_gzip("br;q=0, *;q=.5"))
        self.assertFalse(forecast_api.accepts_gzip(None))
        self.assertFalse(forecast_api.accepts_gzip(""))
        self.assertFalse(forecast_api.accepts_gzip("gzip;q=0, *;q=0, identity"))
        self.assertFalse(forecast_api.accepts_gzip("gzip;q=2"))
        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            with TestClient(forecast_api.create_app(temporary)) as client:
                zipped = client.get("/forecasts.csv", headers={"Accept-Encoding": "gzip"})
                plain = client.get("/forecasts.csv", headers={"Accept-Encoding": "gzip;q=0, identity"})
                self.assertEqual(zipped.headers["content-encoding"], "gzip")
                self.assertEqual(zipped.headers["vary"], "Accept-Encoding")
                self.assertNotIn("content-encoding", plain.headers)
                self.assertEqual(zipped.content, plain.content)

    def test_aggregate_cache_is_bounded_per_app_snapshot(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            write_snapshot(first)
            write_snapshot(second)
            with TestClient(forecast_api.create_app(first)) as client:
                response = client.get("/forecasts", params={"routes": "1", "start_date": "2025-11-01", "end_date": "2025-11-02", "group_by": "day"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(client.app.state.aggregate_cache.cache_info().currsize, 1)
                self.assertEqual(client.app.state.aggregate_cache.cache_parameters()["maxsize"], 128)
            with TestClient(forecast_api.create_app(second)) as client:
                self.assertEqual(client.app.state.aggregate_cache.cache_info().currsize, 0)

    def test_v2_snapshot_aggregates_routes_and_exports_filtered_csv(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            metadata_path = directory / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata.update(schema_version=2, coverage={"start": "2025-11-01", "end": "2025-12-31"},
                            submission_coverage={"start": "2025-11-01", "end": "2025-12-31"})
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with TestClient(forecast_api.create_app(directory)) as client:
                response = client.get("/forecasts", params={
                    "routes": "1,7", "start_date": "2025-11-03", "end_date": "2025-11-03", "group_by": "day"
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["rows"], [{"day": "2025-11-03", "prediction": 744.0}])
                download = client.get("/forecasts/export.csv", params={
                    "routes": "1,7", "start_date": "2025-11-03", "end_date": "2025-11-03", "group_by": "day"
                })
                self.assertEqual(download.status_code, 200)
                self.assertEqual(download.text.splitlines(), ["day;prediction", "2025-11-03;744.0"])

    def test_v2_snapshot_rejects_horizon_beyond_declared_coverage(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            metadata_path = directory / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata.update(schema_version=2, coverage={"start": "2025-11-01", "end": "2025-12-31"},
                            submission_coverage={"start": "2025-11-01", "end": "2025-12-31"})
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with TestClient(forecast_api.create_app(directory)) as client:
                self.assertEqual(client.get("/forecasts", params={
                    "routes": "17", "start_date": "2025-12-31", "end_date": "2026-01-01"
                }).status_code, 422)

    def test_calendar_horizons_use_calendar_boundaries(self):
        import forecast_export

        self.assertEqual(forecast_export.horizon_end(date(2025, 11, 1), "day"), date(2025, 11, 1))
        self.assertEqual(forecast_export.horizon_end(date(2025, 11, 1), "month"), date(2025, 11, 30))
        self.assertEqual(forecast_export.horizon_end(date(2025, 11, 1), "year"), date(2026, 10, 31))
        self.assertEqual(forecast_export.horizon_end(date(2026, 2, 1), "month"), date(2026, 2, 28))
        self.assertEqual(forecast_export.horizon_end(date(2025, 1, 31), "month"), date(2025, 2, 27))
        self.assertEqual(forecast_export.horizon_end(date(2024, 2, 29), "year"), date(2025, 2, 27))

    def test_2026_calendar_marks_known_carryover_days_off(self):
        import pipeline

        calendar = forecast_export.json.loads(Path("calendar_2026.json").read_text(encoding="utf-8"))
        for field in ("holidays", "transferred_days_off", "transferred_workdays", "preholidays"):
            calendar[field] = {date.fromisoformat(value) for value in calendar[field]}
        self.assertFalse(pipeline.calendar_features(date(2026, 3, 9), calendar)["is_workday"])
        self.assertFalse(pipeline.calendar_features(date(2026, 5, 11), calendar)["is_workday"])
        self.assertFalse(pipeline.calendar_features(date(2026, 2, 20), calendar)["is_preholiday"])
        self.assertTrue(pipeline.calendar_features(date(2026, 5, 8), calendar)["is_preholiday"])

    def test_reference_map_never_claims_stop_forecasts(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            (directory / "reference_map.json").write_text(json.dumps({
                "schema_version": 1, "forecast_available": False,
                "routes": [{"route": 1, "stops": [{"stop_id": "s1", "name": "Stop", "lat": 55.7, "lon": 37.6}]}]
            }), encoding="utf-8")
            with TestClient(forecast_api.create_app(directory)) as client:
                payload = client.get("/reference-map").json()
                self.assertFalse(payload["forecast_available"])
                self.assertEqual(payload["routes"][0]["stops"][0]["stop_id"], "s1")
                self.assertEqual(client.get("/forecasts", params={
                    "routes": "1", "stop_id": "s1", "start_date": "2025-11-01", "end_date": "2025-11-01"
                }).status_code, 422)

    def test_reference_map_hash_prevents_tampered_sidecar(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            sidecar = directory / "reference_map.json"
            sidecar.write_text('{"forecast_available":false,"routes":[]}', encoding="utf-8")
            metadata_path = directory / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["reference_map_sha256"] = hashlib.sha256(sidecar.read_bytes()).hexdigest()
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            sidecar.write_text('{"forecast_available":false,"routes":[1]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "reference map sidecar"):
                forecast_api.load_snapshot(directory)
    def test_forecast_contract_and_invalid_parameters(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            with TestClient(forecast_api.create_app(Path(temporary))) as client:
                health = client.get("/health")
                self.assertEqual(health.status_code, 200)
                self.assertTrue(health.json()["ready"])
                self.assertTrue(health.json()["quality_passed"])
                self.assertEqual(health.json()["serving_mode"], "production")
                response = client.get("/forecasts", params={
                    "route": 17, "start_date": "2025-11-03", "end_date": "2025-11-03"
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()["rows"]), 24)
                self.assertEqual(response.json()["rows"][0]["hour"], 0)
                hourly = client.get("/forecasts", params={
                    "route": 17, "start_date": "2025-11-03", "end_date": "2025-11-03", "hour": 8
                })
                self.assertEqual(hourly.status_code, 200)
                self.assertEqual(len(hourly.json()["rows"]), 1)
                self.assertEqual(client.get("/forecasts", params={
                    "route": 2, "start_date": "2025-11-01", "end_date": "2025-11-01"
                }).status_code, 422)
                self.assertEqual(client.get("/forecasts", params={
                    "route": 17, "start_date": "2025-12-01", "end_date": "2025-11-01"
                }).status_code, 422)
                self.assertEqual(client.get("/forecasts", params={
                    "route": 17, "start_date": "2026-01-01", "end_date": "2026-01-01"
                }).status_code, 422)
                self.assertEqual(client.get("/forecasts", params={
                    "route": 17, "start_date": "2025-11-01", "end_date": "2025-11-01", "hour": 24
                }).status_code, 422)
                download = client.get("/forecasts.csv")
                self.assertEqual(download.status_code, 200)
                self.assertEqual(download.headers["content-type"].split(";")[0], "text/csv")
                self.assertEqual(len(download.text.splitlines()), 14641)

    def test_diagnostic_snapshot_is_visible_in_health(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            metadata_path = Path(temporary) / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata.update(quality_passed=False, serving_mode="diagnostic")
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with TestClient(forecast_api.create_app(Path(temporary))) as client:
                self.assertEqual(client.get("/health").json(), {
                    "ready": True, "forecast_version": metadata["forecast_version"],
                    "quality_passed": False, "serving_mode": "diagnostic",
                    "coverage": {"start": "2025-11-01", "end": "2025-12-31"},
                })

    def test_diagnostic_snapshot_can_have_passed_quality(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            metadata_path = Path(temporary) / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["serving_mode"] = "diagnostic"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            self.assertTrue(forecast_api.load_snapshot(temporary).quality_passed)

    def test_corrupt_snapshot_prevents_startup(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary, corrupt=True)
            with self.assertRaisesRegex(ValueError, "duplicate|grid"):
                with TestClient(forecast_api.create_app(Path(temporary))):
                    pass

    def test_snapshot_rejects_inconsistent_quality_status(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            metadata_path = Path(temporary) / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["quality_passed"] = False
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "quality status"):
                forecast_api.load_snapshot(temporary)


class QualityTest(unittest.TestCase):
    def test_quality_requires_absolute_wape_score(self):
        bar = pipeline.TARGET_WAPE_SCORE
        original = {name: {"selected_wape_score": 0.8, "baseline_wape_score": 0.7} for name in (
            "may-june", "july-august", "september-october"
        )}
        current = {name: {"wape_score": bar - 0.01, "absolute_error": 10, "target_sum": 100} for name in original}
        with self.assertRaisesRegex(ValueError, "absolute WAPE-score"):
            forecast_export.check_quality(current, original)
        for score in current.values():
            score["wape_score"] = bar
        self.assertTrue(all(item["passed"] for item in forecast_export.check_quality(current, original).values()))

    def test_one_failing_slice_blocks_the_whole_export(self):
        bar = pipeline.TARGET_WAPE_SCORE
        original = {name: {"selected_wape_score": 0.8, "baseline_wape_score": 0.7} for name in (
            "may-june", "july-august", "september-october"
        )}
        current = {name: {"wape_score": bar + 0.05, "absolute_error": 10, "target_sum": 100} for name in original}
        current["july-august"]["wape_score"] = bar - 0.001
        with self.assertRaisesRegex(ValueError, "july-august"):
            forecast_export.check_quality(current, original)

    def test_accepted_model_slices_meet_the_bar(self):
        # Измеренный pooled_route_blend, README «Проверка лучшего кандидата по правилам Archive README».
        measured = {"may-june": 0.8609403086, "july-august": 0.8349930717, "september-october": 0.8399634607}
        self.assertEqual(set(measured), {name for name, *_ in pipeline.SLICES})
        self.assertTrue(all(score >= pipeline.TARGET_WAPE_SCORE for score in measured.values()))
        # Порог не должен опуститься до baseline route x weekday x hour: он слабее модели на двух срезах.
        baseline = {"may-june": 0.82669, "july-august": 0.77916, "september-october": 0.86230}
        self.assertLess(min(baseline.values()), pipeline.TARGET_WAPE_SCORE)

    def test_diagnostic_quality_is_explicitly_not_production_quality(self):
        original = {name: {"selected_wape_score": pipeline.TARGET_WAPE_SCORE + 0.05, "selected_absolute_error": 10,
                           "target_sum": 100, "baseline_wape_score": 0.8} for name in (
            "may-june", "july-august", "september-october"
        )}
        report = forecast_export.diagnostic_quality(original)
        self.assertFalse(any(item["passed"] for item in report.values()))
        self.assertTrue(all(item["wape_score"] >= pipeline.TARGET_WAPE_SCORE for item in report.values()))

    def test_invalid_staged_export_preserves_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            previous = (directory / "forecast.csv").read_bytes()
            with self.assertRaisesRegex(ValueError, "schema|14640"):
                forecast_export.publish_snapshot(directory, [{
                    "route": 1, "date": date(2025, 11, 1), "hour": 0
                }], [1.0], {"schema_version": 1, "rows": 1, "winner": "winner"})
            self.assertEqual((directory / "forecast.csv").read_bytes(), previous)

    def test_legacy_root_pair_still_loads(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            write_snapshot(temporary)
            snapshot = forecast_api.load_snapshot(temporary)
            self.assertEqual(len(snapshot.rows), 14640)
            self.assertFalse((Path(temporary) / "current").exists())

    def test_failed_current_switch_keeps_previous_generation(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            snapshots = directory / ".snapshots"
            snapshots.mkdir()
            forecast_export._migrate_legacy_snapshot(directory, snapshots)
            previous = forecast_api.load_snapshot(directory).version
            replace = forecast_export.os.replace

            def fail_current(source, destination):
                if Path(destination) == directory / "current":
                    raise OSError("injected switch failure")
                replace(source, destination)

            future = [{"route": route, "date": date(2025, 11, 1) + timedelta(days=offset), "hour": hour}
                      for route in ROUTES for offset in range(61) for hour in range(24)]
            with mock.patch("forecast_export.os.replace", side_effect=fail_current):
                with self.assertRaisesRegex(OSError, "injected switch"):
                    forecast_export.publish_snapshot(directory, future, [1.0] * len(future), {
                        "schema_version": 1, "rows": len(future), "winner": "winner",
                        "quality_passed": True, "serving_mode": "production",
                    })
            self.assertEqual(forecast_api.load_snapshot(directory).version, previous)

    def test_successful_publish_switches_generation_and_keeps_root_paths(self):
        import forecast_api

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_snapshot(directory)
            future = [{"route": route, "date": date(2025, 11, 1) + timedelta(days=offset), "hour": hour}
                      for route in ROUTES for offset in range(61) for hour in range(24)]
            path = forecast_export.publish_snapshot(directory, future, [1.0] * len(future), {
                "schema_version": 1, "rows": len(future), "winner": "winner",
                "quality_passed": True, "serving_mode": "production",
            })
            snapshot = forecast_api.load_snapshot(directory)
            self.assertEqual(path, directory / "forecast.csv")
            self.assertTrue(path.exists())
            self.assertTrue((directory / "current").is_symlink() or (directory / "current").is_file())
            self.assertEqual(snapshot.version, "winner:" + hashlib.sha256(path.read_bytes()).hexdigest()[:12])
            first_generation = forecast_api.snapshot_directory(directory)
            forecast_export.publish_snapshot(directory, future, [1.0] * len(future), {
                "schema_version": 1, "rows": len(future), "winner": "winner-two",
                "quality_passed": True, "serving_mode": "production",
            })
            self.assertNotEqual(forecast_api.snapshot_directory(directory), first_generation)
            self.assertTrue(forecast_api.load_snapshot(directory).version.startswith("winner-two:"))


if __name__ == "__main__":
    unittest.main()
