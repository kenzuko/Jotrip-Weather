import csv
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from rain_windows import import_verified_windows


class RainWindowTests(unittest.TestCase):
    def test_only_explicit_verified_windows_pass(self):
        fields = [
            "source_class","source","station","period_start_local","period_end_local","metric",
            "value","unit","raw_report","qc_status","notes","source_url"
        ]
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "seed.csv"
            with p.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                w.writerow({
                    "source_class":"OFFICIAL_AGGREGATE_OBS","source":"Official","station":"Phu Quoc",
                    "period_start_local":"2026-09-21T19:00:00+07:00","period_end_local":"2026-09-22T19:00:00+07:00",
                    "metric":"precipitation_accumulation","value":"163","unit":"mm","qc_status":"VERIFIED"
                })
                w.writerow({
                    "source_class":"OFFICIAL_AGGREGATE_OBS","source":"Official","station":"Cua Can",
                    "period_start_local":"","period_end_local":"2026-09-22T19:00:00+07:00",
                    "metric":"precipitation_accumulation","value":"121","unit":"mm","qc_status":"VERIFIED"
                })
            rows, summary = import_verified_windows(p)
            self.assertEqual(summary["accepted"], 1)
            self.assertEqual(summary["rejected"], 1)
            self.assertEqual(rows[0]["window_seconds"], 86400.0)
            self.assertEqual(rows[0]["matching_policy"], "EXACT_ACCUMULATION_WINDOW_ONLY")


if __name__ == "__main__":
    unittest.main()
