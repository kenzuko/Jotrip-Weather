from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_time(value: str) -> datetime:
    s = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError("timezone required")
    return dt


def slug(value: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", value)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def import_verified_windows(src: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    accepted = []
    rejected: dict[str, int] = {}
    with open(src, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            reason = None
            if row.get("source_class") != "OFFICIAL_AGGREGATE_OBS":
                reason = "NOT_OFFICIAL_AGGREGATE_OBS"
            elif row.get("qc_status") != "VERIFIED":
                reason = "QC_NOT_VERIFIED"
            elif row.get("metric") != "precipitation_accumulation":
                reason = "NOT_PRECIPITATION_ACCUMULATION"
            elif row.get("unit") != "mm":
                reason = "UNIT_NOT_MM"
            elif not row.get("period_start_local") or not row.get("period_end_local"):
                reason = "WINDOW_MISSING"
            if reason:
                rejected[reason] = rejected.get(reason, 0) + 1
                continue
            try:
                start = parse_time(row["period_start_local"])
                end = parse_time(row["period_end_local"])
                value = float(row["value"])
            except Exception:
                rejected["PARSE_ERROR"] = rejected.get("PARSE_ERROR", 0) + 1
                continue
            if end <= start:
                rejected["INVALID_WINDOW_ORDER"] = rejected.get("INVALID_WINDOW_ORDER", 0) + 1
                continue
            station = row.get("station") or "UNKNOWN"
            accepted.append({
                "schema_version": "jotrip-groundtruth-window-v1",
                "record_type": "ACCUMULATION_WINDOW",
                "location_key": f"OFFICIAL_GAUGE_REPORT:{slug(station)}",
                "station_label": station,
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
                "window_seconds": (end - start).total_seconds(),
                "metric": "precipitation_accumulation",
                "value": value,
                "unit": "mm",
                "qc": {"status": "PASS", "flags": ["EXPLICIT_PUBLISHED_ACCUMULATION_WINDOW"]},
                "matching_policy": "EXACT_ACCUMULATION_WINDOW_ONLY",
                "provenance": {
                    "source": row.get("source"),
                    "source_url": row.get("source_url"),
                    "raw_report": row.get("raw_report"),
                    "notes": row.get("notes"),
                },
            })
    summary = {
        "accepted": len(accepted),
        "rejected": sum(rejected.values()),
        "rejected_reasons": dict(sorted(rejected.items())),
    }
    return accepted, summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Import explicit official rainfall accumulation windows")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--summary")
    args = ap.parse_args()
    rows, summary = import_verified_windows(args.input)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
    if args.summary:
        Path(args.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
