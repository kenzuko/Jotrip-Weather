import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from store import build_store


class StoreTests(unittest.TestCase):
    def test_dedup_and_conflict_detection(self):
        with tempfile.TemporaryDirectory() as td:
            a = Path(td) / "a.jsonl"
            b = Path(td) / "b.jsonl"
            base = {
                "observation_id":"id1",
                "observation_key":"logical1",
                "source_time":"2026-04-15T06:00:00Z",
                "stream":{"key":"WMO_INDEX:48917:E1"},
                "metric":"wind_speed",
                "value":5.0,
                "unit":"m/s",
            }
            a.write_text(json.dumps(base)+"\n",encoding="utf-8")
            null_version=dict(base,observation_id="id2",value=None)
            conflict=dict(base,observation_id="id3",value=6.0)
            b.write_text(json.dumps(base)+"\n"+json.dumps(null_version)+"\n"+json.dumps(conflict)+"\n",encoding="utf-8")
            rows, summary = build_store([a,b])
            self.assertEqual(len(rows),3)
            self.assertEqual(summary["duplicate_observation_ids"],1)
            self.assertEqual(summary["null_overwrites_suppressed"],1)
            self.assertEqual(summary["logical_conflicts"],1)
            self.assertFalse(summary["ready"])


if __name__ == "__main__":
    unittest.main()
