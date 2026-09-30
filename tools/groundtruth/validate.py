from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


WIND_UNITS = {"m/s", "km/h", "kt"}
TEMPERATURE_UNITS = {"C"}
PRESSURE_UNITS = {"hPa"}
LENGTH_UNITS = {"m"}


def parse_time(value: str) -> datetime:
    s = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError(f"Timestamp must be timezone-aware: {value}")
    return dt.astimezone(timezone.utc)


def canonical_value(metric: str, value: Any, unit: str | None) -> tuple[float, str]:
    x = float(value)
    if metric in {"wind_speed", "wind_gust_2m", "wind_gust_2s"}:
        if unit not in WIND_UNITS:
            raise ValueError(f"Unsupported wind unit {unit!r}")
        if unit == "km/h":
            x /= 3.6
        elif unit == "kt":
            x *= 0.514444
        return x, "m/s"
    if metric in {"air_temperature", "dew_point", "sea_surface_temperature"}:
        if unit not in TEMPERATURE_UNITS:
            raise ValueError(f"Unsupported temperature unit {unit!r}")
        return x, "C"
    if metric in {"station_pressure", "sea_level_pressure", "qnh"}:
        if unit not in PRESSURE_UNITS:
            raise ValueError(f"Unsupported pressure unit {unit!r}")
        return x, "hPa"
    if metric in {"significant_wave_height_hm0", "wave_height_h", "wave_height_max", "wind_wave_height_visual_nominal"}:
        if unit not in LENGTH_UNITS:
            raise ValueError(f"Unsupported wave unit {unit!r}")
        return x, "m"
    return x, unit or ""


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{lineno}: invalid JSON") from exc
    return rows


def _obs_index(rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    idx: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if (row.get("qc") or {}).get("status") != "PASS":
            continue
        stream = (row.get("stream") or {}).get("key")
        metric = row.get("metric")
        if not stream or not metric or row.get("value") is None:
            continue
        row = dict(row)
        row["_time"] = parse_time(row["source_time"])
        idx[(stream, metric)].append(row)
    for bucket in idx.values():
        bucket.sort(key=lambda r: r["_time"])
    return idx


def _nearest(rows: list[dict[str, Any]], target: datetime, tolerance_seconds: float) -> tuple[dict[str, Any] | None, float | None]:
    best = None
    best_abs = None
    best_signed = None
    for row in rows:
        signed = (row["_time"] - target).total_seconds()
        absolute = abs(signed)
        if best_abs is None or absolute < best_abs:
            best, best_abs, best_signed = row, absolute, signed
    if best is None or best_abs is None or best_abs > tolerance_seconds:
        return None, None
    return best, best_signed


def validate_points(
    forecast_rows: list[dict[str, Any]],
    observation_rows: list[dict[str, Any]],
    *,
    tolerance_minutes: float = 31.0,
    thresholds: dict[str, float] | None = None,
) -> dict[str, Any]:
    thresholds = thresholds or {}
    obs_idx = _obs_index(observation_rows)
    groups: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    for f in forecast_rows:
        stream = f.get("target_stream_key")
        metric = f.get("metric")
        model = f.get("model") or f.get("source") or "UNKNOWN"
        valid_time = f.get("valid_time")
        if not stream or not metric or not valid_time or f.get("value") is None:
            continue

        # Observation-type awareness is deliberate: a model Hm0 forecast cannot
        # silently match SYNOP coded visual wind-wave height because the metric
        # names are different. No aliasing is performed here.
        candidates = obs_idx.get((stream, metric), [])
        target = parse_time(valid_time)
        obs, offset_s = _nearest(candidates, target, tolerance_minutes * 60.0)
        obs_type = obs.get("observation_type", "UNKNOWN") if obs else "UNMATCHED"
        key = (str(model), str(stream), str(metric), str(obs_type))
        g = groups.setdefault(key, {
            "model": model,
            "target_stream_key": stream,
            "metric": metric,
            "observation_type": obs_type,
            "forecast_count": 0,
            "matches": [],
            "threshold": thresholds.get(metric),
        })
        g["forecast_count"] += 1
        if obs is None:
            continue

        fv, canonical_unit = canonical_value(metric, f["value"], f.get("unit"))
        ov, obs_unit = canonical_value(metric, obs["value"], obs.get("unit"))
        if canonical_unit != obs_unit:
            raise ValueError(f"Canonical unit mismatch for {metric}: {canonical_unit} vs {obs_unit}")
        err = fv - ov
        lead_hours = None
        if f.get("issued_at"):
            lead_hours = (target - parse_time(f["issued_at"])).total_seconds() / 3600.0
        g["matches"].append({
            "forecast_value": fv,
            "observed_value": ov,
            "unit": canonical_unit,
            "error": err,
            "abs_error": abs(err),
            "squared_error": err * err,
            "time_offset_minutes": offset_s / 60.0 if offset_s is not None else None,
            "lead_hours": lead_hours,
            "valid_time": target.isoformat().replace("+00:00", "Z"),
            "source_time": obs["_time"].isoformat().replace("+00:00", "Z"),
            "observation_id": obs.get("observation_id"),
            "station_epoch": (obs.get("stream") or {}).get("station_epoch"),
        })

    output_groups = []
    total_forecasts = 0
    total_matches = 0
    for g in groups.values():
        matches = g.pop("matches")
        n = len(matches)
        total_forecasts += g["forecast_count"]
        total_matches += n
        result = dict(g)
        result["matched_count"] = n
        result["unmatched_count"] = g["forecast_count"] - n
        result["match_rate"] = n / g["forecast_count"] if g["forecast_count"] else 0.0
        if n:
            result["unit"] = matches[0]["unit"]
            result["bias"] = mean(m["error"] for m in matches)
            result["mae"] = mean(m["abs_error"] for m in matches)
            result["rmse"] = math.sqrt(mean(m["squared_error"] for m in matches))
            result["mean_abs_time_offset_minutes"] = mean(abs(m["time_offset_minutes"]) for m in matches)
            leads = [m["lead_hours"] for m in matches if m["lead_hours"] is not None]
            result["lead_hours"] = {
                "min": min(leads) if leads else None,
                "max": max(leads) if leads else None,
                "mean": mean(leads) if leads else None,
            }
            epochs = sorted({m["station_epoch"] for m in matches if m["station_epoch"]})
            result["station_epochs"] = epochs
            threshold = result.get("threshold")
            if threshold is not None:
                tp = fp = tn = fn = 0
                for m in matches:
                    fpred = m["forecast_value"] >= threshold
                    opred = m["observed_value"] >= threshold
                    if fpred and opred:
                        tp += 1
                    elif fpred and not opred:
                        fp += 1
                    elif not fpred and opred:
                        fn += 1
                    else:
                        tn += 1
                result["categorical"] = {"tp": tp, "fp": fp, "tn": tn, "fn": fn}
        output_groups.append(result)

    output_groups.sort(key=lambda r: (str(r["model"]), r["target_stream_key"], r["metric"], r["observation_type"]))
    return {
        "schema_version": "jotrip-groundtruth-validation-v1",
        "matching_policy": {
            "stream": "EXACT_TARGET_STREAM_KEY",
            "metric": "EXACT_METRIC_NO_WAVE_ALIAS",
            "time": "NEAREST_WITHIN_TOLERANCE",
            "tolerance_minutes": tolerance_minutes,
        },
        "forecast_rows_considered": total_forecasts,
        "matched_rows": total_matches,
        "overall_match_rate": total_matches / total_forecasts if total_forecasts else 0.0,
        "groups": output_groups,
    }


def parse_thresholds(values: list[str]) -> dict[str, float]:
    out = {}
    for item in values:
        if "=" not in item:
            raise ValueError(f"Threshold must be metric=value: {item}")
        metric, value = item.split("=", 1)
        out[metric.strip()] = float(value)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Compare canonical forecasts with JoTrip groundtruth observations")
    ap.add_argument("--forecast", required=True, help="JSONL rows with target_stream_key, metric, valid_time, value, unit")
    ap.add_argument("--observations", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--tolerance-minutes", type=float, default=31.0)
    ap.add_argument("--threshold", action="append", default=[], help="metric=value in canonical units")
    args = ap.parse_args()
    report = validate_points(
        load_jsonl(args.forecast),
        load_jsonl(args.observations),
        tolerance_minutes=args.tolerance_minutes,
        thresholds=parse_thresholds(args.threshold),
    )
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
