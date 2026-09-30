import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from openpyxl import Workbook
from kttv60018 import parse_workbook


class KTTV60018Tests(unittest.TestCase):
    def test_layout_and_normalize(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "sample.xlsx"
            dst = Path(td) / "out.jsonl"
            wb = Workbook()
            ws = wb.active
            ws.title = "60018"
            ws.append(["KT HAI VAN PHU QUOC"])
            ws.append(["Thời gian", "ff", "dd", "fxfx2m", "dxdx2m", "TGXH2m", "fxfx2s", "dxdx2s", "TGXH2s", "H", "TM02", "Hmax", "HM0"])
            ws.append([datetime(2026,9,30,8,10), 4.2, 230, 7.1, 240, "08:09", 8.0, 250, "08:09:40", 0.6, 4.1, 0.9, 0.7])
            wb.save(src)
            summary = parse_workbook(src, dst)
            self.assertEqual(summary["observations"], 12)
            self.assertEqual(summary["timestamp_rows"], 1)
            self.assertEqual(summary["value_rows"], 1)
            self.assertEqual(summary["data_status"], "VALUES_PRESENT")
            self.assertTrue(summary["quantitative_corpus_ready"])
            rows = [json.loads(x) for x in dst.read_text(encoding="utf-8").splitlines()]
            metrics = {r["metric"] for r in rows}
            self.assertIn("significant_wave_height_hm0", metrics)
            self.assertIn("wind_speed", metrics)
            self.assertTrue(all(r["stream"]["key"] == "KTTV_AUTO:60018:SID33_PUBLIC_AUTOMATED_STATION" for r in rows))
            self.assertTrue(all(r["source_time"].endswith("+07:00") for r in rows))


    def test_schema_present_but_measurements_empty(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "empty.xlsx"
            dst = Path(td) / "out.jsonl"
            wb = Workbook()
            ws = wb.active
            ws.append(["Thời gian", "thiết bị đo gió", None, None, None, None, None, None, None, None, "thiết bị đo sóng"])
            ws.append([None, "ff", "dd", "fxfx2m", "dxdx2m", "TGXH2m", "fxfx2s", "dxdx2s", "TGXH2s", "Ac:", "H", "TM02", "Hmax", "HM0", "Ac"])
            ws.append([datetime(2026,9,28,0,0)] + [None] * 14)
            ws.append([datetime(2026,9,28,0,10)] + [None] * 14)
            wb.save(src)
            summary = parse_workbook(src, dst)
            self.assertEqual(summary["timestamp_rows"], 2)
            self.assertEqual(summary["value_rows"], 0)
            self.assertEqual(summary["data_status"], "SCHEMA_PRESENT_NO_VALUES")
            self.assertFalse(summary["quantitative_corpus_ready"])
            self.assertEqual(summary["timestamp_rows_by_local_date"], {"2026-09-28": 2})
            self.assertEqual(summary["value_rows_by_local_date"], {})

if __name__ == "__main__":
    unittest.main()
