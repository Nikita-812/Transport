import csv
import json
import tempfile
import unittest
import zipfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pipeline
import raw_activity
import raw_fares
from test_raw_activity import event, text


class RawFaresTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, name, member, rows):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(member, text([raw_activity.RAW_FIELDS, *rows]))
        return path

    def history(self, boardings):
        path = self.root / "history.csv"
        rows = [pipeline.HISTORY_FIELDS]
        day = raw_activity.START
        while day <= raw_activity.END:
            for route in pipeline.ROUTES:
                for hour in range(24):
                    rows.append((route, day.isoformat(), hour, boardings.get((route, day, hour), 0), 0, 0, 0, 0, 0, 0))
            day += timedelta(days=1)
        path.write_text(text(rows), encoding="utf-8")
        return path

    def test_fares_reconcile_and_keep_blank_category(self):
        first = event("2025-08-31 23:00:00")
        first[9] = "fare; quoted"
        missing = event("2025-09-01 00:01:00")
        missing[9] = ""
        duplicate = event("2025-09-01 00:02:00")
        duplicate[9] = "student"
        failed = event("2025-09-01 00:02:00", result="90")
        last = event("2025-09-01 00:03:00")
        last[9] = "student"
        train = self.archive("train.zip", "train.csv", [first, missing, duplicate, failed])
        test = self.archive("test.zip", "test.csv", [last, event("2025-11-01 00:00:00")])
        history = self.history({(1, date(2025, 8, 31), 23): 1, (1, date(2025, 9, 1), 0): 3})
        output = self.root / "raw_fares.csv"
        with patch.object(raw_fares, "BUFFER_KEYS", 1):
            metadata = raw_fares.extract(train, test, output, history, progress_every=0)
        with output.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream, delimiter=";")
            self.assertEqual(tuple(reader.fieldnames), raw_fares.FARE_FIELDS)
            rows = list(reader)
        september = [row for row in rows if row["date"] == "2025-09-01" and row["hour"] == "0"]
        self.assertEqual([(row["good_type"], row["good_type_missing"], row["boardings"]) for row in september], [("student", "0", "2"), ("", "1", "1")])
        self.assertEqual(metadata["events"], {"events_read": 6, "events_kept": 5, "events_outside_dates": 1, "successful_kept": 4})
        self.assertEqual(metadata["reconciliation"]["mismatches"], 0)
        self.assertEqual(metadata["summary"]["category_count"], 3)
        self.assertEqual(metadata["rows"], 3)
        self.assertEqual(json.loads(output.with_suffix(".metadata.json").read_text())["output_sha256"], raw_activity._sha256(output))

    def test_reconciliation_failure_keeps_previous_output(self):
        train = self.archive("train.zip", "train.csv", [event("2025-01-01 00:00:00")])
        test = self.archive("test.zip", "test.csv", [])
        output = self.root / "raw_fares.csv"
        output.write_text("previous\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "differ"):
            raw_fares.extract(train, test, output, self.history({}), progress_every=0)
        self.assertEqual(output.read_text(encoding="utf-8"), "previous\n")


if __name__ == "__main__":
    unittest.main()
