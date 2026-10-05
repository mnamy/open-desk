ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS step_index INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS search_run_jobs (
  run_id TEXT NOT NULL REFERENCES search_runs (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  feed_bucket TEXT NOT NULL,
  exclusion_reason TEXT,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (run_id, fingerprint)
);
