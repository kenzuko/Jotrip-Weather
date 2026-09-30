import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from validate import validate_points


def obs(t, metric, value, unit, obs_type="MEASURED_CODED"):
    return {
        "source_time": t,
        "metric": metric,
        "value": value,
        "unit": unit,
        "observation_type": obs_type,
        "stream": {
            "key": "WMO_INDEX:48917:CURRENT_VVPQ_METADATA",
            "station_epoch": "CURRENT_VVPQ_METADATA",
        },
        "qc": {"status": "PASS", "flags": []},
        "observation_id": t + metric,
    }


class ValidationTests(unittest.TestCase):
    def test_metrics_and_units(self):
        observations = [
            obs("2026-04-15T06:00:00Z", "wind_speed", 5.0, "m/s"),
            obs("2026-04-15T12:00:00Z", "wind_speed", 10.0, "m/s"),
        ]
        forecasts = [
            {
                "model": "TEST",
                "target_stream_key": "WMO_INDEX:48917:CURRENT_VVPQ_METADATA",
                "metric": "wind_speed",
                "valid_time": "2026-04-15T06:00:00Z",
                "issued_at": "2026-04-15T00:00:00Z",
                "value": 18.0,
                "unit": "km/h",
            },
            {
                "model": "TEST",
                "target_stream_key": "WMO_INDEX:48917:CURRENT_VVPQ_METADATA",
                "metric": "wind_speed",
                "valid_time": "2026-04-15T12:00:00Z",
                "issued_at": "2026-04-15T00:00:00Z",
                "value": 36.0,
                "unit": "km/h",
            },
        ]
        report = validate_points(forecasts, observations, thresholds={"wind_speed": 7.0})
        g = report["groups"][0]
        self.assertEqual(g["matched_count"], 2)
        self.assertAlmostEqual(g["bias"], 0.0)
        self.assertAlmostEqual(g["mae"], 0.0)
        self.assertEqual(g["categorical"], {"tp": 1, "fp": 0, "tn": 1, "fn": 0})

    def test_wave_types_do_not_alias(self):
        observations = [
            obs("2026-04-15T06:00:00Z", "wind_wave_height_visual_nominal", 0.5, "m", "VISUAL_CODED_WIND_WAVE_HEIGHT")
        ]
        forecasts = [{
            "model": "TEST",
            "target_stream_key": "WMO_INDEX:48917:CURRENT_VVPQ_METADATA",
            "metric": "significant_wave_height_hm0",
            "valid_time": "2026-04-15T06:00:00Z",
            "value": 0.5,
            "unit": "m",
        }]
        report = validate_points(forecasts, observations)
        self.assertEqual(report["matched_rows"], 0)


if __name__ == "__main__":
    unittest.main()
