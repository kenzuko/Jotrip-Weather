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
