import hashlib
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import accuracy
import pipeline


def rows(days=70):
    result = []
    for offset in range(days):
        day = date(2025, 1, 1) + timedelta(days=offset)
        result.append({
            "route": 1, "date": day, "hour": 8, "boardings": 100 + offset,
            "weekday": day.weekday(), "month": day.month,
            "is_weekend": int(day.weekday() >= 5), "is_holiday": 0,
            "is_workday": int(day.weekday() < 5), "is_preholiday": 0,
        })
    return result


class AccuracyTest(unittest.TestCase):
    def test_raw_activity_loader_rejects_csv_tamper(self):
        history = rows(1)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "raw_activity.csv"
            path.write_text(
                "route;date;hour;boardings;events;active_vehicles;active_exits;active_devices\n"
                "1;2025-01-01;8;100;120;2;3;4\n", encoding="utf-8"
            )
            metadata = {
                "schema_version": 1, "rows": 1, "output_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "reconciliation": {"history": "history.csv", "history_sha256": "history-hash", "keys": 1, "mismatches": 0, "boardings": 100},
            }
            path.with_suffix(".metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            loaded, _, _ = accuracy.read_raw_activity(path, history, "history-hash", "history.csv")
            self.assertEqual(loaded[0]["active_vehicles"], 2)
            path.write_text(path.read_text(encoding="utf-8").replace(";2;3;4", ";9;3;4"), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "provenance"):
                accuracy.read_raw_activity(path, history, "history-hash", "history.csv")

    def test_snapshot_ignores_labels_after_origin(self):
        history = rows()
        origin = date(2025, 1, 31)
        changed = [dict(row) for row in history]
        for row in changed:
            if row["date"] > origin:
                row["boardings"] += 1_000_000
        target = [row for row in history if row["date"] > origin][:2]
        left = accuracy.profile_matrix(target, accuracy.profile_snapshot(history, origin), origin)
        right = accuracy.profile_matrix(target, accuracy.profile_snapshot(changed, origin), origin)
        self.assertEqual(left.tolist(), right.tolist())

    def test_raw_activity_features_are_origin_safe_and_used(self):
        history = [
            {**row, "hour": hour, "boardings": row["boardings"] + hour}
            for row in rows(100) for hour in range(24)
        ]
        cutoff = date(2025, 3, 31)
        validation = [row for row in history if row["date"] == cutoff + timedelta(days=1)]
        raw = [
            {
                "route": row["route"], "date": row["date"], "hour": row["hour"], "boardings": row["boardings"],
                "events": row["boardings"] + 10, "active_vehicles": 1 + row["hour"] % 3,
                "active_exits": 2 + row["date"].day % 4, "active_devices": 3 + row["hour"] % 2,
            }
            for row in history
        ]
        changed = [dict(row) for row in raw]
        for row in changed:
            if row["date"] > cutoff:
                row["events"] += 1_000_000
                row["active_vehicles"] += 1_000_000
        profile = accuracy.profile_snapshot(history, cutoff)
        base = accuracy.profile_matrix(validation, profile, cutoff)
        left = accuracy.raw_activity_matrix(validation, profile, accuracy.raw_activity_snapshot(raw, cutoff), cutoff)
        right = accuracy.raw_activity_matrix(validation, profile, accuracy.raw_activity_snapshot(changed, cutoff), cutoff)
        self.assertEqual(left.tolist(), right.tolist())
        self.assertEqual(left[:, :base.shape[1]].tolist(), base.tolist())
        self.assertTrue(any(value != 0 for value in left[:, base.shape[1]:].flat))
        self.assertEqual(
            accuracy._fit_predict(history, cutoff, validation, "raw_activity_hgb", raw),
            accuracy._fit_predict(history, cutoff, validation, "raw_activity_hgb", changed),
        )

    def test_device_density_weights_exposure_and_ignores_future_activity(self):
        cutoff = date(2025, 1, 3)
        active = {**rows(1)[0], "date": cutoff, "hour": 8, "boardings": 20, "weekday": cutoff.weekday()}
        inactive_hour = {**active, "hour": 9, "boardings": 0}
        zero_route = {**active, "route": 5, "boardings": 0}
        future_day = cutoff + timedelta(days=7)
        future_active = {**active, "date": future_day, "weekday": future_day.weekday()}
        future_inactive_hour = {**inactive_hour, "date": future_day, "weekday": future_day.weekday()}
        validation = [future_active, {**future_active, "route": 5, "boardings": 0}, future_inactive_hour]

        def activity(row, devices):
            return {**row, "events": max(row["boardings"], devices), "active_vehicles": devices,
                    "active_exits": devices, "active_devices": devices}

        raw = [activity(active, 2), activity(inactive_hour, 0), activity(zero_route, 0), activity(future_active, 9)]
        changed = [dict(row) for row in raw]
        changed[-1]["active_devices"] = changed[-1]["events"] = 1_000_000

        class DensityModel:
            weights = []

            def __init__(self, **_):
                pass

            def fit(self, _, __, sample_weight):
                type(self).weights.append(list(sample_weight))
                return self

            def predict(self, values):
                return [2.0] * len(values)

        with patch("sklearn.ensemble.HistGradientBoostingRegressor", DensityModel):
            left = accuracy.per_route_device_density_predictions([active, inactive_hour, zero_route, future_active], validation, raw, cutoff)
            right = accuracy.per_route_device_density_predictions([active, inactive_hour, zero_route, future_active], validation, changed, cutoff)
        self.assertEqual(left, [4.0, 0.0, 0.0])
        self.assertEqual(left, right)
        self.assertEqual(DensityModel.weights, [[2], [2]])

    def test_fare_components_are_cutoff_local_and_reconcile_sparse_parents(self):
        cutoff = date(2025, 1, 3)
        active = {**rows(1)[0], "date": cutoff, "hour": 8, "boardings": 20, "weekday": cutoff.weekday()}
        future_day = cutoff + timedelta(days=7)
        future = {**active, "date": future_day, "weekday": future_day.weekday(), "boardings": 1_000_000}
        inactive = {**future, "route": 5, "boardings": 0}
        history = [active, future, inactive]
        entries = [
            (1, cutoff.isoformat(), 8, "A", 0, 11),
            *[(1, cutoff.isoformat(), 8, fare, 0, 1) for fare in "BCDEFGHIJ"],
            (1, future_day.isoformat(), 8, "A", 0, 1), (1, future_day.isoformat(), 8, "Z", 0, 999_999),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "raw_fares.csv"

            def write(rows):
                body = "route;date;hour;good_type;good_type_missing;boardings\n" + "".join(
                    ";".join(map(str, row)) + "\n" for row in rows
                )
                path.write_text(body, encoding="utf-8")
                metadata = {
                    "schema_version": 1, "rows": len(rows), "parent_grid_rows": len(history),
                    "output_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "reconciliation": {"history": "history.csv", "history_sha256": "history-hash", "keys": len(history),
                                       "mismatches": 0, "boardings": sum(row["boardings"] for row in history)},
                }
                path.with_suffix(".metadata.json").write_text(json.dumps(metadata), encoding="utf-8")

            write(entries)
            fares, _, _ = accuracy.read_raw_fares(path, history, "history-hash", "history.csv")

            class ComponentModel:
                fare_indexes = []

                def __init__(self, **_):
                    pass

                def fit(self, features, _):
                    type(self).fare_indexes.append(sorted(set(features[:, 9])))
                    return self

                def predict(self, features):
                    return features[:, 9] + 1

            changed = [dict(row) for row in fares]
            for row in changed:
                if row["date"] > cutoff:
                    row["boardings"] = 1_000_000_000
            with patch("sklearn.ensemble.HistGradientBoostingRegressor", ComponentModel):
                diagnostic = {}
                left = accuracy.pooled_fare_component_predictions(history, [future, inactive], fares, cutoff, diagnostic)
                right = accuracy.pooled_fare_component_predictions(history, [future, inactive], changed, cutoff)
                per_route_left = accuracy.per_route_fare_component_predictions(history, [future, inactive], fares, cutoff)
                per_route_right = accuracy.per_route_fare_component_predictions(history, [future, inactive], changed, cutoff)
            self.assertEqual(left, [45.0, 0.0])
            self.assertEqual(left, right)
            self.assertEqual(per_route_left, [45.0, 0.0])
            self.assertEqual(per_route_left, per_route_right)
            self.assertEqual(diagnostic["component_group_count"], 9)
            self.assertEqual(sum(item["boardings"] for item in diagnostic["kept_fares"]), 18)
            self.assertEqual(diagnostic["other"]["boardings"], 2)
            self.assertEqual(ComponentModel.fare_indexes, [list(map(float, range(9)))] * 4)

            write([(*entries[0][:-1], 10), *entries[1:]])
            with self.assertRaisesRegex(ValueError, "reconcile"):
                accuracy.read_raw_fares(path, history, "history-hash", "history.csv")

    def test_daily_share_ignores_future_labels_and_conserves_daily_total(self):
        history = [
            {**row, "hour": hour, "boardings": row["boardings"] + hour}
            for row in rows(70) for hour in range(24)
        ]
        origin = date(2025, 1, 31)
        validation_day = origin + timedelta(days=1)
        validation = [row for row in history if row["date"] == validation_day]
        changed = [dict(row) for row in history]
        for row in changed:
            if row["date"] > origin:
                row["boardings"] += 1_000_000
        left = accuracy.daily_share_predictions(history, origin, validation)
        right = accuracy.daily_share_predictions(changed, origin, validation)
        self.assertEqual(left, right)
        snapshot = accuracy.daily_share_snapshot(history, origin)
        key = (1, accuracy._calendar_day_key(validation[0]))
        expected = snapshot["daily_56"].get(key, snapshot["daily_all"].get(key, 0.0))
        self.assertAlmostEqual(sum(left), expected)

    def test_calibrated_hgb_origins_are_pre_cutoff_and_do_not_include_horizon_labels(self):
        cutoff = date(2025, 6, 30)
        origins = accuracy._calibration_origins(cutoff)
        self.assertTrue(origins)
        self.assertTrue(all(origin + timedelta(days=61) <= cutoff for origin in origins))

    def test_calibrated_hgb_ignores_rows_after_final_cutoff(self):
        history = [
            {**row, "hour": hour, "boardings": row["boardings"] + hour}
            for row in rows(160) for hour in range(24)
        ]
        cutoff = date(2025, 5, 31)
        validation = [row for row in history if row["date"] == cutoff]
        changed = [dict(row) for row in history]
        for row in changed:
            if row["date"] > cutoff:
                row["boardings"] += 1_000_000
        self.assertEqual(
            accuracy.calibrated_hgb_predictions(history, cutoff, validation),
            accuracy.calibrated_hgb_predictions(changed, cutoff, validation),
        )

    def test_per_route_hgb_preserves_row_order_and_zero_route(self):
        active = rows(1)[0]
        inactive = dict(active, route=5, boardings=0)
        validation = [active, inactive, active]
        with patch.object(accuracy.experiments, "_fit_predict", return_value=[10.0, 20.0]) as fit:
            predictions = accuracy.per_route_hgb_predictions([active, inactive], validation)
        self.assertEqual(predictions, [10.0, 0.0, 20.0])
        self.assertEqual(fit.call_count, 1)

    def test_pooled_route_blend_uses_fixed_weight_and_keeps_zero_route_zero(self):
        active = rows(1)[0]
        inactive = dict(active, route=5, boardings=0)
        with (
            patch.object(accuracy, "pooled_hgb_predictions", return_value=[20.0, 80.0]),
            patch.object(accuracy, "per_route_hgb_predictions", return_value=[40.0, 60.0]),
        ):
            predictions = accuracy.pooled_route_blend_predictions([active, inactive], [active, inactive])
        self.assertEqual(predictions, [30.0, 0.0])

    def test_seasonal_interaction_ignores_future_labels_and_keeps_zero_route_zero(self):
        history = [
            {**row, "hour": hour, "boardings": row["boardings"] + hour}
            for row in rows(100) for hour in range(24)
        ]
        history += [{**row, "route": 5, "boardings": 0} for row in history]
        cutoff = date(2025, 3, 31)
        validation = [row for row in history if row["date"] == cutoff + timedelta(days=1)]
        changed = [dict(row) for row in history]
        for row in changed:
            if row["date"] > cutoff:
                row["boardings"] += 1_000_000
        left = accuracy._fit_predict(history, cutoff, validation, "seasonal_interaction")
        right = accuracy._fit_predict(changed, cutoff, validation, "seasonal_interaction")
        self.assertEqual(left, right)
        self.assertTrue(all(value >= 0 for value in left))
        self.assertTrue(all(value == 0 for row, value in zip(validation, left) if row["route"] == 5))

    def test_hierarchical_normalization_conserves_daily_total(self):
        day = date(2025, 1, 1)
        route_day = [dict(rows(1)[0], date=day, hour=hour) for hour in range(3)]
        self.assertEqual(
            accuracy._normalize_daily_predictions(route_day, [120.0] * 3, [1.0, 2.0, 3.0]),
            [20.0, 40.0, 60.0],
        )
        self.assertEqual(accuracy._normalize_daily_predictions(route_day, [120.0] * 3, [0.0] * 3), [40.0] * 3)
        self.assertEqual(accuracy._normalize_daily_predictions(route_day, [0.0] * 3, [0.0] * 3), [0.0] * 3)

    def test_hierarchical_hgb_ignores_labels_after_cutoff(self):
        history = [
            {**row, "hour": hour, "boardings": row["boardings"] + hour}
            for row in rows(100) for hour in range(24)
        ]
        cutoff = date(2025, 3, 31)
        validation = [row for row in history if row["date"] == cutoff + timedelta(days=1)]
        changed = [dict(row) for row in history]
        for row in changed:
            if row["date"] > cutoff:
                row["boardings"] += 1_000_000
        clean = [row for row in history if row["date"] <= cutoff]
        daily_totals = {}
        for row in clean:
            daily_totals[row["date"]] = daily_totals.get(row["date"], 0) + row["boardings"]

        def predictions(train, targets, target_rows):
            self.assertTrue(all(row["date"] <= cutoff for row in train))
            if all(row["hour"] == 0 for row in train):
                self.assertEqual(targets, [daily_totals[row["date"]] for row in train])
                return [100.0] * len(target_rows)
            self.assertEqual(targets, [row["boardings"] / daily_totals[row["date"]] for row in train])
            return [1.0] * len(target_rows)

        with patch.object(accuracy, "_hgb_predictions", side_effect=predictions):
            left = accuracy._fit_predict(history, cutoff, validation, "hierarchical_hgb")
            right = accuracy._fit_predict(changed, cutoff, validation, "hierarchical_hgb")
        self.assertEqual(left, right)
        self.assertAlmostEqual(sum(left), 100.0)

    def test_origin_training_examples_never_include_later_targets(self):
        training = accuracy.origin_training_rows(rows(), date(2025, 3, 11))
        self.assertTrue(training)
        for origin, target in training:
            self.assertLessEqual(origin, target["date"])
            self.assertLess(target["date"], origin + timedelta(days=62))
            self.assertLessEqual(target["date"], date(2025, 3, 11))

    def test_residual_predictions_reconstruct_target_and_keep_inactive_route_zero(self):
        active = rows(1)[0]
        inactive = dict(active, route=5)
        predictions = accuracy.residual_predictions(
            [80.0, 100.0], [20.0, 900.0], [active, inactive], {1}
        )
        self.assertEqual(predictions, [100.0, 0.0])

    def test_target_requires_every_early_slice_and_score_rejects_mismatch(self):
        bar = pipeline.TARGET_WAPE_SCORE
        self.assertFalse(accuracy.target_met([bar + 0.01, bar - 0.01]))
        self.assertTrue(accuracy.target_met([bar, bar + 0.01]))
        self.assertFalse(accuracy.target_met([]))
        with self.assertRaisesRegex(ValueError, "count"):
            accuracy._score(rows(2), [100.0])


if __name__ == "__main__":
    unittest.main()
