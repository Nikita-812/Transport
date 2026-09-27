import tempfile
import unittest
from datetime import date
from pathlib import Path

import model_v2


class ModelV2Test(unittest.TestCase):
    def test_weather_loader_and_feature_matrix_use_same_hour_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "weather.csv"
            path.write_text(
                "time;temperature_2m;precipitation;rain;snowfall;snow_depth;weather_code\n"
                "2025-01-01T08:00;1;2;3;4;5;6\n", encoding="utf-8"
            )
            weather = model_v2.load_weather(path)
            row = {"route": 1, "date": date(2025, 1, 1), "hour": 8, "weekday": 2, "month": 1,
                   "is_weekend": 0, "is_holiday": 1, "is_workday": 0, "is_preholiday": 0}
            matrix = model_v2.feature_matrix([row], "none", weather)
            self.assertEqual(matrix[0, -6:].tolist(), [1, 2, 3, 4, 5, 6])

    def test_only_transferred_day_off_is_rewritten(self):
        base = {"date": date(2025, 11, 3), "weekday": 0, "is_weekend": 0,
                "is_workday": 0, "is_holiday": 0}
        self.assertEqual(model_v2.adjusted_calendar_row(base)["weekday"], 6)
        working_saturday = {**base, "date": date(2025, 11, 1), "weekday": 5, "is_weekend": 1,
                            "is_workday": 1}
        self.assertIs(model_v2.adjusted_calendar_row(working_saturday), working_saturday)


if __name__ == "__main__":
    unittest.main()
