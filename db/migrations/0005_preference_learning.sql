-- Learned ranking signals. Existing jobs, feedback, and history stay in place.
-- Not Interested rows that predate reasons are labeled legacy and stay hidden.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'search';

CREATE TABLE IF NOT EXISTS feedback_reasons (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  UNIQUE (feedback_id, reason)
);

CREATE INDEX IF NOT EXISTS feedback_reasons_feedback_idx ON feedback_reasons (feedback_id);

CREATE TABLE IF NOT EXISTS preference_meta (
  id TEXT PRIMARY KEY,
  reset_at TIMESTAMPTZ
);

INSERT INTO preference_meta (id)
SELECT 'default'
WHERE NOT EXISTS (SELECT 1 FROM preference_meta WHERE id = 'default');

INSERT INTO feedback_reasons (id, feedback_id, reason)
SELECT 'legacy-' || f.id, f.id, 'legacy'
FROM feedback f
WHERE f.action = 'not_interested'
  AND NOT EXISTS (SELECT 1 FROM feedback_reasons r WHERE r.feedback_id = f.id);
