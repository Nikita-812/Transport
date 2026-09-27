"""Reproducible, bounded HTTP load benchmark for the forecast snapshot API."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx

DEFAULT_RATES = (50, 100, 200, 400)
DEFAULT_PROFILES = {
    "hour": ("/forecasts", {"route": "17", "start_date": "2025-11-03", "end_date": "2025-11-03", "hour": "8"}),
    "day": ("/forecasts", {"route": "17", "start_date": "2025-11-03", "end_date": "2025-11-03"}),
    "week": ("/forecasts", {"route": "17", "start_date": "2025-11-01", "end_date": "2025-11-07"}),
    "csv": ("/forecasts.csv", {}),
}
EXTRA_PROFILES = {
    "year_csv": ("/forecasts/export.csv", {"routes": "1,5,7,11,12,17,25,26,28,50", "start_date": "2025-11-01", "end_date": "2026-10-31", "group_by": "raw"}),
    "year_month": ("/forecasts", {"routes": "1,5,7,11,12,17,25,26,28,50", "start_date": "2025-11-01", "end_date": "2026-10-31", "group_by": "month"}),
}
PROFILES = {**DEFAULT_PROFILES, **EXTRA_PROFILES}


@dataclass(frozen=True)
class RunConfig:
    base_url: str
    duration: float = 30.0
    warmup: float = 10.0
    max_inflight: int = 256
    timeout: float = 5.0


def percentile(values: list[float], point: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * point)] * 1000


def profile_url(base_url: str, name: str) -> str:
    path, query = PROFILES[name]
    return base_url.rstrip("/") + path + ("?" + urlencode(query) if query else "")


def accepted(result: dict, rate: int) -> tuple[bool, list[str]]:
    reasons = []
    if result["error_ratio"] > 0.01:
        reasons.append("errors > 1%")
    if result["latency_ms"]["p95"] is None or result["latency_ms"]["p95"] > 300:
        reasons.append("p95 > 300ms or no completed requests")
    if result["completed_rps"] < rate * 0.95:
        reasons.append("completed RPS < 95% offered")
    return not reasons, reasons


async def run_stage(config: RunConfig, profile: str, rate: int, *, warmup: bool = False, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Schedule arrivals without queuing tasks: a full semaphore is a visible miss."""
    duration = config.warmup if warmup else config.duration
    url = profile_url(config.base_url, profile)
    totals = {"offered": 0, "started": 0, "completed": 0, "completed_in_window": 0, "errors": 0, "missed": 0, "late": 0, "late_over_interval": 0, "response_bytes": 0}
    latencies: list[float] = []
    in_flight: set[asyncio.Task] = set()
    lock = asyncio.Lock()
    interval = 1 / rate
    started_at: float
    deadline: float

    async def request(scheduled: float) -> None:
        actual = time.monotonic()
        async with lock:
            totals["started"] += 1
            if actual > scheduled:
                totals["late"] += 1
            if actual - scheduled > interval:
                totals["late_over_interval"] += 1
        try:
            response = await client.get(url)
            finished = time.monotonic()
            elapsed = finished - scheduled
            async with lock:
                totals["completed"] += 1
                totals["completed_in_window"] += finished <= deadline
                totals["response_bytes"] += len(response.content)
                latencies.append(elapsed)
                if not 200 <= response.status_code < 300:
                    totals["errors"] += 1
        except Exception:
            async with lock:
                totals["completed"] += 1
                totals["errors"] += 1
                finished = time.monotonic()
                totals["completed_in_window"] += finished <= deadline
                latencies.append(finished - scheduled)
        finally:
            semaphore.release()

    limits = httpx.Limits(max_connections=config.max_inflight, max_keepalive_connections=config.max_inflight)
    semaphore = asyncio.BoundedSemaphore(config.max_inflight)
    async with httpx.AsyncClient(timeout=config.timeout, limits=limits, transport=transport) as client:
        # Client setup is outside the fixed arrival window.
        started_at = time.monotonic()
        deadline = started_at + duration
        slots = int(duration * rate)
        for index in range(slots):
            scheduled = started_at + index * interval
            delay = scheduled - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            totals["offered"] += 1
            if time.monotonic() - scheduled > interval:
                totals["missed"] += 1
                continue
            if semaphore.locked():
                totals["missed"] += 1
                continue
            await semaphore.acquire()
            task = asyncio.create_task(request(scheduled))
            in_flight.add(task)
            task.add_done_callback(in_flight.discard)
        remaining = deadline - time.monotonic()
        if remaining > 0:
            await asyncio.sleep(remaining)
        if in_flight:
            await asyncio.gather(*in_flight)
    elapsed = time.monotonic() - started_at
    return {
        "profile": profile, "url": url, "target_rps": rate, "duration_s": duration,
        "elapsed_s": elapsed, **totals,
        "drain_s": max(0, elapsed - duration),
        "offered_rps": totals["offered"] / duration if duration else None,
        "started_rps": totals["started"] / duration if duration else None,
        "completed_rps": totals["completed_in_window"] / duration if duration else None,
        "error_ratio": totals["errors"] / totals["started"] if totals["started"] else 0,
        "missed_ratio": totals["missed"] / totals["offered"] if totals["offered"] else 0,
        "generator_limited": bool(totals["missed"] or totals["late_over_interval"]),
        "mean_response_bytes": totals["response_bytes"] / totals["completed"] if totals["completed"] else None,
        "latency_ms": {"p50": percentile(latencies, .50), "p95": percentile(latencies, .95), "p99": percentile(latencies, .99)},
        "nonstandard": warmup,
    }


def _docker_sample(container: str) -> dict:
    try:
        output = subprocess.check_output(["docker", "stats", "--no-stream", "--format", "{{json .}}", container], text=True, timeout=3)
        raw = json.loads(output)
        return {"source": "docker", "value": {"cpu_percent": raw.get("CPUPerc"), "memory": raw.get("MemUsage"), "memory_percent": raw.get("MemPerc"), "network": raw.get("NetIO"), "process_count": raw.get("PIDs"), "raw": raw}, "reason": None}
    except Exception as exc:
        return {"source": "docker", "value": None, "reason": str(exc)}


def _docker_context(container: str) -> dict:
    try:
        output = subprocess.check_output(["docker", "inspect", "--format", "{{json .HostConfig}}", container], text=True, timeout=3)
        config = json.loads(output)
        return {"source": "docker inspect", "value": {"nano_cpus": config.get("NanoCpus"), "cpu_quota": config.get("CpuQuota"), "cpu_period": config.get("CpuPeriod"), "memory_bytes": config.get("Memory"), "memory_swap_bytes": config.get("MemorySwap")}, "reason": None}
    except Exception as exc:
        return {"source": "docker inspect", "value": None, "reason": str(exc)}


def _pid_sample(pid: int, state: dict) -> dict:
    try:
        import psutil
        root = psutil.Process(pid)
        current = [root, *root.children(recursive=True)]
        cached = state.setdefault("processes", {})
        processes = [cached.setdefault(process.pid, process) for process in current]
        cpu_percent = sum(process.cpu_percent(None) for process in processes)
        first_sample = not state.get("primed")
        state["primed"] = True
        state["processes"] = {process.pid: process for process in processes}
        return {"source": "psutil", "value": {"cpu_percent": None if first_sample else cpu_percent, "cpu_percent_reason": "first psutil sample has no interval" if first_sample else None, "rss_bytes": sum(p.memory_info().rss for p in processes), "process_count": len(processes), "network": None, "network_reason": "psutil process tree cannot attribute network counters"}, "reason": None}
    except Exception as exc:
        return {"source": "psutil", "value": None, "reason": str(exc)}


async def collect_resources(stop: asyncio.Event, samples: list[dict], stage: dict, *, container: str | None, pid: int | None) -> None:
    if not container and not pid:
        samples.append({"at": datetime.now(timezone.utc).isoformat(), "stage": stage["value"], "source": None, "value": None, "reason": "no --container or --pid supplied"})
        return
    pid_state: dict = {}
    while not stop.is_set():
        sample_stage = stage["value"]
        sample = await asyncio.to_thread(_docker_sample, container) if container else await asyncio.to_thread(_pid_sample, pid, pid_state)
        sample["at"] = datetime.now(timezone.utc).isoformat()
        sample["stage"] = sample_stage
        samples.append(sample)
        try:
            await asyncio.wait_for(stop.wait(), timeout=1)
        except TimeoutError:
            pass


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def topology(base_url: str, container: str | None, explicit: str | None) -> str:
    if explicit:
        return explicit
    host = urlparse(base_url).hostname
    if host in {"127.0.0.1", "localhost", "::1"}:
        if platform.system() == "Darwin" and container:
            return "macOS loopback to Docker published port"
        return "loopback"
    return "external target; supply --topology with network details"


async def snapshot_identity(config: RunConfig) -> dict:
    try:
        async with httpx.AsyncClient(timeout=config.timeout) as client:
            response = await client.get(config.base_url.rstrip("/") + "/health")
        response.raise_for_status()
        health = response.json()
        return {"source": "/health", "value": {"snapshot_mode": health.get("serving_mode"), "quality_passed": health.get("quality_passed"), "forecast_version": health.get("forecast_version")}, "reason": None}
    except Exception as exc:
        return {"source": "/health", "value": None, "reason": str(exc)}


async def benchmark(config: RunConfig, profiles: list[str], rates: list[int], *, soak: float, container: str | None, pid: int | None, workers: int, topology_name: str | None, checkpoint: Path | None = None) -> dict:
    report = {"schema": "forecast-http-benchmark/v1", "status": "running", "started_at": datetime.now(timezone.utc).isoformat(), "config": {**config.__dict__, "profiles": profiles, "rates": rates, "soak_s": soak}, "generator": {"host": platform.node(), "platform": platform.platform(), "python": sys.version, "pid": os.getpid(), "topology": topology(config.base_url, container, topology_name)}, "service": {"workers": workers, "workers_source": "--workers (Dockerfile defaults to one)"}, "snapshot": await snapshot_identity(config), "resource_context": await asyncio.to_thread(_docker_context, container) if container else {"source": None, "value": None, "reason": "no --container supplied; PID monitoring cannot report Docker quotas"}, "resource_metrics": [], "profiles": {}, "nonstandard": config.duration != 30 or config.warmup != 10 or rates != list(DEFAULT_RATES) or profiles != list(DEFAULT_PROFILES) or soak != 900}
    if checkpoint:
        write_report(checkpoint, report)
    stop = asyncio.Event()
    current_stage = {"value": None}
    collector = asyncio.create_task(collect_resources(stop, report["resource_metrics"], current_stage, container=container, pid=pid))
    try:
        for profile in profiles:
            stages = []
            for rate in rates:
                current_stage["value"] = {"profile": profile, "target_rps": rate, "kind": "warmup"}
                await run_stage(config, profile, rate, warmup=True)
                current_stage["value"] = {"profile": profile, "target_rps": rate, "kind": "measurement"}
                stage = await run_stage(config, profile, rate)
                stage["accepted"], stage["reasons"] = accepted(stage, rate)
                stages.append(stage)
                report["profiles"][profile] = {"stages": stages}
                if checkpoint:
                    write_report(checkpoint, report)
                if not stage["accepted"]:
                    break
            report["profiles"][profile] = {"stages": stages}
            if checkpoint:
                write_report(checkpoint, report)
        day = report["profiles"].get("day", {}).get("stages", [])
        passing = [stage for stage in day if stage["accepted"]]
        if soak and passing:
            rate = passing[-1]["target_rps"]
            current_stage["value"] = {"profile": "day", "target_rps": rate, "kind": "soak"}
            soak_result = await run_stage(RunConfig(**{**config.__dict__, "duration": soak}), "day", rate)
            soak_result["accepted"], soak_result["reasons"] = accepted(soak_result, rate)
            report["soak"] = soak_result
        else:
            report["soak"] = {"value": None, "reason": "no passing day rate" if soak else "disabled by --soak 0"}
    finally:
        stop.set()
        await collector
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report["acceptance_failed"] = any(not stage["accepted"] for profile in report["profiles"].values() for stage in profile["stages"]) or bool(isinstance(report["soak"], dict) and report["soak"].get("accepted") is False)
    report["status"] = "complete"
    if checkpoint:
        write_report(checkpoint, report)
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("artifacts/http-benchmark.json"))
    parser.add_argument("--profiles", default=",".join(DEFAULT_PROFILES))
    parser.add_argument("--rates", default=",".join(map(str, DEFAULT_RATES)))
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--warmup", type=float, default=10)
    parser.add_argument("--soak", type=float, default=900)
    parser.add_argument("--max-inflight", type=int, default=256)
    parser.add_argument("--timeout", type=float, default=5)
    parser.add_argument("--workers", type=int, default=1, help="configured Uvicorn workers; Dockerfile defaults to 1")
    parser.add_argument("--topology", help="generator/target topology; inferred when omitted")
    monitor = parser.add_mutually_exclusive_group()
    monitor.add_argument("--container")
    monitor.add_argument("--pid", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    profiles = args.profiles.split(",") if args.profiles else []
    unknown = set(profiles) - set(PROFILES)
    if unknown or not profiles or args.duration <= 0 or args.warmup < 0 or args.soak < 0 or args.timeout <= 0 or args.max_inflight < 1 or args.workers < 1:
        raise SystemExit("profiles, durations, and max-inflight are invalid")
    rates = [int(rate) for rate in args.rates.split(",")]
    if not rates or any(rate < 1 for rate in rates):
        raise SystemExit("rates must be positive integers")
    report = asyncio.run(benchmark(RunConfig(args.base_url, args.duration, args.warmup, args.max_inflight, args.timeout), profiles, rates, soak=args.soak, container=args.container, pid=args.pid, workers=args.workers, topology_name=args.topology, checkpoint=args.output))
    print(args.output)
    return 1 if report["acceptance_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
