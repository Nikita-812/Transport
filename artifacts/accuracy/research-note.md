# Accuracy research note

## Evidence retained for later iterations

- The archive README states that November--December raw data are unavailable.
  Realized raw-event values in a forecast horizon are therefore forbidden.
  The earlier conclusion that all raw-event columns were ineligible is
  retracted: aggregates frozen strictly before each forecast origin are valid
  historical features, provided their training construction uses the same
  temporal shift.
- `test_submission.csv` is explicitly a baseline (about 0.48), not a signal.
- The reference workbook timetable is not a forecast schedule: its
  `Расписание` sheet covers only route 1, and its `Наряд` sample is dated
  2026-02-08. Do not use either as a feature for 2025-11--12.
- Fixed-origin selection remains May--June and July--August. September--October
  remains diagnostic only and must not select a configuration.

## Rejected iteration 3: daily total × hourly share

`daily_share` freezes an eight-week (56-day) route × calendar-day daily-total
profile at each origin, with all-history fallback. It allocates that total by
the all-history normalized route × calendar-day × hour share. This separates
route-level operating changes from the intraday shape and makes every predicted
route-day sum exactly its predicted daily total. The configuration is fixed,
not tuned on September--October.

It scored `0.8429673803121243` on May--June and `0.7686443449895637` on
July--August, for `0.807204418902678` combined. This is below the frozen
incumbent (`0.8426582436223181`), so it is rejected; the strong July failure
means that merely changing the fixed history window is not a productive path.

## Candidate: train-only calibrated HGB daily volume

The incumbent's hourly predictions have two independent diagnostic gaps. If
its per-day total were known, its scores would be about `0.90894` (May--June)
and `0.90454` (July--August); if its hourly shape were known, they would be
about `0.89412` and `0.86372`. These are diagnostic oracle decompositions,
not achieved results. Daily-volume error is the larger component in both
slices, so the next candidate preserves the incumbent's hourly shape and
calibrates its daily total.

For every final cutoff, `calibrated_hgb` recreates the frozen incumbent on
earlier fully observed 61-day horizons inside the training period. It takes
the median actual/predicted daily-total ratio by route and calendar-day class,
then applies that frozen factor to the final incumbent forecast. It uses no
label after the final origin and does not select on September--October.

Run the prescribed early evaluation once:

```bash
python3 -m accuracy --variant calibrated_hgb --output-dir artifacts/accuracy/iteration-4
```

The target remains unmeasured for this candidate until that command completes.
No feasible-score floor is claimed.

## Rejected iteration 4: train-only calibrated HGB daily volume

It scored `0.8347909597405083` on May--June and `0.8244193711040455` on
July--August, for `0.8298003303541991` combined. It did not improve the frozen
incumbent. The daily-level diagnostic correctly identified a major error source,
but its train-only ratio correction did not transfer across the long horizon.

## Candidate: per-route HGB

The pooled HGB has a single limited tree budget for route, calendar, hour, and
time interactions. The observed route errors differ sharply (for example,
route 7 collapses on July--August while routes 1 and 17 remain substantially
better), so the next minimal test fits the exact frozen incumbent parameters
separately for each active route. This changes capacity allocation only;
features, targets, fixed origins, WAPE, and the all-zero route 5 rule remain
unchanged. Parameters are emitted into the candidate's `results.json` config.

```bash
python3 -m accuracy --variant per_route_hgb --output-dir artifacts/accuracy/iteration-5
```

## Iteration 5 result: per-route HGB

It scored `0.8597336325612007` on May--June and `0.835122582872072` on
July--August, for `0.847891220360752` combined. This improves the original
frozen incumbent by `0.005232976738433925` on the early selection slices and
is the current candidate best, but it does not meet the `0.95` target. The
original freeze remains immutable, and September--October has not been
evaluated for this candidate.

The next direction, after the HTTP benchmark completes, is to inspect whether
the per-route residual is concentrated in daily volume or hourly shape before
adding another model. No further fixed-window search is warranted.

## Candidate: hierarchical per-route HGB

The early improvement from per-route HGB supports separating route-specific
calendar/hour capacity. The next candidate fits, for each active route, one
frozen-parameter HGB to daily totals and another to train-derived hourly shares
of each daily total. Predicted shares are normalized on the requested offline
full route-day grid, so the hourly forecast sums exactly to the predicted daily
volume; an all-zero share prediction uses a uniform 24-hour fallback. No validation
target contributes to either model or normalization. This is distinct from the
rejected static `daily_share` profile because both factors are learned HGB
functions of the available calendar/history features.

```bash
python3 -m accuracy --variant hierarchical_hgb --output-dir artifacts/accuracy/iteration-6
```

## Rejected iteration 6: hierarchical per-route HGB

It scored `0.8505674636468166` on May--June and `0.7884198245631713` on
July--August, for `0.8206630926992277` combined. It is rejected; the learned
daily/share decomposition transferred worse than the direct per-route HGB.

## Residual diagnosis for the current candidate best

The current best remains iteration 5 (`0.847891220360752`). Its May--June
error is broad: the largest 20 route-days account for only 15.4% of absolute
error, holidays account for 5.9%, and no route-day is below 20% of its
pre-cutoff same-weekday median. July--August is different: weekdays contribute
79.1% of absolute error, route 7 alone contributes 24.1%, with a positive
prediction bias of 401,255 boardings. Thirty-one route-days fall below half of
their pre-cutoff same-weekday median and account for 19.1% of all error; the
largest are sustained route-7 weekday shortfalls, not isolated zero-service
days. There are no days below 20% of the matching pre-cutoff median.

This points to an unobserved summer operating/demand regime rather than an
hour-shape defect or a few repairable anomalies. A valid next signal would be
a dated, pre-origin route service calendar or additional prior-year history;
the supplied timetable remains ineligible because it is a 2026 sample. Do not
add another generic window, ensemble, or calendar-only model without such a
signal.

## Official-source route 7 research pass

- The [Moscow Transport notice of 28 June 2025](https://t.mos.ru/mostrans/all_news/125125)
  says that from 28 June route 7 runs to Novoslobodskaya rather than Belorussky
  station on weekends, with replacement bus 09к, during track repairs on
  Palikha Street. It is eligible at the 30 June origin and applies to the
  July--August weekend portion, but is ineligible at the 30 April origin. It
  cannot explain the dominant weekday residual because the notice says weekday
  service remains normal.
- The [15 August 2025 notice](https://transport.mos.ru/mostrans/all_news/125846)
  describes the same weekend-only pattern from 16 August. It is retrospective
  for the 30 June origin and must not become a feature. The 7 August and later
  route-7 notices found are likewise post-origin and ineligible.
- A targeted search of Moscow Transport notices did not find a route-7 service
  notice published by 30 April that could explain May--June, nor a pre-30-June
  official notice of the July weekday collapse. This is a search result, not a
  claim that no such notice exists.

## Repo-only ensemble check

The existing pooled incumbent and per-route HGB forecasts have partly
complementary residuals, but mostly agree in sign (75.9% on May--June and
76.3% on July--August). Their fixed 50/50 average scores `0.8609411966587857`
and `0.8349985464966838`, or `0.8484580413008345` combined: only
`0.0005668209400825` above iteration 5. It is a measurable but marginal
repo-only path, far from the target; any production selection would still need
a train-only weight rule rather than choosing 50/50 from these same slices.

## Candidate: fixed pooled/per-route blend

The marginal blend result is retained as a diagnostic, not a measured candidate
result. `pooled_route_blend` uses the exact frozen pooled HGB and the exact
per-route HGB with a predeclared `0.5` per-route weight, then applies the
shared nonnegative/all-zero-route guard. Its report records both parameter sets,
the weight, history hash, and accuracy-source hash.

```bash
python3 -m accuracy --variant pooled_route_blend --output-dir artifacts/accuracy/iteration-7
```

## Iteration 7 result: fixed pooled/per-route blend

It scored `0.8609411966587857` on May--June and `0.8349985464966838` on
July--August, for `0.8484580413008345` combined. This is the current early
candidate best, but `target_met` is false and the original frozen benchmark
remains unchanged. September--October has not been evaluated for this
candidate. No available result proves that `0.95` is achievable from the
supplied information.

## Train-visible drift check

After removing same-weekday levels, 84-day pre-origin daily-total trends are
weak individually (R² `0.001`--`0.185`). At the 30 June cutoff, eight of nine
active routes have a negative slope; route 7 is `-56` boardings/day, implying
only about `-3,436` over 61 days. This has the correct direction for the
July--August residual, but is far smaller than its observed summer drop. The
slopes at the 30 April cutoff have several opposite signs, so an unregularized
long extrapolation is not supported.

The smallest evidence-based repo-only candidate is therefore a regularized
seasonal interaction regression: route × weekday × hour intercepts with a
route-specific linear time term whose coefficient is learned from only prior
fixed-origin examples and strongly damped toward zero. This differs from the
catalog Ridge, which had additive calendar encoding and no route × weekday ×
hour interaction. It may correct the modest shared June downtrend but cannot
legitimately assume the unseen route-7 magnitude; no claim of target
attainability follows.

## Candidate: sparse seasonal-interaction Ridge

`seasonal_interaction` uses a sparse route × weekday × hour intercept and
known-calendar event × hour features. Its only extrapolating feature is a
route-specific linear trend: the trend column is scaled by `0.02` to shrink it
relative to the seasonal cells, and the portion beyond each origin is damped by
`0.25`. Ridge `alpha=1.0`, the feature set, and damping are fixed before
evaluation; no inner or late-slice parameter selection is performed.

```bash
python3 -m accuracy --variant seasonal_interaction --output-dir artifacts/accuracy/iteration-8
```

## Rejected iteration 8: sparse seasonal-interaction Ridge

It scored `0.7988347795185595` on May--June and `0.7373910274434788` on
July--August, for `0.7692691068468773` combined. The candidate is rejected.
This specific sparse interaction and regularization choice did not transfer
over the two-month horizon. The current early best remains iteration 7
(`0.8484580413008345`); no late evaluation changes that result.

## Historical repo-only conclusion (superseded by raw activity extraction)

Before raw activity was extracted, no further candidate was justified by the
investigated repo-only evidence. The catalog had covered seasonal windows, decay, tree ensembles,
Poisson/Ridge additive models, pooled and per-route HGB, and one
interaction/trend extension. The dominant remaining error is a sustained
route-7 weekday regime change that was not represented by a strong pre-origin
trend or an eligible pre-origin service notice. Generic additional tuning has
no evidence of closing the remaining gap.

The concrete missing inputs are at least one prior summer for route-level
seasonality, or dated pre-origin operational data such as service calendars,
planned works, vehicle/output schedules, and route changes. Those inputs could
separate a recurring summer level from an abrupt service regime. These are
proposed next meaningful inputs. Raw activity now supplies one such historical
operational input; its eligible representations remain to be tested. Its
availability does not prove the target attainable, and `0.95` remains unproven.

## Candidate: origin-frozen raw activity HGB

Iteration 9 keeps the iteration-1 origin-aware profiles HGB unchanged and
adds only operational aggregates derived from `raw_activity.csv`. For every
historical training origin and final cutoff, the raw snapshot includes records
dated on or before that origin. Each forecast row receives the 28-day mean and
the 28-day-minus-all-history mean for `events`, `active_vehicles`,
`active_exits`, and `active_devices`, matched by route × weekday × hour.
Raw `boardings` reconciles the aggregate file to `history.csv` but is never a
model feature. This makes historic activity usable without observing activity
inside a forecast horizon.

The paired control is the saved iteration-1 profiles result
(`0.811016495639487` combined early WAPE-score); it is not rerun. Before the
single canonical evaluation, inspect the train-only distributions of these
four operational fields for meaningful variation. September--October remains
unopened.

```bash
python3 -m accuracy --variant raw_activity_hgb --data-dir data/processed --output-dir artifacts/accuracy/iteration-9
```

## Rejected iteration 9: origin-frozen raw activity HGB

It scored `0.7739282721688941` on May--June and `0.8369533543409158` on
July--August, for `0.8042548535815481` combined. This is below its unchanged
iteration-1 profiles control (`0.811016495639487` combined), so the appended
raw-history representation is rejected. The best early result remains the
fixed pooled/per-route blend (`0.8484580413008345`). This single failed use of
raw activity does not show that historical operational aggregates are
exhausted; it only rejects adding these frozen profiles as direct covariates.

## Train-only raw activity audit

`artifacts/accuracy/raw-activity-audit/audit_raw_activity.py` compares the
last 28 observed days with the preceding 28 days at each fixed cutoff. Both
windows contain four of each weekday and exclude dates after their cutoff.
The JSON records each route's hourly-field range, mean change, and the share
of eventful cells with a zero active-count proxy.

For route 7, activity rose into 30 April: events `+74.90` per hourly cell,
vehicles `+1.04`, exits `+0.55`, and devices `+0.17`. It therefore does not
foreshadow the May--June failure. Into 30 June it fell across all four fields:
events `-112.04` (`-10.7%`), vehicles `-0.47` (`-3.4%`), exits `-0.29`
(`-2.2%`), and devices `-2.23` (`-2.9%`). Route 7 had no eventful cell with a
zero active-vehicle, exit, or device count in either recent window. The June
decline is a real pre-origin operational signal, but it does not establish
that the July--August regime magnitude is predictable.

## Candidate: per-route device-density factorization

Iteration 10 changes the representation rather than appending raw features.
For each active route, the frozen HGB learns historical boardings per observed
active device from rows with a positive device count. Its absolute-error loss
uses the device count as `sample_weight`, so the density loss is equal to
boarding absolute error at observed exposure. The forecast multiplies the
nonnegative density by a device-count estimate frozen at the origin: the
28-day route × calendar-day-key × hour mean, then the exact all-history key
fallback, then zero. Calendar keys use the existing holiday, preholiday,
workday, and weekday distinctions; no realized horizon activity is used.

`active_devices` is fixed over vehicles because all positive-boardings rows
through both early cutoffs have a positive device count, whereas vehicle count
is occasionally absent with boardings. Rows with zero devices have zero
boardings and are excluded from the density fit; a zero forecast exposure
returns zero. Route 5 remains zero. This is an observed-device proxy rather
than a service schedule, so the candidate is one fixed test rather than a
claim of capacity truth.

```bash
python3 -m accuracy --variant per_route_device_density --data-dir data/processed --output-dir artifacts/accuracy/iteration-10
```

## Rejected iteration 10: per-route device-density factorization

It scored `0.8413697837929827` on May--June and `0.83140189923337` on
July--August, for `0.8365734098384997` combined. It is below the fixed
pooled/per-route blend (`0.8484580413008345`), so the device-density
representation is rejected. The reproducible denominator audit confirms that
device count was a well-formed exposure (no positive-boardings cell had zero
devices through either cutoff), while vehicle count was not (route 17 alone
had 37 such cells); this rejects the representation rather than a malformed
denominator.

## Saved-prediction diagnostic: iteration 10 versus iteration 7

`artifacts/accuracy/raw-activity-audit/compare_iteration10.py` reads only the
saved early prediction CSVs. The residual signs agree on `81.84%` of nonzero
pairs in May--June and `86.56%` in July--August. A predeclared diagnostic
50/50 average scores `0.8550995375602343` in May--June and
`0.8352121106147588` in July--August, for `0.8455300510706488` combined:
below iteration 7, so it is not a candidate weight.

The density error is concentrated in route 17 in May--June (`28.37%` of its
error; `+199,930` absolute error versus iteration 7) and route 7 in
July--August (`24.87%`; `+15,871`). The high sign agreement and failed fixed
average show no useful complementary capacity signal in these saved forecasts.
They do not exhaust raw history: the next underused direction is a separately
frozen historical ticket/passenger-composition aggregate, such as fare-type,
transaction-type, or unique-card mix, rather than another activity-count
transformation.

## Candidate: pooled fare components

Iteration 11 forecasts fare components from `raw_fares.csv`, never from a
future realized fare mix. At each cutoff it keeps the eight largest fare
categories by pre-cutoff boarding total (deterministic category-tuple
tiebreak) and maps every remaining category, including rare and missing fares,
to an internal OTHER group. It then zero-fills those nine cutoff-local groups
over the observed history grid, fits one pooled frozen HGB with the group at
categorical feature index 9, and sums nonnegative group predictions. This
preserves every pre-cutoff parent boarding total while bounding the June dense
matrix at 390,960 cells instead of 4,604,640. The grouping is recomputed from
training history for each origin; unseen future categories are never joined or
mapped.

```bash
python3 -m accuracy --variant pooled_fare_components --data-dir data/processed --output-dir artifacts/accuracy/iteration-11
```

## Rejected iteration 11: pooled fare components

It scored `0.8409473855500834` on May--June and `0.8097351673160399` on
July--August, for `0.8259286050150468` combined. Saved prediction CSVs were
independently rescored to the same values, so the measurement is valid and is
below the fixed pooled/per-route blend (`0.8484580413008345`).

The original `results.json` has a reporting-only defect: each kept fare's
boarding total was serialized as zero because the diagnostic looked up a
string rather than its `(good_type, missing_flag)` tuple. Component selection,
training targets, predictions, and WAPE are unaffected. The immutable
original is retained. After verifying its history and raw-fare hashes,
generate the corrected companion without refitting:

```bash
python3 artifacts/accuracy/iteration-11/repair_fare_report.py
```

The resulting `results-corrected.json` records the original report/file hashes,
raw-fare provenance, correction-script hash, and a recomputed canonical hash
for the corrected report.

The reporting-only repair completed without refitting. Its corrected canonical
report hash is `17c8ed51eaa29271e1f5b76c52dd021587367da5655dda63ae8d17bbaba66f82`;
the corrected kept-fare totals are `21,778,150` at April and `32,094,538` at
June. These fields do not affect the iteration-11 predictions or score.

## Candidate: per-route fare components

Iteration 12 keeps the same cutoff-local top-eight-plus-OTHER compression and
frozen HGB parameters as iteration 11, but fits one component model per active
route. This changes capacity allocation only: iteration 11 shared its 300-tree
budget across route and fare interactions, while the direct per-route HGB
previously improved over a single pooled model. Route 5 remains zero, and each
route's fare ranking and OTHER group use only its own pre-cutoff components.

```bash
python3 -m accuracy --variant per_route_fare_components --data-dir data/processed --output-dir artifacts/accuracy/iteration-12
```

## Rejected iteration 12: per-route fare components

It scored `0.8437722127181352` on May--June and `0.8249609331514642` on
July--August, for `0.8347205497675378` combined. Separate route capacity did
not improve the fixed pooled/per-route blend (`0.8484580413008345`).

`artifacts/accuracy/raw-activity-audit/compare_iteration12.py` compares only
saved early predictions to iteration 7. Residual signs agree on `91.05%` of
nonzero pairs in May--June and `90.38%` in July--August. A fixed diagnostic
50/50 average scores `0.8539957643279915` and `0.831294023846222`, or
`0.843072078753886` combined, so it is not a candidate blend. The tested
activity and fare representations are rejected; this does not exhaust the raw
history or establish that outside data is required.

## Train-only fare-mix drift audit

`artifacts/accuracy/raw-activity-audit/audit_fare_drift.py` uses each route's
cutoff-local top-eight-plus-OTHER share vector and compares the last 28 days
with the preceding 28 days. Route 7 has total-variation drift `0.0125560` at
April (rank 3; historic maximum `0.0250644`, with 1 of 2 earlier comparisons
at least as large) and `0.0198993` at June (rank 6; historic maximum
`0.0239742`, with 1 of 4 earlier comparisons at least as large). There is no
June-only route-7 outlier, so fare-mix drift does not justify another model.
