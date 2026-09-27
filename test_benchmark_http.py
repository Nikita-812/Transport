import asyncio
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from benchmark_http import RunConfig, _pid_sample, accepted, profile_url, run_stage


class BenchmarkTests(unittest.TestCase):
    def test_extra_year_profile_urls(self):
        self.assertEqual(
            profile_url("http://test", "year_csv"),
            "http://test/forecasts/export.csv?routes=1%2C5%2C7%2C11%2C12%2C17%2C25%2C26%2C28%2C50&start_date=2025-11-01&end_date=2026-10-31&group_by=raw",
        )
        self.assertEqual(
            profile_url("http://test", "year_month"),
            "http://test/forecasts?routes=1%2C5%2C7%2C11%2C12%2C17%2C25%2C26%2C28%2C50&start_date=2025-11-01&end_date=2026-10-31&group_by=month",
        )

    def test_pid_first_cpu_sample_is_unavailable(self):
        class Process:
            def __init__(self, pid):
                self.pid = pid

            def children(self, recursive):
                return []

            def cpu_percent(self, _interval):
                return 0

            def memory_info(self):
                return SimpleNamespace(rss=1)

        with patch.dict(sys.modules, {"psutil": SimpleNamespace(Process=Process)}):
            sample = _pid_sample(1, {})
        self.assertIsNone(sample["value"]["cpu_percent"])
        self.assertEqual(sample["value"]["cpu_percent_reason"], "first psutil sample has no interval")

    def test_scheduled_requests_have_truthful_counts(self):
        async def handler(request):
            self.assertIn("route=17", str(request.url))
            return httpx.Response(200, content=b"ok")

        result = asyncio.run(run_stage(
            RunConfig("http://test", duration=.2, warmup=0, max_inflight=2),
            "day", 10, transport=httpx.MockTransport(handler),
        ))
        self.assertEqual(result["offered"], 2)
        self.assertEqual(result["started"], result["completed"])
        self.assertEqual(result["errors"], 0)
        self.assertEqual(result["missed"], 0)
        self.assertEqual(result["target_rps"], 10)
        self.assertAlmostEqual(result["offered_rps"], 10)
        self.assertGreaterEqual(result["elapsed_s"], .2)
        self.assertLess(result["drain_s"], .1)
        self.assertGreater(result["latency_ms"]["p95"], 0)
        self.assertTrue(accepted(result, 10)[0])

    def test_overload_is_reported_as_a_missed_arrival(self):
        async def handler(_request):
            await asyncio.sleep(.15)
            return httpx.Response(200)

        result = asyncio.run(run_stage(
            RunConfig("http://test", duration=.2, warmup=0, max_inflight=1),
            "day", 10, transport=httpx.MockTransport(handler),
        ))
        self.assertEqual(result["offered"], 2)
        self.assertEqual(result["missed"], 1)
        self.assertTrue(result["generator_limited"])
        self.assertIn("completed RPS < 95% offered", accepted(result, 10)[1])

    def test_single_missed_arrival_is_visible_but_not_a_new_acceptance_gate(self):
        result = {"error_ratio": 0, "latency_ms": {"p95": 1}, "completed_rps": 10, "missed": 1}
        self.assertTrue(accepted(result, 10)[0])

    def test_zero_warmup_has_no_rate_division(self):
        result = asyncio.run(run_stage(RunConfig("http://test", duration=.2, warmup=0), "day", 10, warmup=True, transport=httpx.MockTransport(lambda _request: httpx.Response(200))))
        self.assertEqual(result["offered_rps"], None)

    def test_completed_rps_excludes_responses_drained_after_measurement(self):
        async def handler(_request):
            await asyncio.sleep(.25)
            return httpx.Response(200)

        result = asyncio.run(run_stage(
            RunConfig("http://test", duration=.2, warmup=0, max_inflight=2),
            "day", 10, transport=httpx.MockTransport(handler),
        ))
        self.assertEqual(result["completed"], 2)
        self.assertEqual(result["completed_in_window"], 0)
        self.assertEqual(result["completed_rps"], 0)
        self.assertGreater(result["drain_s"], .1)


if __name__ == "__main__":
    unittest.main()
