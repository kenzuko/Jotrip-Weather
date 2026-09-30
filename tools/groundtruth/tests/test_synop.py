import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from synop import decode_report, normalize_csv

REPORT = "202604150600 AAXX 15061 48917 32598 62305 10318 20256 30094 40100 58008 83208 222// 00328 2//01 333 59010 83895 86299="


class SynopDecodeTests(unittest.TestCase):
    def test_known_handoff_report(self):
        d = decode_report(REPORT)
        got = {m["metric"]: m for m in d["measurements"]}
        self.assertEqual(got["wind_direction"]["value"], 230.0)
        self.assertEqual(got["wind_speed"]["value"], 5.0)
        self.assertEqual(got["air_temperature"]["value"], 31.8)
        self.assertEqual(got["dew_point"]["value"], 25.6)
        self.assertEqual(got["station_pressure"]["value"], 1009.4)
        self.assertEqual(got["sea_level_pressure"]["value"], 1010.0)
        self.assertEqual(got["sea_surface_temperature"]["value"], 32.8)
        self.assertEqual(got["wind_wave_height_visual_nominal"]["value"], 0.5)
        self.assertEqual(got["wind_wave_height_visual_nominal"]["uncertainty"]["lower_m"], 0.25)
        self.assertEqual(got["wind_wave_height_visual_nominal"]["uncertainty"]["upper_m"], 0.75)
        self.assertEqual(d["section2_marker"], "222//")

    def test_nil(self):
        d = decode_report("AAXX 01031 48917 NIL=")
        self.assertTrue(d["nil"])
        self.assertEqual(d["measurements"], [])

    def test_actual_ogimet_header_names(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "ogimet.csv"
            dst = Path(td) / "out.jsonl"
            src.write_text(
                "WMO_ID,ANO,MES,DIA,HORA,MINUTO,PARTE\n"
                "48917,2026,04,15,06,00,AAXX 15061 48917 32598 62305 10318 20256 30094 40100 58008 83208 222// 00328 2//01 333 59010 83895 86299=\n",
                encoding="utf-8",
            )
            summary = normalize_csv(src, dst, station_epoch="CURRENT_VVPQ_METADATA")
            self.assertEqual(summary["reports"], 1)
            self.assertGreater(summary["observations"], 0)
            rows = [json.loads(x) for x in dst.read_text(encoding="utf-8").splitlines()]
            self.assertTrue(all(r["source_time"] == "2026-04-15T06:00:00Z" for r in rows))

    def test_normalized_key_has_epoch(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "s.csv"
            dst = Path(td) / "out.jsonl"
            with src.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["WMOIND","YEAR","MONTH","DAY","HOUR","MIN","REPORT"])
                w.writeheader()
                w.writerow({"WMOIND":"48917","YEAR":"2026","MONTH":"04","DAY":"15","HOUR":"06","MIN":"00","REPORT":REPORT.split(" ",1)[1]})
            summary = normalize_csv(src, dst, station_epoch="CURRENT_VVPQ_METADATA")
            self.assertEqual(summary["reports"], 1)
            rows = [json.loads(x) for x in dst.read_text(encoding="utf-8").splitlines()]
            self.assertTrue(rows)
            self.assertTrue(all(r["stream"]["key"] == "WMO_INDEX:48917:CURRENT_VVPQ_METADATA" for r in rows))
            self.assertTrue(all(r["station_time_key"] == "WMO_INDEX:48917:CURRENT_VVPQ_METADATA:2026-04-15T06:00:00Z" for r in rows))


if __name__ == "__main__":
    unittest.main()
