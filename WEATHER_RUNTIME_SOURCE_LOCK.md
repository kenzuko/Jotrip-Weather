# JOTRIP WEATHER RUNTIME SOURCE LOCK

Status: ACTIVE
Date: 2026-09-21

## Canonical production rule

Browser-facing Weather consumers must read only the normalized same-origin runtime:

- /data/weather-runtime/manifest.json
- /data/weather-runtime/cloud.json
- /data/weather-runtime/compact.json
- /data/weather-runtime/current.json
- /data/weather-runtime/forecast.json
- /data/weather-runtime/marine.json
- /data/weather-runtime/meta.json

The registry is weather-runtime-config.js.

## Forbidden in production consumers

Do not point browser code directly to:

- raw.githubusercontent.com
- GitHub Pages data from Jotrip-Lab
- feature branches such as feat/weather-lab-data-engine-v1
- data-weather branch paths
- legacy /data/weather-scene fallback
- legacy data/nowcast.json or data/dashboard-data.json

Upstream URLs may exist only inside backend/sync workflows that build the canonical runtime.

## Failure behavior

If canonical runtime is unavailable or stale beyond policy, the UI must surface UNAVAILABLE/STALE.
It must not silently fall back to an older branch/file/source.

## Migration rule

Existing stable Weather V2 / spatial-lab code is frozen until migrated separately and verified by smoke tests.
Do not delete a legacy source until all consumers have moved to canonical runtime and passed QA.

## Source semantics

Keep these timestamps separate:

- source_time / sampled_time: observation time
- model_run: forecast model cycle
- valid_time: forecast frame time
- generated_at: runtime/build time

Never use generated_at as a substitute for observation freshness or model age.
