# Diagnostic HTTP benchmark

`artifacts/http-diagnostic.json` is the authoritative full report. It measured the frozen diagnostic snapshot `hist_absolute_error_depth_8_lr_0.1_iter_300:f207599abc9f`; `/health` reported `serving_mode: diagnostic` and `quality_passed: false`, which the benchmark report records as `snapshot_mode: diagnostic`. These are serving measurements, not production-quality evidence.

Run: `2026-09-27T06:28:49.856114+00:00`–`2026-09-27T06:54:30.767829+00:00`, status `complete`, exit 0, standard profile, 16 accepted stages, no errors. Generator: `MacBook-Pro.local`, macOS 27 ARM, Python 3.13.5. Topology: macOS loopback to the Docker Desktop published port; generator and target shared the host and training was stopped.

```bash
python3 -m benchmark_http --base-url http://127.0.0.1:8000 --container transport-forecast-1 --workers 1 --topology 'macOS loopback to Docker Desktop published port; generator and target share host; training stopped' --output artifacts/http-diagnostic.json
```

Container inspect recorded `NanoCpus=2000000000`, `Memory=2147483648`, and `MemorySwap=2147483648`; because the last two are equal, the configured extra swap is zero. The service used one configured Uvicorn worker. The protocol was 10-second warmup and 30-second measured stages for hour/day/week/CSV at 50, 100, 200, and 400 requested RPS, then a 900-second day soak at the highest passing rate.

| Profile, 400 requested RPS | Completed RPS | p95 ms | p99 ms | Errors | Missed |
|---|---:|---:|---:|---:|---:|
| hour | 399.400000 | 4.230750 | 6.211292 | 0 | 18 |
| day | 399.633333 | 3.995083 | 5.288750 | 0 | 11 |
| week | 399.800000 | 3.935792 | 4.715500 | 0 | 6 |
| csv | 399.066667 | 3.975125 | 8.035041 | 0 | 27 |
| day soak, 900 s | 399.107778 | 4.017041 | 5.108583 | 0 | 802 |

The soak offered 360,000 requests and completed 359,197 in-window; missed ratio was 0.2227778%. All stages passed the specified error, p95, and completed-RPS gates. `generator_limited: true` retained missed/late generator accounting rather than hiding it. Short-stage resources (192 samples): CPU mean/max 25.09823%/51.36%, RAM 36.05–37.89 MiB. Soak resources (337 samples): CPU mean/max 45.40047%/53.52%, RAM 36.66–39.29 MiB. CPU percent is one-core based.

This shared-host macOS/Docker Desktop result does not establish a separate constrained Linux-server SLA.

## First expanded-year run: failed, not accepted

`artifacts/http-diagnostic-year-first.json` is the authoritative report for the first expanded-year attempt. The year image `231a098112d7` built and launched; live HTTP confirmed the 87,600-row CSV, twelve monthly totals, and the legacy 14,640-row subset. The UI showed twelve groups for yearly routes 1 and 7. These checks do not complete expanded-service acceptance; remaining UI checks wait for a rebuild.

The 50 RPS `year_csv` stage passed with p95 `16.380 ms`. Its 100 RPS stage failed: completed RPS `69.733`, p95 `7567.857 ms`, and 16 errors. The `year_month` 50 RPS stage failed with p95 `5006.451 ms` and 1,497 errors. The service was stopped for compression/aggregation fixes. No final expanded-year performance result exists for the new code.

The root suite passed 59 tests in 5.713 seconds before this run. The completed legacy diagnostic report above remains unchanged.

## Compressed expanded-year rerun: partial, not accepted

`artifacts/http-diagnostic-year-compressed.json` is the authoritative compressed rerun. It completed with `nonstandard: true` and `acceptance_failed: true`, because `year_csv` did not sustain 400 RPS. This is a supplemental year scope, not the completed legacy protocol.

After gzip and bounded aggregation cache, `year_csv` passed 50/100/200 RPS. At 400 RPS it failed only the completed-RPS gate: `369.866667` completed RPS, p95 `18.766166 ms`, 0 errors, and 900 missed arrivals. `year_month` passed 400 RPS: `398.966667` completed RPS, p95 `4.251125 ms`, 0 errors, and 29 missed arrivals. The 50/100/200 stages passed for both profiles.

The plain year CSV is 2,901,675 bytes; its gzip representation is 513,059 bytes. The decompressed SHA-256 is `231a098112d78d9069f23bcb03f63719053d82508570f44a0a5dec413ec17180`.

The root suite passed 62 tests in 7.787 seconds. API checks covered day/hour output, invalid-range clearing, CSV and total; year routes 1 and 7 produced 12 monthly groups, and keyboard reference-stop selection worked. OSM iframe browser proof and the final standard protocol remain pending. No final expanded-service performance claim is made.

## Final standard diagnostic report

`artifacts/http-diagnostic-year-standard.json` is the final standard report: `2026-09-27T08:19:38.404522+00:00`–`2026-09-27T08:45:20.612718+00:00`, exit 0, `nonstandard: false`, and `acceptance_failed: false`. It used backend hash `12f094643f98f246d699274d9904584a9afd182dfab697f36a8dc18192f49280` with diagnostic snapshot `hist_absolute_error_depth_8_lr_0.1_iter_300:231a098112d7`.

All 16 short stages passed. At 400 RPS, completed RPS/p95 ms/p99 ms/errors/missed were: hour `399.2/4.498291/6.484083/0/24`; day `398.933333/4.602584/6.603084/0/32`; week `398.266667/4.788500/7.261708/0/51`; CSV `398.7/3.704834/4.829584/0/39`.

The 900-second day soak offered 360,000 requests and completed 358,609 in-window: `398.454444` completed RPS, p95 `4.511458 ms`, p99 `6.772833 ms`, 1 error (`error_ratio 0.000002788552`), 1,391 missed (`0.386389%`), and `generator_limited: true`; it passed. CPU soak samples (337) averaged `41.569852%`, maxed at `49.16%` on a one-core basis, and RAM was `54.99–57.61 MiB`.

Functional checks verified day/month/year/hour/multi-route views, CSV, invalid-range clearing, totals, keyboard reference-stop selection, and direct OSM URL/marker behaviour. The inline OSM iframe is blank in the IAB and remains unconfirmed as a browser-policy outcome. This is diagnostic serving evidence only: WAPE remains below 0.95, no stop forecast is available without a boarding-to-stop link, and weather has no input source.
