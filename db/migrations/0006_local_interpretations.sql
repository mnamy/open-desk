-- Optional local-model interpretations. Existing jobs and feedback stay in place.
-- signals is JSON text. The deterministic feed and fit columns are not updated here.

CREATE TABLE IF NOT EXISTS interpretations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  signals TEXT NOT NULL,
  model_id TEXT NOT NULL,
  parsed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, subject_id, content_hash)
);

CREATE INDEX IF NOT EXISTS interpretations_subject_idx ON interpretations (kind, subject_id);
