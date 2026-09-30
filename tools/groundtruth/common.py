from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "jotrip-groundtruth-observation-v1"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_write(path: str | Path, data: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_json(path: str | Path, obj: Any) -> None:
    atomic_write(path, (json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"))


def write_jsonl(path: str | Path, rows: Iterable[dict[str, Any]]) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            count += 1
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return count


def canonical_stream_key(namespace: str, identifier: str, station_epoch: str) -> str:
    if not namespace or not identifier or not station_epoch:
        raise ValueError("namespace, identifier and station_epoch are mandatory")
    return f"{namespace}:{identifier}:{station_epoch}"


def observation_id(stream_key: str, source_time: str, metric: str, raw_group: str | None, value: Any) -> str:
    material = "|".join([
        stream_key,
        source_time,
        metric,
        raw_group or "",
        "" if value is None else str(value),
    ])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def build_observation(
    *,
    namespace: str,
    identifier: str,
    station_epoch: str,
    source_time: str,
    metric: str,
    value: Any,
    unit: str | None,
    source: str,
    source_url: str | None,
    fetched_at: str | None,
    raw_sha256: str | None,
    raw_path: str | None,
    raw_report: str | None = None,
    raw_group: str | None = None,
    observation_type: str = "MEASURED",
    qc_status: str = "PASS",
    qc_flags: list[str] | None = None,
    uncertainty: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stream_key = canonical_stream_key(namespace, identifier, station_epoch)
    row: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "observation_id": observation_id(stream_key, source_time, metric, raw_group, value),
        "stream": {
            "namespace": namespace,
            "identifier": identifier,
            "station_epoch": station_epoch,
            "key": stream_key,
        },
        "source_time": source_time,
        "metric": metric,
        "value": value,
        "unit": unit,
        "observation_type": observation_type,
        "qc": {
            "status": qc_status,
            "flags": qc_flags or [],
        },
        "uncertainty": uncertainty,
        "provenance": {
            "source": source,
            "source_url": source_url,
            "fetched_at": fetched_at,
            "raw_sha256": raw_sha256,
            "raw_path": raw_path,
        },
        "raw": {
            "report": raw_report,
            "group": raw_group,
        },
    }
    if extra:
        row.update(extra)
    return row
