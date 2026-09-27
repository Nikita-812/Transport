import unittest
from datetime import date

import weather_effects


def observation(slice_name, day, actual, prediction, **weather):
    values = {"temperature_2m": 10.0, "precipitation": 0.0, "rain": 0.0, "snowfall": 0.0}
    values.update(weather)
    return {"slice": slice_name, "date": day, "hour": 0, "actual": actual,
            "prediction": prediction, "weather": values}


class WeatherEffectsTest(unittest.TestCase):
    def test_category_boundaries_are_strict(self):
        by_name = {item.name: item for item in weather_effects.CATEGORIES}
        boundary = {"temperature_2m": -10.0, "precipitation": 0.0, "rain": 0.2, "snowfall": 0.0}
        self.assertTrue(by_name["no_precipitation"].matches(boundary))
        self.assertFalse(by_name["rain"].matches(boundary))
        self.assertFalse(by_name["frost_below_minus_10"].matches(boundary))
        self.assertTrue(by_name["rain"].matches({**boundary, "precipitation": 0.3, "rain": 0.21}))
        self.assertTrue(by_name["snowfall"].matches({**boundary, "precipitation": 0.1, "snowfall": 0.01}))
        self.assertTrue(by_name["heat_above_25"].matches({**boundary, "temperature_2m": 25.1}))

    def test_normalizes_each_slice_to_its_own_dry_ratio(self):
        rows = [
            observation("a", date(2025, 5, 1), 200, 100),
            observation("a", date(2025, 5, 2), 300, 100, precipitation=1, rain=1),
            observation("b", date(2025, 7, 1), 50, 100),
            observation("b", date(2025, 7, 2), 50, 100, precipitation=1, rain=1),
        ]
        result = {item["category"]: item for item in weather_effects.estimate_effects(rows, 50, seed=7)}
        self.assertEqual(result["no_precipitation"]["multiplier"], 1.0)
        # Normalized rain forecast: 100*2 + 100*0.5 = 250; actual rain = 350.
        self.assertEqual(result["rain"]["multiplier"], 1.4)
        self.assertEqual(result["rain"]["hours"], 2)
        self.assertFalse(result["rain"]["enough_data"])
        self.assertIsNone(result["snowfall"]["multiplier"])


if __name__ == "__main__":
    unittest.main()
