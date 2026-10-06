-- Durable job memory: first time a role was surfaced, live-seen timestamps,
-- and a closed/unavailable lifecycle that does not delete history or feedback.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS first_surfaced_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_live_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'active';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS consecutive_misses INTEGER NOT NULL DEFAULT 0;

ALTER TABLE job_sources ADD COLUMN IF NOT EXISTS ats_provider TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ats_status TEXT NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS disabled_sources (
  provider TEXT NOT NULL,
  identifier TEXT NOT NULL,
  company_name TEXT,
  reason TEXT,
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, identifier)
);

UPDATE jobs
SET first_surfaced_at = first_seen_at
WHERE first_surfaced_at IS NULL
  AND feed_bucket <> 'excluded';

UPDATE jobs AS j
SET last_seen_live_at = j.last_seen_at
FROM companies AS c
WHERE c.id = j.company_id
  AND j.last_seen_live_at IS NULL
  AND c.discovered_from IS DISTINCT FROM 'sample import';

CREATE INDEX IF NOT EXISTS job_sources_external_idx ON job_sources (external_id);
CREATE INDEX IF NOT EXISTS jobs_availability_idx ON jobs (availability, feed_bucket);
