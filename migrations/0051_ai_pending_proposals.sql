CREATE TABLE IF NOT EXISTS ai_pending_proposals (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  tool TEXT NOT NULL,
  params TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_proposals_business_session_status ON ai_pending_proposals(business_id, session_key, status);
