"""Inference and bounded open-loop HTTP benchmark utilities."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from pathlib import Path

import csv
from datetime import date


def percentiles(values):
    values = sorted(values)
    if not values:
        return {"p50_ms": None, "p95_ms": None, "p99_ms": None}
    def q(value):
        return values[min(len(values) - 1, math.ceil(value * len(values)) - 1)] * 1000
    return {"p50_ms": q(.5), "p95_ms": q(.95), "p99_ms": q(.99)}


def inference_benchmark(load, predict, inputs, repeats=30, warmups=5, synchronize=None):
    load_start = time.perf_counter(); model = load(); load_seconds = time.perf_counter() - load_start
    report = {"load_seconds": load_seconds, "warmups": warmups, "repeats": repeats, "profiles": {}}
    for name, value in inputs.items():
        start = time.perf_counter(); predict(model, value)
        if synchronize: synchronize()
        first = time.perf_counter() - start
        for _ in range(warmups):
            predict(model, value)
            if synchronize: synchronize()
        samples = []
        for _ in range(repeats):
            start = time.perf_counter(); predict(model, value)
            if synchronize: synchronize()
            samples.append(time.perf_counter() - start)
        report["profiles"][name] = {"first_seconds": first, "mean_seconds": statistics.mean(samples), **percentiles(samples)}
    return report


async def http_step(url, rate, duration, max_in_flight=256, timeout=5.0):
    import httpx
    latencies = []; errors = 0; late = 0; started = 0; skipped = 0
    cpu_samples = []; ram_samples = []; stop_sampling = asyncio.Event()
    async def sample_resources():
        try:
            import psutil
            while not stop_sampling.is_set():
                cpu_samples.append(psutil.cpu_percent(interval=None)); ram_samples.append(psutil.virtual_memory().used)
                await asyncio.sleep(.5)
        except ImportError:
            return
    begin = time.perf_counter(); offered = int(rate * duration)
    async with httpx.AsyncClient(timeout=timeout) as client:
        sampler = asyncio.create_task(sample_resources())
        async def one(planned):
            nonlocal errors, late, started
            if time.perf_counter() - planned > 1 / rate: late += 1
            started += 1; tick = time.perf_counter()
            try:
                response = await client.get(url)
                if response.status_code >= 400: errors += 1
            except Exception:
                errors += 1
            latencies.append(time.perf_counter() - tick)
        in_flight = set()
        for index in range(offered):
            planned = begin + index / rate
            delay = planned - time.perf_counter()
            if delay > 0:
                await asyncio.sleep(delay)
            in_flight = {task for task in in_flight if not task.done()}
            if len(in_flight) >= max_in_flight:
                skipped += 1
                continue
            task = asyncio.create_task(one(planned)); in_flight.add(task)
        if in_flight:
            await asyncio.gather(*in_flight)
        stop_sampling.set(); await sampler
    elapsed = time.perf_counter() - begin
    completed = len(latencies)
    return {"offered": offered, "started": started, "completed": completed,
            "offered_rps": offered / duration, "started_rps": started / elapsed, "completed_rps": completed / elapsed,
            "errors": errors, "error_rate": errors / completed if completed else 1.0, "late": late, "skipped": skipped,
            "duration_seconds": elapsed, "system_cpu_mean_percent": statistics.mean(cpu_samples) if cpu_samples else None,
            "system_cpu_max_percent": max(cpu_samples) if cpu_samples else None,
            "system_ram_max_bytes": max(ram_samples) if ram_samples else None, **percentiles(latencies)}


async def http_benchmark(base_url, rates=(50, 100, 200, 400), duration=30):
    profiles = {
        "hour": "/forecasts?route=17&start_date=2025-11-03&end_date=2025-11-03&hour=8",
        "day": "/forecasts?route=17&start_date=2025-11-03&end_date=2025-11-03",
        "week": "/forecasts?route=17&start_date=2025-11-01&end_date=2025-11-07",
        "csv": "/forecasts.csv",
    }
    result = {"profiles": {}, "generator": "bounded open-loop asyncio/httpx"}
    for name, path in profiles.items():
        steps = []
        for rate in rates:
            item = await http_step(base_url.rstrip("/") + path, rate, duration); item["requested_rps"] = rate; steps.append(item)
            if item["error_rate"] > .01 or (item["p95_ms"] or 0) > 300 or item["completed_rps"] < .95 * rate:
                break
        result["profiles"][name] = steps
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(); commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("http"); p.add_argument("--base-url", required=True); p.add_argument("--duration", type=float, default=30); p.add_argument("--output", type=Path, required=True)
    p = commands.add_parser("stable"); p.add_argument("--url", required=True); p.add_argument("--rate", type=float, required=True); p.add_argument("--duration", type=float, default=900); p.add_argument("--output", type=Path, required=True)
    p = commands.add_parser("inference"); p.add_argument("--bundle", type=Path, required=True); p.add_argument("--data-dir", type=Path, required=True); p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "http":
        result = asyncio.run(http_benchmark(args.base_url, duration=args.duration))
    elif args.command == "stable":
        result = asyncio.run(http_step(args.url, args.rate, args.duration)); result["requested_rps"] = args.rate; result["profile"] = "stable"
    else:
        from models import load_candidate
        import pipeline
        with (args.data_dir / "future.csv").open(newline="", encoding="utf-8") as stream:
            rows = [{**r, "route": int(r["route"]), "date": date.fromisoformat(r["date"]), "hour": int(r["hour"]),
                     **{f: int(r[f]) for f in pipeline.CALENDAR_FIELDS}} for r in csv.DictReader(stream, delimiter=";")]
        def load(): return load_candidate(args.bundle)["candidate"]
        def predict(model, value):
            if isinstance(model, dict):
                left, right = model["left"].predict(value), model["right"].predict(value); weight = model["left_weight"]
                return [weight*a + (1-weight)*b for a,b in zip(left,right)]
            return model.predict(value)
        result = inference_benchmark(load, predict, {"one": rows[:1], "day": rows[:24], "full": rows})
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
