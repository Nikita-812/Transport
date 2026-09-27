import csv
import json
import tempfile
import unittest
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pipeline


ROUTES = (1, 5, 7, 11, 12, 17, 25, 26, 28, 50)


def grid_csv(start, end, value_column, value="0"):
    rows = [["route", "date", "hour", value_column]]
    current = start
    while current <= end:
        for route in ROUTES:
            for hour in range(24):
                rows.append([route, current.isoformat(), hour, value])
        current += timedelta(days=1)
    return csv_text(rows)


def csv_text(rows):
    from io import StringIO

    stream = StringIO(newline="")
    csv.writer(stream, delimiter=";", lineterminator="\n").writerows(rows)
    return stream.getvalue()


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.calendar = Path(__file__).with_name("calendar_2025.json")

    def tearDown(self):
        self.temp.cleanup()

    def write_archive(self, train, test=None, submission=None, name="dataset.zip"):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("labels/labels_day_train.csv", train)
            archive.writestr(
                "labels/labels_day_test.csv",
                test or "route;date;hour;boardings\n1;2025-09-01;0;1\n",
            )
            archive.writestr(
                "test_submission.csv",
                submission
                or grid_csv(date(2025, 11, 1), date(2025, 12, 31), "prediction"),
            )
        return path

    def test_prepare_rejects_bad_labels_before_publishing(self):
        cases = {
            "duplicate": "route;date;hour;boardings\n1;2025-01-01;0;1\n1;2025-01-01;0;2\n",
            "missing": "route;date;hour;boardings\n1;2025-01-01;0;\n",
            "negative": "route;date;hour;boardings\n1;2025-01-01;0;-1\n",
            "fractional": "route;date;hour;boardings\n1;2025-01-01;0;1.5\n",
            "route": "route;date;hour;boardings\n2;2025-01-01;0;1\n",
            "hour": "route;date;hour;boardings\n1;2025-01-01;24;1\n",
            "date": "route;date;hour;boardings\n1;2024-12-31;0;1\n",
        }
        for name, content in cases.items():
            with self.subTest(name=name):
                output = self.root / name
                with self.assertRaisesRegex(ValueError, name if name != "fractional" else "boardings"):
                    pipeline.prepare(self.write_archive(content, name=f"{name}.zip"), output, self.calendar)
                self.assertFalse((output / "history.csv").exists())
                self.assertFalse((output / "future.csv").exists())
                self.assertFalse((output / "metadata.json").exists())

    def test_calendar_covers_workday_overrides_and_preholiday(self):
        calendar = pipeline.load_calendar(self.calendar)
        expected = {
            date(2025, 2, 3): (0, 0, 1, 0),
            date(2025, 2, 22): (1, 0, 0, 0),
            date(2025, 11, 4): (0, 1, 0, 0),
            date(2025, 11, 1): (1, 0, 1, 1),
            date(2025, 11, 3): (0, 0, 0, 0),
        }
        for day, want in expected.items():
            features = pipeline.calendar_features(day, calendar)
            self.assertEqual(
                (features["is_weekend"], features["is_holiday"], features["is_workday"], features["is_preholiday"]),
                want,
            )

    def test_prepare_builds_complete_reproducible_grids_without_submission_values(self):
        train = "route;date;hour;boardings\n1;2025-01-01;0;3\n"
        test = "route;date;hour;boardings\n1;2025-09-01;0;4\n"
        submission_a = grid_csv(date(2025, 11, 1), date(2025, 12, 31), "prediction", "1")
        submission_b = grid_csv(date(2025, 11, 1), date(2025, 12, 31), "prediction", "999")
        archive = self.write_archive(train, test, submission_a)
        output = self.root / "output"

        pipeline.prepare(archive, output, self.calendar)
        first = {name: (output / name).read_bytes() for name in ("history.csv", "future.csv", "metadata.json")}
        original = archive.read_bytes()
        pipeline.prepare(archive, output, self.calendar)
        self.assertEqual(first, {name: (output / name).read_bytes() for name in first})
        self.assertEqual(original, archive.read_bytes())

        archive = self.write_archive(train, test, submission_b)
        pipeline.prepare(archive, output, self.calendar)
        self.assertEqual(first["history.csv"], (output / "history.csv").read_bytes())
        self.assertEqual(first["future.csv"], (output / "future.csv").read_bytes())

        with (output / "history.csv").open(newline="", encoding="utf-8") as stream:
            history = list(csv.DictReader(stream, delimiter=";"))
        with (output / "future.csv").open(newline="", encoding="utf-8") as stream:
            future = list(csv.DictReader(stream, delimiter=";"))
        metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(len(history), 72_960)
        self.assertEqual(len(future), 14_640)
        self.assertEqual(len({(r["route"], r["date"], r["hour"]) for r in history}), 72_960)
        self.assertEqual(set(future[0]), {"route", "date", "hour", "weekday", "month", "is_weekend", "is_holiday", "is_workday", "is_preholiday"})
        self.assertEqual(sum(int(r["boardings"]) for r in history), 7)
        self.assertEqual(sum(int(r["boardings"]) for r in history if r["route"] == "5"), 0)
        self.assertEqual(metadata["sources"][0]["sha256"], pipeline.sha256_member(archive, "labels/labels_day_train.csv"))
        self.assertEqual(metadata["added_zero_rows"], 72_958)

    def test_seasonal_baseline_includes_zeros_and_uses_fallbacks(self):
        rows = [
            {"route": 1, "weekday": 0, "hour": 8, "boardings": 0},
            {"route": 1, "weekday": 0, "hour": 8, "boardings": 10},
            {"route": 1, "weekday": 1, "hour": 9, "boardings": 30},
        ]
        model = pipeline.fit_seasonal(rows)
        self.assertEqual(pipeline.predict_seasonal(model, 1, 0, 8), 5)
        self.assertEqual(pipeline.predict_seasonal(model, 1, 2, 8), 5)
        self.assertEqual(pipeline.predict_seasonal(model, 1, 2, 7), 40 / 3)
        self.assertEqual(pipeline.predict_seasonal(model, 50, 2, 7), 0)

    def test_evaluation_predictions_do_not_depend_on_holdout_targets(self):
        rows = []
        for day, target in ((date(2025, 1, 6), 10), (date(2025, 5, 5), 20), (date(2025, 6, 2), 30)):
            rows.append({"route": 1, "date": day, "hour": 8, "weekday": day.weekday(), "boardings": target, "is_holiday": 0, "is_workday": 1})
        changed = [dict(row, boardings=row["boardings"] + 1000) if row["date"].month in (5, 6) else row for row in rows]
        first, _ = pipeline.evaluate_slice(rows, date(2025, 4, 30), date(2025, 5, 1), date(2025, 6, 30))
        second, _ = pipeline.evaluate_slice(changed, date(2025, 4, 30), date(2025, 5, 1), date(2025, 6, 30))
        self.assertEqual([row["prediction"] for row in first], [row["prediction"] for row in second])

    def test_metrics_use_sums_and_keep_zero_denominator_diagnostics(self):
        rows = [
            {"route": 1, "date": date(2025, 5, 1), "hour": 8, "boardings": 10, "prediction": 8, "is_holiday": 1, "is_workday": 0},
            {"route": 1, "date": date(2025, 6, 1), "hour": 8, "boardings": 30, "prediction": 20, "is_holiday": 0, "is_workday": 0},
            {"route": 5, "date": date(2025, 6, 2), "hour": 9, "boardings": 0, "prediction": 3, "is_holiday": 0, "is_workday": 1},
        ]
        metrics = pipeline.build_metrics(rows)
        self.assertEqual(metrics["overall"]["absolute_error"], 15)
        self.assertEqual(metrics["overall"]["wape"], 15 / 40)
        self.assertEqual(metrics["overall"]["wape_score"], 1 - 15 / 40)
        routes = {item["group"]: item for item in metrics["by_route"]}
        self.assertIsNone(routes["5"]["wape"])
        self.assertEqual(routes["5"]["absolute_error"], 3)
        self.assertEqual(routes["5"]["absolute_error_share"], 3 / 15)
        self.assertEqual({item["group"] for item in metrics["by_month"]}, {"2025-05", "2025-06"})
        perfect = pipeline.build_metrics([dict(rows[0], prediction=10)])
        self.assertEqual(perfect["by_route"][0]["absolute_error_share"], 0)


if __name__ == "__main__":
    unittest.main()
