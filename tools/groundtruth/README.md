# JoTrip Weather Groundtruth P0

This directory is an isolated ingestion layer for measured observations. It does not feed production Weather yet.

Hard rules:

- preserve raw payloads before normalization;
- never use numeric `48917` alone as a station key;
- canonical stream key is `namespace + identifier + station_epoch` and observations also include `source_time`;
- keep `fetched_at` separate from observation/source time;
- never overwrite an immutable raw archive with different bytes;
- coded visual SYNOP wave height remains distinct from instrument `Hm0`;
- no forecast, interpolation or reanalysis is admitted here as ground truth.

## SYNOP 48917

Fetch a historical interval:

```bash
python tools/groundtruth/synop.py fetch \
  --begin 202604010000 --end 202604302359 \
  --archive-root out/raw
```

Normalize an already archived OGIMET CSV. The epoch is deliberately required:

```bash
python tools/groundtruth/synop.py normalize \
  --input raw.csv \
  --output out/synop.jsonl \
  --station-epoch CURRENT_VVPQ_METADATA
```

The decoder handles the handoff-proven core fields: wind, air temperature, dew point, station pressure, MSLP, Section 2 SST and coded wind-wave period/height. Unknown groups remain preserved in the raw report rather than guessed.

## KTTV 60018 XLSX

Fetch an export window:

```bash
python tools/groundtruth/kttv60018.py fetch \
  --from 28/09/2026 --to 30/09/2026 \
  --archive-root out/raw
```

Normalize a saved workbook:

```bash
python tools/groundtruth/kttv60018.py normalize \
  --input export.xlsx \
  --output out/kttv60018.jsonl
```

The parser discovers the header row and timestamp column, then maps only the confirmed handoff schema: `ff`, `dd`, `fxfx2m`, `dxdx2m`, `TGXH2m`, `fxfx2s`, `dxdx2s`, `TGXH2s`, `H`, `TM02`, `Hmax`, `HM0`.

## Tests

```bash
python -m pip install -r tools/groundtruth/requirements.txt
python -m unittest discover -s tools/groundtruth/tests -v
```


## Verified dry-run status - 2026-09-30

This branch is deliberately isolated from production. The latest real-data dry run passed unit tests, acquisition, normalization and artifact generation without writing to the Weather runtime.

SYNOP April 2026:

- 189 raw reports
- 38 NIL reports
- 151 observed reports
- 79 reports with Section 2
- 1,043 normalized observations
- 79 SST observations
- 58 coded visual wind-wave-height observations
- all 58 coded wave heights carry `CODED_VISUAL_HEIGHT_NOT_INSTRUMENT_HM0`

KTTV 60018, 28-30 September 2026:

- 432 timestamp rows, 144 per local date
- 0 rows with measurement values
- `data_status=SCHEMA_PRESENT_NO_VALUES`
- `quantitative_corpus_ready=false`

The earlier retention probe already sampled twelve dates from 15 January 2024 through 28 September 2026. Every workbook had the expected schema but zero measurement cells. Acquisition and schema are therefore confirmed, but a quantitative historical corpus has not been demonstrated. Do not include 60018 in backtesting until a workbook with actual values is observed.

## Normalized store

`store.py` builds an append-only deduplicated observation store. It:

- deduplicates exact `observation_id` records;
- never lets a null value overwrite a non-null logical observation;
- reports conflicting non-null values for the same `observation_key` instead of silently selecting one.

Example:

```bash
python tools/groundtruth/store.py \
  --input out/synop-2026-04.normalized.jsonl \
  --output out/store.jsonl \
  --summary out/store-summary.json \
  --fail-on-conflict
```

## P1 validation

`validate.py` compares canonical forecast JSONL against canonical point observations. Forecast rows must explicitly provide:

- `target_stream_key`
- `metric`
- `valid_time`
- `value`
- `unit`
- preferably `issued_at` and `model`

Matching is exact on stream and metric, then nearest in time within the configured tolerance. It reports bias, MAE, RMSE, sample count, missingness/match rate, time offset, station epochs and optional categorical hit/miss counts.

There is deliberately no wave aliasing. A forecast metric such as `significant_wave_height_hm0` will not match `wind_wave_height_visual_nominal`.

`rain_windows.py` admits official rainfall accumulations only when both start and end timestamps are explicit, the amount is numeric, the unit is mm and QC is VERIFIED. The resulting matching policy is `EXACT_ACCUMULATION_WINDOW_ONLY`. Incomplete published rain events remain evidence only.

## Not activated yet

- no production schedule;
- no production archive destination;
- no runtime Weather feed;
- no merge to main;
- no deploy;
- no P2 automatic learning or correction.

P2 remains blocked until there are enough matched forecast-observation pairs with stable provenance.
