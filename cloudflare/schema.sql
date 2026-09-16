CREATE TABLE IF NOT EXISTS weather_feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  point_id TEXT NOT NULL,
  point_name TEXT,
  verdict TEXT NOT NULL,
  wind_relation TEXT NOT NULL DEFAULT 'unknown',
  wave_relation TEXT NOT NULL DEFAULT 'unknown',
  rain_relation TEXT NOT NULL DEFAULT 'unknown',
  evidence_type TEXT NOT NULL DEFAULT 'field_observation',
  note TEXT,
  snapshot_id TEXT,
  forecast_generated_at TEXT,
  source_cycles_json TEXT NOT NULL DEFAULT '{}',
  forecast_json TEXT NOT NULL DEFAULT '{}',
  ui_version TEXT,
  calibration_eligible INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_weather_feedback_observed_at ON weather_feedback(observed_at);
CREATE INDEX IF NOT EXISTS idx_weather_feedback_point ON weather_feedback(point_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_weather_feedback_snapshot ON weather_feedback(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_weather_feedback_verdict ON weather_feedback(verdict, observed_at);
