from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import (
    atomic_write,
    build_observation,
    sha256_bytes,
    sha256_file,
    utc_now_iso,
    write_json,
    write_jsonl,
)

OGIMET_URL = "https://www.ogimet.com/cgi-bin/getsynop"
SOURCE_NAME = "OGIMET_RAW_SYNOP"
NAMESPACE = "WMO_INDEX"
EXPECTED_STATION = "48917"
SECTION_MARKERS = ("222", "333", "444", "555")
SECTION_END_PREFIXES = ("333", "444", "555")


def _pressure_hpa(code4: str) -> float | None:
    if len(code4) != 4 or not code4.isdigit():
        return None
    n = int(code4)
    return (1000.0 if n < 5000 else 900.0) + n / 10.0


def _signed_tenths(sign_code: str, digits3: str) -> float | None:
    if sign_code not in {"0", "1"} or not digits3.isdigit():
        return None
    value = int(digits3) / 10.0
    return -value if sign_code == "1" else value


def _split_synop(report: str) -> dict[str, Any]:
    clean = report.strip()
    if clean.endswith("="):
        clean = clean[:-1].rstrip()
    tokens = clean.split()
    if tokens and re.fullmatch(r"\d{12}", tokens[0]) and len(tokens) > 1 and tokens[1] == "AAXX":
        tokens = tokens[1:]
    if not tokens or tokens[0] != "AAXX":
        raise ValueError(f"Not an AAXX report: {report[:80]!r}")
    if len(tokens) < 3:
        raise ValueError("Truncated AAXX report")
    return {"tokens": tokens, "yyggiw": tokens[1], "station": tokens[2]}


def section2_tokens(report: str) -> tuple[str | None, list[str]]:
    parts = _split_synop(report)["tokens"]
    start = None
    for i, token in enumerate(parts):
        if token.startswith("222"):
            start = i
            break
    if start is None:
        return None, []
    end = len(parts)
    for i in range(start + 1, len(parts)):
        if parts[i].startswith(SECTION_END_PREFIXES):
            end = i
            break
    return parts[start], parts[start + 1:end]


def _wind_from_group(yyggiw: str, nddff: str, extension: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if len(yyggiw) != 5 or not yyggiw[-1].isdigit() or len(nddff) != 5 or not nddff.isdigit():
        return out
    iw = int(yyggiw[-1])
    dd = int(nddff[1:3])
    ff = int(nddff[3:5])
    raw_ff = ff
    raw_speed_group = nddff
    if ff == 99 and extension and re.fullmatch(r"00\d{3}", extension):
        raw_ff = int(extension[2:])
        raw_speed_group = f"{nddff} {extension}"

    if dd == 0 and raw_ff == 0:
        direction = 0.0
        dir_flags = ["CALM"]
    elif dd == 99:
        direction = None
        dir_flags = ["VARIABLE_DIRECTION_CODE_99"]
    elif 1 <= dd <= 36:
        direction = float(dd * 10)
        dir_flags = []
    else:
        direction = None
        dir_flags = ["WIND_DIRECTION_CODE_UNRESOLVED"]
    out.append({"metric": "wind_direction", "value": direction, "unit": "deg", "raw_group": nddff, "flags": dir_flags})

    if iw in (0, 1):
        speed = float(raw_ff)
        unit = "m/s"
        method = "ESTIMATED" if iw == 0 else "ANEMOMETER"
    elif iw in (3, 4):
        speed = round(raw_ff * 0.514444, 6)
        unit = "m/s"
        method = "ESTIMATED_KNOT_CODE" if iw == 3 else "ANEMOMETER_KNOT_CODE"
    else:
        speed = None
        unit = None
        method = "IW_UNRESOLVED"
    out.append({
        "metric": "wind_speed",
        "value": speed,
        "unit": unit,
        "raw_group": raw_speed_group,
        "flags": [] if speed is not None else ["WIND_UNIT_UNRESOLVED"],
        "extra": {"synop_iw": iw, "measurement_method": method, "coded_speed": raw_ff},
    })
    return out


def decode_report(report: str) -> dict[str, Any]:
    parsed = _split_synop(report)
    tokens: list[str] = parsed["tokens"]
    yyggiw = parsed["yyggiw"]
    station = parsed["station"]
    if station != EXPECTED_STATION:
        raise ValueError(f"Unexpected station {station}, expected {EXPECTED_STATION}")
    if len(tokens) >= 4 and tokens[3].startswith("NIL"):
        return {"station": station, "yyggiw": yyggiw, "nil": True, "measurements": [], "section2": []}

    body = tokens[3:]
    section1: list[str] = []
    for tok in body:
        if tok.startswith(SECTION_MARKERS):
            break
        section1.append(tok)

    measurements: list[dict[str, Any]] = []
    if len(section1) >= 2:
        nddff = section1[1]
        extension = section1[2] if len(section1) >= 3 and nddff.endswith("99") else None
        measurements.extend(_wind_from_group(yyggiw, nddff, extension))

    for tok in section1[2:]:
        if len(tok) != 5:
            continue
        if tok.startswith("1"):
            value = _signed_tenths(tok[1], tok[2:])
            if value is not None:
                measurements.append({"metric": "air_temperature", "value": value, "unit": "C", "raw_group": tok, "flags": []})
        elif tok.startswith("2"):
            if tok[1] in {"0", "1"}:
                value = _signed_tenths(tok[1], tok[2:])
                if value is not None:
                    measurements.append({"metric": "dew_point", "value": value, "unit": "C", "raw_group": tok, "flags": []})
            elif tok.startswith("29") and tok[2:].isdigit():
                measurements.append({"metric": "relative_humidity", "value": float(int(tok[2:])), "unit": "%", "raw_group": tok, "flags": ["SYNOP_29UUU"]})
        elif tok.startswith("3"):
            value = _pressure_hpa(tok[1:])
            if value is not None:
                measurements.append({"metric": "station_pressure", "value": value, "unit": "hPa", "raw_group": tok, "flags": []})
        elif tok.startswith("4"):
            value = _pressure_hpa(tok[1:])
            if value is not None:
                measurements.append({"metric": "sea_level_pressure", "value": value, "unit": "hPa", "raw_group": tok, "flags": []})

    marker, s2 = section2_tokens(report)
    for tok in s2:
        if len(tok) != 5:
            continue
        if tok.startswith("0") and tok[1].isdigit() and tok[2:].isdigit():
            ss = int(tok[1])
            if 0 <= ss <= 7:
                sst = int(tok[2:]) / 10.0
                if ss % 2 == 1:
                    sst = -sst
                measurements.append({
                    "metric": "sea_surface_temperature",
                    "value": sst,
                    "unit": "C",
                    "raw_group": tok,
                    "flags": [],
                    "extra": {"sst_sign_method_code": ss},
                })
        elif tok.startswith("2"):
            period_code = tok[1:3]
            height_code = tok[3:5]
            if period_code.isdigit():
                measurements.append({
                    "metric": "wind_wave_period",
                    "value": float(int(period_code)),
                    "unit": "s",
                    "raw_group": tok,
                    "flags": [],
                    "extra": {"wave_observation_type": "SYNOP_SECTION2_WIND_WAVE"},
                })
            if height_code.isdigit():
                hc = int(height_code)
                nominal = hc * 0.5
                measurements.append({
                    "metric": "wind_wave_height_visual_nominal",
                    "value": nominal,
                    "unit": "m",
                    "raw_group": tok,
                    "flags": ["CODED_VISUAL_HEIGHT_NOT_INSTRUMENT_HM0"],
                    "uncertainty": {
                        "kind": "coded_bin",
                        "lower_m": max(0.0, nominal - 0.25),
                        "upper_m": nominal + 0.25,
                        "code": height_code,
                    },
                    "extra": {"wave_observation_type": "VISUAL_CODED_WIND_WAVE_HEIGHT"},
                })

    return {
        "station": station,
        "yyggiw": yyggiw,
        "nil": False,
        "measurements": measurements,
        "section2_marker": marker,
        "section2": s2,
        "section1_raw": section1,
    }


def _row_time_iso(row: dict[str, str]) -> str:
    def pick(*keys: str) -> str:
        for key in keys:
            value = row.get(key)
            if value is not None and str(value).strip() != "":
                return str(value).strip()
        return ""

    parts = (
        pick("YEAR", "ANO", "year"),
        pick("MONTH", "MES", "month"),
        pick("DAY", "DIA", "day"),
        pick("HOUR", "HORA", "hour"),
        pick("MIN", "MINUTO", "minute"),
    )
    if all(parts):
        dt = datetime(*(int(x) for x in parts), tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    for key in ("observation_time_utc", "obs_time_utc"):
        if row.get(key):
            return row[key].strip()
    raise ValueError("Cannot resolve source time")


def _normalize_input_row(row: dict[str, str]) -> tuple[str, str]:
    station = (row.get("WMO_ID") or row.get("WMOIND") or row.get("wmo_index") or "").strip()
    report = (row.get("PARTE") or row.get("REPORT") or row.get("raw_report") or "").strip()
    return station, report


def normalize_csv(
    src: str | Path,
    dst: str | Path,
    *,
    station_epoch: str,
    source_url: str | None = None,
    fetched_at: str | None = None,
    raw_path: str | None = None,
    raw_sha256: str | None = None,
) -> dict[str, Any]:
    src = Path(src)
    manifest_path = Path(str(src) + ".manifest.json")
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        source_url = source_url or manifest.get("source_url")
        fetched_at = fetched_at or manifest.get("fetched_at")
        raw_sha256 = raw_sha256 or manifest.get("sha256")
        raw_path = raw_path or manifest.get("raw_path")
    if raw_sha256 is None:
        raw_sha256 = sha256_file(src)
    if raw_path is None:
        raw_path = str(src)
    observations: list[dict[str, Any]] = []
    report_count = 0
    nil_count = 0
    section2_reports = 0
    with open(src, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV has no header")
        for row in reader:
            station, report = _normalize_input_row(row)
            if station != EXPECTED_STATION:
                continue
            if not report:
                continue
            report_count += 1
            source_time = _row_time_iso(row)
            decoded = decode_report(report)
            if decoded["nil"]:
                nil_count += 1
                continue
            if decoded.get("section2_marker"):
                section2_reports += 1
            for m in decoded["measurements"]:
                extra = {
                    "synop": {
                        "yyggiw": decoded["yyggiw"],
                        "section2_marker": decoded.get("section2_marker"),
                        "section2_tokens": decoded.get("section2", []),
                    }
                }
                extra.update(m.get("extra") or {})
                observations.append(build_observation(
                    namespace=NAMESPACE,
                    identifier=EXPECTED_STATION,
                    station_epoch=station_epoch,
                    source_time=source_time,
                    metric=m["metric"],
                    value=m.get("value"),
                    unit=m.get("unit"),
                    source=SOURCE_NAME,
                    source_url=source_url,
                    fetched_at=fetched_at,
                    raw_sha256=raw_sha256,
                    raw_path=raw_path,
                    raw_report=report,
                    raw_group=m.get("raw_group"),
                    observation_type=(m.get("extra") or {}).get("wave_observation_type", "MEASURED_CODED"),
                    qc_status="PASS" if m.get("value") is not None else "REVIEW",
                    qc_flags=m.get("flags") or [],
                    uncertainty=m.get("uncertainty"),
                    extra=extra,
                ))
    count = write_jsonl(dst, observations)
    return {
        "reports": report_count,
        "nil_reports": nil_count,
        "section2_reports": section2_reports,
        "observations": count,
        "metrics": dict(sorted(__import__("collections").Counter(o["metric"] for o in observations).items())),
        "raw_sha256": raw_sha256,
    }


def fetch_raw(begin: str, end: str, archive_root: str | Path) -> dict[str, Any]:
    if not re.fullmatch(r"\d{12}", begin) or not re.fullmatch(r"\d{12}", end):
        raise ValueError("begin/end must be YYYYMMDDHHmm")
    qs = urllib.parse.urlencode({
        "block": EXPECTED_STATION,
        "begin": begin,
        "end": end,
        "header": "yes",
        "lang": "eng",
    })
    url = f"{OGIMET_URL}?{qs}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; JoTrip-groundtruth-ingest/1.0)",
        "Accept": "text/plain,text/csv,*/*",
        "Referer": "https://www.ogimet.com/",
    })
    fetched_at = utc_now_iso()
    with urllib.request.urlopen(req, timeout=45) as resp:
        blob = resp.read()
        status = resp.status
        ctype = resp.headers.get("Content-Type")
    if status != 200:
        raise RuntimeError(f"OGIMET returned HTTP {status}")
    digest = sha256_bytes(blob)
    year = begin[:4]
    month = begin[4:6]
    root = Path(archive_root) / "ogimet" / f"wmo_{EXPECTED_STATION}" / year / month
    name = f"ogimet_{EXPECTED_STATION}_{begin}Z_{end}Z_{digest[:12]}.csv"
    path = root / name
    if path.exists():
        existing = sha256_file(path)
        if existing != digest:
            raise RuntimeError(f"Immutable archive collision at {path}")
    else:
        atomic_write(path, blob)
    manifest = {
        "schema_version": "jotrip-groundtruth-raw-manifest-v1",
        "source": SOURCE_NAME,
        "source_url": url,
        "namespace": NAMESPACE,
        "identifier": EXPECTED_STATION,
        "begin": begin,
        "end": end,
        "fetched_at": fetched_at,
        "http_status": status,
        "content_type": ctype,
        "bytes": len(blob),
        "sha256": digest,
        "raw_path": str(path),
    }
    write_json(str(path) + ".manifest.json", manifest)
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description="JoTrip raw SYNOP groundtruth ingestion")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("normalize")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--station-epoch", required=True, help="Explicit epoch label; never infer from numeric 48917 alone")
    p.add_argument("--source-url")
    p.add_argument("--fetched-at")
    p.add_argument("--raw-path")
    p.add_argument("--raw-sha256")

    f = sub.add_parser("fetch")
    f.add_argument("--begin", required=True)
    f.add_argument("--end", required=True)
    f.add_argument("--archive-root", default="data/groundtruth/raw")

    args = ap.parse_args()
    if args.cmd == "fetch":
        print(json.dumps(fetch_raw(args.begin, args.end, args.archive_root), ensure_ascii=False, indent=2))
    else:
        summary = normalize_csv(
            args.input,
            args.output,
            station_epoch=args.station_epoch,
            source_url=args.source_url,
            fetched_at=args.fetched_at,
            raw_path=args.raw_path,
            raw_sha256=args.raw_sha256,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
