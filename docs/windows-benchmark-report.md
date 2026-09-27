# Windows model and serving benchmark

Date: 2026-09-27. This report covers the available Windows workstation only. It does not claim a macOS run or a constrained Linux SLA.

## Environment

- Windows 11 build 26200; AMD Ryzen 7 7700-class CPU (16 logical processors); 33,346,736,128 bytes RAM.
- NVIDIA GeForce RTX 5070 Ti, 16,303 MiB; driver 610.88.
- Python 3.12.14 in project `.venv`. The requested project Python 3.13.5 was not installed on this host.
- PyTorch 2.8.0 installed from the default Windows index was CPU-only. MLP/DLinear GPU runs therefore failed explicitly; no CPU fallback was hidden.
- CatBoost and XGBoost GPU smoke fits succeeded. LightGBM/macOS/N-HiTS were not run.

Input hashes are recorded in `configs/experiments.windows.json` and verified by preflight. The processed history/future grids contained 72,960 and 14,640 unique keys.

## Model selection

The campaign recorded 24 attempts: 22 completed and 2 explicit unsupported-backend failures. Selection used only May-June and July-August.

| Candidate | Early WAPE | WAPE-score |
| --- | ---: | ---: |
| XGBoost GPU, depth 8, lr 0.03, 500 trees | 0.176916 | 0.823084 |
| HistGradientBoosting L1, 500 iterations | 0.177150 | 0.822850 |
| HistGradientBoosting L1, 300 iterations | 0.177903 | 0.822097 |
| Seasonal baseline | about 0.196 | about 0.804 |

The best permitted pair was frozen before the late check: 75% HistGradientBoosting L1 plus 25% HistGradientBoosting Poisson. Early WAPE was 0.175655 (score 0.824345). Freeze SHA-256: `3e6e4e0b92700105a2be71c18a62fd2381f279277834a765e8d76923356df09b`.

September-October was opened only by `final-check`. The frozen ensemble degraded to WAPE 0.214514 (score 0.785486), while the seasonal baseline reached WAPE 0.137704 (score 0.862296). The frozen choice was not changed after seeing this result. The baseline is the conservative fallback.

Final export SHA-256: `49026e491ca47f3ec5eaa0887c78884fb45c131bb7f0858c2ffc74ba0c2a5546`. Bundle SHA-256: `653603e60aa585126efc67bb126b46bb69e4e15dcf4d4c005d81b892f73236e2`. The export contains 14,640 sorted unique non-negative rows; the bundle passed local Windows round-trip tolerance checks.

## Inference

Thirty timed calls after five warmups, with training stopped:

| Rows | p95 |
| ---: | ---: |
| 1 | 6.40 ms |
| 24 | 6.13 ms |
| 14,640 | 180.38 ms |

Bundle load time was 1.225 s. These are CPU inference measurements for the selected ensemble.

## HTTP benchmark

Uvicorn ran one worker on loopback without access logs. The generator shared the workstation CPU, used a bounded in-flight set, and reported offered/started/completed separately.

- Short day-profile step at 200 offered RPS: about 198 completed RPS, p95 46.97 ms, zero errors.
- Short 400 RPS step failed: about 103 completed RPS, p95 2.93 s.
- Fifteen-minute 200 RPS run failed: 180,000 offered, 94,774 completed, 85,226 skipped, 14 errors, 105.17 completed RPS, p95 2.692 s.
- Fifteen-minute 100 RPS run passed: 90,000 offered/started/completed, zero skipped, zero errors, 99.95 completed RPS, p50 7.61 ms, p95 11.86 ms, p99 14.49 ms. System CPU mean/max was 9.81%/47.3%; maximum system-used RAM was 19,000,324,096 bytes.

The RAM number is whole-system used memory, not service RSS. Loopback results do not confirm performance on 2-4 vCPU/2-4 GiB Linux or over a network.

## Reproduction

```powershell
.\.venv\Scripts\python.exe -m unittest -v
.\.venv\Scripts\python.exe -m pipeline prepare --archive dataset --output-dir data\processed
.\.venv\Scripts\python.exe -m windows_experiments preflight --manifest configs\experiments.windows.json --data-dir data\processed --report artifacts\benchmark\preflight-windows-rev2.json
.\.venv\Scripts\python.exe -m windows_experiments run --manifest configs\experiments.windows.json --data-dir data\processed --output-dir artifacts\experiments\tram-2025-windows-benchmark\windows --device windows
.\.venv\Scripts\python.exe -m windows_experiments merge --manifest configs\experiments.windows.json --results artifacts\experiments\tram-2025-windows-benchmark\windows --output artifacts\benchmark\merge-windows-rev2.json
.\.venv\Scripts\python.exe -m windows_experiments ensembles --merge artifacts\benchmark\merge-windows-rev2.json --data-dir data\processed --output artifacts\benchmark\ensembles-windows.json
.\.venv\Scripts\python.exe -m windows_experiments freeze --merge artifacts\benchmark\merge-windows-rev2.json --ensembles artifacts\benchmark\ensembles-windows.json --output artifacts\benchmark\freeze.json
.\.venv\Scripts\python.exe -m windows_experiments final-check --freeze artifacts\benchmark\freeze.json --data-dir data\processed --output artifacts\benchmark\final-check.json
.\.venv\Scripts\python.exe -m windows_experiments export-frozen --freeze artifacts\benchmark\freeze.json --data-dir data\processed --output artifacts\benchmark\submission.csv --bundle artifacts\models\final-ensemble.pkl
```

Unverified or incomplete: macOS installation and runs, true two-device exchange, LightGBM, GPU PyTorch models, per-process VRAM peaks, all-finalist inference benchmarking, limited-Linux SLA, and an eight-hour two-device campaign.
