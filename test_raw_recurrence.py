import csv
import tempfile
import unittest
import zipfile
from datetime import date, timedelta
from io import StringIO
from pathlib import Path

import pipeline
import raw_activity
import raw_recurrence


def text(rows):
    stream = StringIO(newline="")
    csv.writer(stream, delimiter=";", lineterminator="\n").writerows(rows)
    return stream.getvalue()


def event(stamp, card="", result="1"):
    return ["1", "device", stamp, "", "", card, result, "52", "39707", "fare", "", "1 трамвай", "exit", "vehicle"]


class RawRecurrenceTest(unittest.TestCase):
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

    def history(self, boardings, name):
        path = self.root / name
        rows = [pipeline.HISTORY_FIELDS]
        day = raw_recurrence.START
        while day <= raw_recurrence.END:
            for route in pipeline.ROUTES:
                for hour in range(24):
                    rows.append((route, day.isoformat(), hour, boardings.get((route, day, hour), 0), 0, 0, 0, 0, 0, 0))
            day += timedelta(days=1)
        path.write_text(text(rows), encoding="utf-8")
        return path

    def read(self, path):
        with path.open(encoding="utf-8", newline="") as stream:
            return {(int(row["route"]), row["date"], int(row["hour"])): row for row in csv.DictReader(stream, delimiter=";")}

    def test_reconciles_unsorted_cards_and_ignores_later_cards(self):
        base_rows = [
            event("2025-01-02 08:00:00", "card-a"), event("2025-01-01 08:00:00", "card-a"),
            event("2025-01-01 08:10:00", "card-a"), event("2025-01-02 08:10:00", "card-b"),
            event("2025-01-02 08:20:00", ""), event("2025-01-02 08:30:00", "card-c", "90"),
            event("2025-11-01 08:00:00", "future-card"),
        ]
        extra = [event("2025-01-03 08:00:00", "card-a"), event("2025-01-03 08:10:00", "card-d")]
        train = self.archive("train.zip", "train.csv", base_rows)
        test = self.archive("test.zip", "test.csv", [])
        base_history = self.history({(1, date(2025, 1, 1), 8): 2, (1, date(2025, 1, 2), 8): 3}, "base-history.csv")
        base_output = self.root / "base.csv"
        metadata = raw_recurrence.extract(train, test, base_output, base_history, progress_every=0)
        values = self.read(base_output)
        self.assertEqual(tuple(values[(1, "2025-01-01", 8)][field] for field in raw_recurrence.RECURRENCE_FIELDS[3:]), ("2", "2", "2", "0"))
        self.assertEqual(tuple(values[(1, "2025-01-02", 8)][field] for field in raw_recurrence.RECURRENCE_FIELDS[3:]), ("3", "2", "1", "1"))
        self.assertEqual(metadata["events"]["events_outside_dates"], 1)

        extended = self.archive("extended.zip", "train.csv", [*base_rows, *extra])
        extended_history = self.history({(1, date(2025, 1, 1), 8): 2, (1, date(2025, 1, 2), 8): 3, (1, date(2025, 1, 3), 8): 2}, "extended-history.csv")
        extended_output = self.root / "extended.csv"
        raw_recurrence.extract(extended, test, extended_output, extended_history, progress_every=0)
        later = self.read(extended_output)
        self.assertEqual(
            {key: row for key, row in values.items() if key[1] <= "2025-01-02"},
            {key: row for key, row in later.items() if key[1] <= "2025-01-02"},
        )


if __name__ == "__main__":
    unittest.main()
