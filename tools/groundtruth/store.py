from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    out = []
    p = Path(path)
    if not p.exists():
        return out
    with p.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not row.get("observation_id") or not row.get("observation_key"):
                raise ValueError(f"{p}:{lineno}: observation_id and observation_key are required")
            out.append(row)
    return out


def build_store(inputs: list[str | Path]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    logical: dict[str, dict[str, Any]] = {}
    duplicate_ids = 0
    null_suppressed = 0
    conflicts = []

    for path in inputs:
        for row in load_jsonl(path):
            oid = row["observation_id"]
            if oid in by_id:
                duplicate_ids += 1
                continue
            by_id[oid] = row

            key = row["observation_key"]
            current = logical.get(key)
            if current is None:
                logical[key] = row
                continue

            oldv = current.get("value")
            newv = row.get("value")
            if oldv is not None and newv is None:
                null_suppressed += 1
                continue
            if oldv is None and newv is not None:
                logical[key] = row
                continue
            if oldv == newv and current.get("unit") == row.get("unit"):
                # Keep first-seen canonical value but preserve both immutable rows in by_id.
                continue
            conflicts.append({
                "observation_key": key,
                "existing_observation_id": current["observation_id"],
                "incoming_observation_id": oid,
                "existing_value": oldv,
                "incoming_value": newv,
                "existing_unit": current.get("unit"),
                "incoming_unit": row.get("unit"),
            })

    rows = sorted(
        by_id.values(),
        key=lambda r: (
            r.get("source_time") or "",
            (r.get("stream") or {}).get("key") or "",
            r.get("metric") or "",
            r.get("observation_id") or "",
        ),
    )
    summary = {
        "schema_version": "jotrip-groundtruth-store-build-v1",
        "input_files": [str(x) for x in inputs],
        "immutable_observations": len(rows),
        "logical_keys": len(logical),
        "duplicate_observation_ids": duplicate_ids,
        "null_overwrites_suppressed": null_suppressed,
        "logical_conflicts": len(conflicts),
        "conflicts": conflicts,
        "ready": len(conflicts) == 0,
    }
    return rows, summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Build an append-only deduplicated groundtruth JSONL store")
    ap.add_argument("--input", action="append", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--fail-on-conflict", action="store_true")
    args = ap.parse_args()
    rows, summary = build_store(args.input)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
    Path(args.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.fail_on_conflict and summary["logical_conflicts"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
