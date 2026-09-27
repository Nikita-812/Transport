import csv
import tempfile
import unittest
import zipfile
from datetime import date, timedelta
from io import StringIO
from pathlib import Path

import pipeline
import raw_activity


def text(rows):
    stream = StringIO(newline="")
    csv.writer(stream, delimiter=";", lineterminator="\n").writerows(rows)
    return stream.getvalue()


def event(stamp, route="1 трамвай", result="1", vehicle="31001", exit_no="201", device="1734001"):
    return ["1", device, stamp, "", "", "", result, "52", "39707", "tariff; quoted", "", route, exit_no, vehicle]


class RawActivityTest(unittest.TestCase):
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

    def test_streams_boundaries_activity_and_complete_grid(self):
        train = self.archive("train.zip", "train.csv", [
            event("2025-08-31 23:59:59"),
            event("2025-09-01 00:01:00", result="90", vehicle="", exit_no="202", device="1734002"),
        ])
        test = self.archive("test.zip", "test.csv", [
            event("2025-09-01 00:02:00", vehicle="31002", device="1734002"),
            event("2025-11-01 00:00:00"),
        ])
        boardings = {(1, date(2025, 8, 31), 23): 1, (1, date(2025, 9, 1), 0): 1}
        output = self.root / "raw_activity.csv"
        metadata = raw_activity.extract(train, test, output, self.history(boardings), progress_every=0)
        with output.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream, delimiter=";")
            self.assertEqual(tuple(reader.fieldnames), raw_activity.ACTIVITY_FIELDS)
            rows = list(reader)
        values = {(int(row["route"]), row["date"], int(row["hour"])): row for row in rows}
        september = values[(1, "2025-09-01", 0)]
        self.assertEqual(len(rows), 72_960)
        self.assertEqual(values[(5, "2025-01-01", 0)]["events"], "0")
        self.assertEqual((september["boardings"], september["events"], september["active_vehicles"], september["active_exits"], september["active_devices"]), ("1", "2", "1", "2", "1"))
        self.assertEqual(metadata["events"], {"events_read": 4, "events_kept": 3, "events_outside_dates": 1})

    def test_reconciliation_failure_keeps_previous_output(self):
        train = self.archive("train.zip", "train.csv", [event("2025-01-01 00:00:00")])
        test = self.archive("test.zip", "test.csv", [])
        output = self.root / "raw_activity.csv"
        output.write_text("previous\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "differ"):
            raw_activity.extract(train, test, output, self.history({}), progress_every=0)
        self.assertEqual(output.read_text(encoding="utf-8"), "previous\n")


if __name__ == "__main__":
    unittest.main()
