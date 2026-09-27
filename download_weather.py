"""Download hourly Moscow weather from Open-Meteo's historical archive."""

import argparse
import csv
import json
import urllib.parse
import urllib.request
from pathlib import Path


API_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY_FIELDS = (
    "temperature_2m", "precipitation", "rain", "snowfall", "snow_depth", "weather_code"
)


def download(output: Path, start="2025-01-01", end="2025-12-31"):
    query = urllib.parse.urlencode({
        "latitude": 55.7558,
        "longitude": 37.6173,
        "start_date": start,
        "end_date": end,
        "hourly": ",".join(HOURLY_FIELDS),
        "timezone": "Europe/Moscow",
    })
    request = urllib.request.Request(f"{API_URL}?{query}", headers={"User-Agent": "transport-hackathon/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    if not times or any(len(hourly.get(field, [])) != len(times) for field in HOURLY_FIELDS):
        raise ValueError("Open-Meteo returned an incomplete hourly payload")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter=";", lineterminator="\n")
        writer.writerow(("time", *HOURLY_FIELDS))
        for index, timestamp in enumerate(times):
            writer.writerow((timestamp, *(hourly[field][index] for field in HOURLY_FIELDS)))
    return len(times)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/weather/moscow_2025_hourly.csv"))
    parser.add_argument("--start", default="2025-01-01")
    parser.add_argument("--end", default="2025-12-31")
    args = parser.parse_args(argv)
    print(f"wrote {download(args.output, args.start, args.end)} rows to {args.output}")


if __name__ == "__main__":
    main()
