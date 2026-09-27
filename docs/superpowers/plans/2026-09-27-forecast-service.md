# Forecast service: current acceptance and evidence

## Current acceptance

The user goal remains a model with absolute WAPE-score **>= 0.95 on every fixed validation slice**, followed by the expanded service below and measured HTTP performance under the intended Docker limits: 2 CPU, 2 GiB memory, and no additional swap. Score retention is not acceptance.

Until that score is achieved, the service is diagnostic only. `artifacts/service-diagnostic` has metadata `serving_mode: "diagnostic"` and `quality_passed: false`; its UI/API/performance evidence demonstrates serving behaviour only. Production export to `artifacts/service` must continue to reject scores below 0.95.

- [ ] A new, non-duplicative model run records absolute WAPE-score >=0.95 on every fixed slice, command, code/input hashes, and results under `artifacts/accuracy/` (or the selected model evidence directory).
- [ ] Production quality/export succeeds and writes `artifacts/service/quality.json`, `forecast.csv`, and `metadata.json` with `quality_passed: true`.
- [x] Diagnostic FastAPI/static frontend is verified with the frozen incumbent snapshot; production-snapshot verification remains pending the quality gate.
- [x] Diagnostic HTTP benchmark completed and preserved `artifacts/http-diagnostic.json`; production performance evidence remains pending the quality gate.
- [ ] Docker resource evidence confirms limits for the final production run and records generator topology. A shared-host macOS loopback result does not by itself prove a remote constrained-server SLA.

### User requirements superseding the legacy snapshot scope

- [ ] Serve 1-day, 1-month, and 1-year horizons with route/time filters and aggregation.
- [ ] Provide an interactive time chart and Moscow map with reference stops; CSV export is sufficient for now.
- [ ] Include hour, weekday, and seasonality when data supports them; weather remains conditional because no weather input is available.
- [ ] Review `artifacts/service-diagnostic-year` (87,600 observed rows), calendar 2026, aggregation API, chart, and reference geography before new final HTTP benchmarking; OSM iframe still needs browser proof.
- [ ] Stop-level forecasting remains pending a linked source: raw events have no stop ID and `place_id` is a depot/site. The reference XLSX (489 stops, 622 ordered coordinates; forecast-route overlap only 1/5/7/11/12) supports a map, not a stop forecast.

The legacy November–December 2025 route/hour snapshot is partial and does not fulfil these requirements. Stop metadata or map rendering must not be described as stop-level forecast fulfilment.

The first year report failed. The compressed supplemental rerun at `artifacts/http-diagnostic-year-compressed.json` completed but has `acceptance_failed: true`: CSV 50/100/200 passed, CSV 400 failed at `369.866667` completed RPS despite p95 `18.766166 ms` and 0 errors; month aggregation passed 400 at `398.966667` completed RPS and p95 `4.251125 ms`.

Final standard diagnostic evidence is `artifacts/http-diagnostic-year-standard.json`: `2026-09-27T08:19:38.404522+00:00`–`2026-09-27T08:45:20.612718+00:00`, exit 0, `nonstandard: false`, `acceptance_failed: false`, all 16 short stages accepted. Backend hash: `12f094643f98f246d699274d9904584a9afd182dfab697f36a8dc18192f49280`; snapshot: `hist_absolute_error_depth_8_lr_0.1_iter_300:231a098112d7`. At 400 RPS, hour/day/week/CSV completed RPS were `399.2/398.933333/398.266667/398.7`, with p95 `4.498291/4.602584/4.788500/3.704834 ms` and zero errors. The 900-second day soak passed at `398.454444` RPS, p95 `4.511458 ms`, p99 `6.772833 ms`, 1 error, and 1,391 misses (`generator_limited: true`); CPU mean/max `41.569852%/49.16%` one-core basis, RAM `54.99–57.61 MiB`.

After the expanded service review, run the final protocol with standard 10-second warmup, 30-second measurement, and 50/100/200/400 RPS; use `--soak 0` for this supplemental year scope because it is not the historical day-soak protocol.

```bash
python3 -m benchmark_http --base-url http://127.0.0.1:8000 --container transport-forecast-1 --workers 1 --profiles year_csv,year_month --soak 0 --output artifacts/http-diagnostic-year.json
```

## Current diagnostic service evidence

Docker image build and startup passed with Python `3.13.5-slim`. Running container `transport-forecast-1` reports `NanoCpus=2000000000`, `Memory=2147483648`, and `MemorySwap=2147483648`. It serves frozen-incumbent diagnostic snapshot `hist_absolute_error_depth_8_lr_0.1_iter_300:f207599abc9f`.

The live contract check passed: day query 24 rows, hour query one row, invalid requests 422, CSV 14,640 unique nonnegative rows with matching SHA, and HTML root. Browser checks passed for default 24 rows, hour 8 one row, reversed-date validation, and zero-valued route 5. Expanded checks verified day/month/year/hour/multi-route/CSV views, invalid-range clearing, totals, keyboard stop selection, and direct OSM URL/marker; the inline iframe remains blank in IAB and unconfirmed. The latest full suite passed 62 tests in 7.787 seconds; `git diff --check` passed.

### Completed HTTP run

Session `56180` ran from `2026-09-27T06:28:49.856114+00:00` to `2026-09-27T06:54:30.767829+00:00`, exited 0, and wrote a complete standard report (`nonstandard: false`, `acceptance_failed: false`). All 16 short stages passed. At 400 requested RPS, completed RPS/p95 ms/errors/missed were hour `399.4/4.230750/0/18`, day `399.633333/3.995083/0/11`, week `399.8/3.935792/0/6`, and CSV `399.066667/3.975125/0/27`.

```bash
python3 -m benchmark_http --base-url http://127.0.0.1:8000 --container transport-forecast-1 --workers 1 --topology 'macOS loopback to Docker Desktop published port; generator and target share host; training stopped' --output artifacts/http-diagnostic.json
```

The 900-second day soak completed at target 400 RPS: offered `360000`, completed in-window `359197`, completed RPS `399.10777777777776`, p95 `4.017040999315213` ms, p99 `5.1085829982184805` ms, errors `0`, missed `802` (`0.2227778%`), and `generator_limited: true`. The accepted result does not hide those generator misses. Resource samples were available: short stages (192 samples) CPU mean/max `25.09823%/51.36%`, RAM `36.05–37.89 MiB`; soak (337 samples) CPU mean/max `45.40047%/53.52%`, RAM `36.66–39.29 MiB`. CPU percent is one-core based. The container had 2 CPU and 2 GiB RAM; `MemorySwap` equalled `Memory`, so configured extra swap was zero.

Diagnostic setup command, never quality acceptance:

```bash
python3 -m forecast_export --diagnostic --data-dir data/processed --freeze artifacts/macbook-benchmark/freeze.json --results artifacts/macbook-benchmark/results.json --output-dir artifacts/service-diagnostic
FORECAST_SNAPSHOT_DIR=./artifacts/service-diagnostic docker compose up -d --build
```

Production quality/export command after a qualifying freeze exists:

```bash
python3 -m forecast_export --data-dir data/processed --freeze artifacts/macbook-benchmark/freeze.json --results artifacts/macbook-benchmark/results.json --output-dir artifacts/service
```

## Historical model results

These are measurements already made. Do not repeat them. The frozen winner remains immutable; later candidates use early slices only and did not open a new late evaluation.

| Run | May–June | July–August | Early combined | Late | Notes |
|---|---:|---:|---:|---:|---|
| Frozen HGB winner | 0.8569491031363826 | 0.827249659505492 | 0.8426582436223181 | 0.8339646269476946 | frozen incumbent |
| Profiles, iteration 1 | 0.7810820431182067 | 0.8432921981059021 | 0.811016495639487 | — | 3.835s |
| Residual, iteration 2 | 0.7466318040997776 | 0.8216491156173606 | 0.7827288392275848 | — | 3.859s |
| Iteration 3 | 0.8429673803121243 | 0.7686443449895637 | 0.807204418902678 | — | early slices only |
| Iteration 4 | 0.8347909597405083 | 0.8244193711040455 | 0.8298003303541991 | — | early slices only |
| `per_route_hgb`, iteration 5 | 0.8597336325612007 | 0.835122582872072 | 0.847891220360752 | — | previous early-score best |
| `hierarchical_hgb`, iteration 6 | 0.8505674636468166 | 0.7884198245631713 | 0.8206630926992277 | — | 6.871688958s; rejected |
| `pooled_route_blend`, iteration 7 | 0.8609411966587857 | 0.8349985464966838 | 0.8484580413008345 | — | current early-score best; freeze unchanged |
| `seasonal_interaction`, iteration 8 | 0.7988347795185595 | 0.7373910274434788 | 0.7692691068468773 | — | rejected |
| `raw_activity_hgb`, iteration 9 | 0.7739282721688941 | 0.8369533543409158 | 0.8042548535815481 | — | 5.357792875s; rejected |
| `per_route_device_density`, iteration 10 | 0.8413697837929827 | 0.83140189923337 | 0.8365734098384997 | — | 10.440351457997167s; rejected |
| `pooled_fare_components`, iteration 11 | 0.8409473855500834 | 0.8097351673160399 | 0.8259286050150468 | — | 14.934323916s; rejected |
| `per_route_fare_components`, iteration 12 | 0.8437722127181352 | 0.8249609331514642 | 0.8347205497675378 | — | 17.918972416999168s; rejected |

The former rule to stop after iterations 1 and 2 was a dated, superseded exploration rule: two nonimproving candidates ended that planned batch. It did not retire the absolute-0.95 goal. None of the measurements in this table meets the required score.

The remaining gap is from early combined `0.8484580413008345` to the required `0.95`. The temporal-shift raw-activity hypothesis was measured once and rejected; its rawless control matched profiles (`0.811016495639487`). Extraction completed with `62,443,497` events total (`49,051,926` train and `13,391,571` test), `62,442,882` kept, `615` excluded outside January–October, `59,667,191` boardings, and `72,960` hourly keys with `0` mismatches; metadata is `data/processed/raw_activity.metadata.json`. No new late evaluation is open.

Raw fares were extracted once from `62,443,497` events into `1,574,655` positive-fare-hour rows with all `72,960` parent keys and `59,667,191` boardings; metadata is `data/processed/raw_fares.metadata.json`. Iteration 11 diagnostics were corrected in `artifacts/accuracy/iteration-11/results-corrected.json` (hash `17c8ed51eaa29271e1f5b76c52dd021587367da5655dda63ae8d17bbaba66f82`); this reporting-only repair left its original score and CSV unchanged, and independent WAPE recomputation verified that fact. The latest accuracy-specific suite passed 16 tests in 3.315 seconds; the last full-suite result remains 49 tests in 5.285 seconds.

```bash
python3 -u -m raw_activity
python3 -m accuracy --variant raw_activity_hgb --output-dir artifacts/accuracy/verification-raw-activity
```

Use a fresh output directory; do not overwrite measured iterations. Raw input scanning is complete, and prior exhaustion conclusions are retracted. The next investigation inspects complementary errors in saved predictions; it has no result yet.

Earlier baseline reference: May–June `0.82669`, July–August `0.77916`, early combined `0.80382`, late `0.86230`. An earlier pre-Docker verification ran 26 tests in 1.445 seconds; it is superseded by the current 44-test/Docker/UI evidence above.

## Scope and constraints

The API uses a ready, immutable forecast snapshot: `/health`, `/forecasts`, `/forecasts.csv`, and the static root. HTTP timing never includes training. The benchmark records snapshot mode/quality/version, one configured Uvicorn worker, Docker resource context, and generator topology. The governing HTTP method is `openspec/changes/benchmark-models-on-two-devices/design.md` §8; the HTTP contract is `openspec/changes/benchmark-models-on-two-devices/specs/forecast-serving-benchmark/spec.md`.

## Paused at user request

The user requested finish-stage-and-stop after the final wrap. No new model runs, benchmark runs, raw scans, or measurements are authorized. `raw_recurrence` extractor code and its test were reviewed, but its full scan has **never run** and remains pending. Resume only on an explicit new user request.
