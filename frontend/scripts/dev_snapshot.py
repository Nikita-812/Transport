"""Build a local forecast snapshot for frontend development.

The snapshot is written to a gitignored directory and is not a delivery artifact:
the served snapshot is owned by the backend. The script reuses backend helpers
without modifying them and trains the accepted pooled_route_blend variant.

Files are written flat (forecast.csv, metadata.json, reference_map.json) rather than
through forecast_export.publish_snapshot: on Windows Python creates tempfile
directories owner-only, and Codex runs commands as a separate sandbox user, so a
generation directory published by one agent is unreadable for the other. Plain
files inherit the workspace ACL and are readable by both.

    .venv/Scripts/python.exe frontend/scripts/dev_snapshot.py            # year
    .venv/Scripts/python.exe frontend/scripts/dev_snapshot.py --horizon submission --output-dir <dir>
"""
import argparse
import csv
import hashlib
import io
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import accuracy  # noqa: E402
import forecast_api  # noqa: E402
import forecast_export  # noqa: E402
import pipeline  # noqa: E402
import reference_map  # noqa: E402

REFERENCE = ROOT / "dataset" / "spravochniki" / "Хакатон_справочники_трамвай_10_маршрутов.xlsx"
DEV_MARKER = "local frontend development snapshot; not a delivery artifact"


def build_reference(source):
    source = Path(source)
    if source.suffix == ".zip":
        return reference_map.build(source)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "reference.zip"
        with zipfile.ZipFile(archive, "w") as stream:
            stream.write(source, arcname=f"spravochniki/{source.name}")
        return reference_map.build(archive)


def ensure_replaceable(output_dir):
    current = output_dir / "current"
    if current.exists() or current.is_symlink():
        raise SystemExit(f"{output_dir} holds a published snapshot (current pointer); use another --output-dir")
    metadata = output_dir / "metadata.json"
    if metadata.exists():
        try:
            marker = json.loads(metadata.read_text(encoding="utf-8")).get("accuracy")
        except (OSError, ValueError):
            marker = None
        if marker != DEV_MARKER:
            raise SystemExit(f"{output_dir} holds a snapshot not created by this script; refusing to overwrite")


def forecast_csv(future, predictions):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";", lineterminator="\n")
    writer.writerow(("route", "date", "hour", "prediction"))
    for row, prediction in zip(future, predictions):
        writer.writerow((row["route"], row["date"].isoformat(), row["hour"], prediction))
    return stream.getvalue().encode("utf-8")


def write(path, content):
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build a gitignored development forecast snapshot")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "processed")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "service")
    parser.add_argument("--horizon", choices=("submission", "year"), default="year")
    parser.add_argument("--reference", type=Path, default=REFERENCE, help="reference XLSX or dataset ZIP")
    args = parser.parse_args(argv)

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    ensure_replaceable(output_dir)
    history_path = args.data_dir / "history.csv"
    start = pipeline.FUTURE_START
    end = forecast_export.horizon_end(start, args.horizon)
    history = pipeline.read_history(history_path)
    future = forecast_export.future_rows(start, end)
    predictions = accuracy.pooled_route_blend_predictions(history, future)
    reference = build_reference(args.reference) if args.reference.exists() else None

    csv_bytes = forecast_csv(future, predictions)
    digest = hashlib.sha256(csv_bytes).hexdigest()
    metadata = {
        "schema_version": 2, "rows": len(future), "routes": list(pipeline.ROUTES),
        "coverage": {"start": start.isoformat(), "end": end.isoformat()},
        "submission_coverage": {"start": start.isoformat(), "end": min(end, pipeline.FUTURE_END).isoformat()},
        "horizon": args.horizon, "winner": "pooled_route_blend", "accuracy": DEV_MARKER,
        "quality_passed": False, "serving_mode": "diagnostic",
        "history_sha256": forecast_export.sha256(history_path),
        "forecast_sha256": digest, "forecast_version": f"pooled_route_blend:{digest[:12]}",
    }
    write(output_dir / "forecast.csv", csv_bytes)
    if reference is None:
        (output_dir / "reference_map.json").unlink(missing_ok=True)
    else:
        reference_bytes = (json.dumps(reference, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        metadata["reference_map_sha256"] = hashlib.sha256(reference_bytes).hexdigest()
        write(output_dir / "reference_map.json", reference_bytes)
    write(output_dir / "metadata.json", (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    snapshot = forecast_api.load_snapshot(output_dir)
    print(f"snapshot: {output_dir} version={snapshot.version} rows={len(future)} coverage={start}..{end} "
          f"reference_routes={[item['route'] for item in reference['routes']] if reference else []}")


if __name__ == "__main__":
    main()
