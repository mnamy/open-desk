-- Postgres schema for Open Desk.
-- Runs on local PGlite and can be applied to Supabase Postgres as-is.

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  website TEXT,
  careers_url TEXT,
  ats_provider TEXT,
  ats_identifier TEXT,
  industry TEXT,
  discovered_from TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies (id),
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  role_family TEXT,
  description TEXT NOT NULL,
  location_raw TEXT,
  normalized_city TEXT,
  work_arrangement TEXT NOT NULL,
  experience_min INTEGER,
  experience_max INTEGER,
  experience_required_or_preferred TEXT,
  experience_label TEXT,
  employment_type TEXT,
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  application_url TEXT,
  canonical_url TEXT,
  source TEXT,
  source_url TEXT,
  opportunity_fit INTEGER,
  qualification_risk TEXT,
  why_match TEXT,
  stretch_reason TEXT,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  content_hash TEXT,
  feed_bucket TEXT NOT NULL,
  exclusion_reason TEXT,
  is_new BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  application_url TEXT,
  external_id TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, source, source_url)
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('save', 'applied', 'not_interested', 'hide_company', 'hide_role_type')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classification_cache (
  content_hash TEXT PRIMARY KEY,
  opportunity_fit INTEGER NOT NULL,
  qualification_risk TEXT NOT NULL,
  why_match TEXT NOT NULL,
  stretch_reason TEXT NOT NULL,
  role_family TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  jobs_seen INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  jobs_main INTEGER NOT NULL DEFAULT 0,
  jobs_stretch INTEGER NOT NULL DEFAULT 0,
  jobs_excluded INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS jobs_feed_idx ON jobs (feed_bucket, opportunity_fit DESC);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company_id);
CREATE INDEX IF NOT EXISTS feedback_job_idx ON feedback (job_id, action);
