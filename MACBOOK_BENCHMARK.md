# MacBook model benchmark

Отбор выполнен по объединённым срезам май–июнь и июль–август. Сентябрь–октябрь открыт только после freeze, уже изучался в EDA и не является независимым holdout.

| run | May–Jun | Jul–Aug | early combined | Sep–Oct late | vs baseline early | early fit+predict seconds |
|---|---:|---:|---:|---:|---:|---:|
| hist_absolute_error_depth_8_lr_0.1_iter_300 | 0.85695 | 0.82725 | 0.84266 | 0.83396 | +0.03884 | 2.02 |
| ensemble_0.75_hist_absolute_error_depth_8_lr_0.1_iter_300__0.25_hist_absolute_error_depth_6_lr_0.03_iter_500 | 0.85915 | 0.82482 | 0.84263 | 0.83217 | +0.03881 | — |
| ensemble_0.75_hist_absolute_error_depth_8_lr_0.1_iter_300__0.25_hist_absolute_error_depth_6_lr_0.1_iter_300 | 0.85807 | 0.82471 | 0.84202 | 0.83388 | +0.03819 | — |
| ensemble_0.5_hist_absolute_error_depth_8_lr_0.1_iter_300__0.5_hist_absolute_error_depth_6_lr_0.03_iter_500 | 0.86048 | 0.82150 | 0.84172 | 0.82968 | +0.03790 | — |
| ensemble_0.75_hist_absolute_error_depth_8_lr_0.1_iter_300__0.25_hist_absolute_error_depth_8_lr_0.03_iter_500 | 0.85571 | 0.82616 | 0.84149 | 0.83353 | +0.03767 | — |
| baseline | 0.82669 | 0.77916 | 0.80382 | 0.86230 | +0.00000 | 0.05 |

Поздний WAPE-score выбранного по ранним срезам лидера ниже baseline: `0.83396` против `0.86230`; выбор после late-среза не менялся.

Покрытие ограничено MacBook CPU: LightGBM не установлен, Windows/GPU, полный восьмичасовой поиск и seed-повторы не выполнялись.

Freeze: `artifacts/macbook-benchmark/freeze.json`. Прогнозы финалистов: `artifacts/macbook-benchmark/finalist-predictions.csv.gz`. Полный отчёт: `artifacts/macbook-benchmark/results.json`.
