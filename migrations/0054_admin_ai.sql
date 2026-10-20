-- 0054: Admin AI proposals.
-- Owner-only AI control centre. The chat can read platform figures and
-- prepare write actions as proposals, but a proposal never runs from
-- chat: it only executes when the owner taps Confirm on its card, which
-- posts to /api/admin/ai/confirm. Proposals expire after 15 minutes.

CREATE TABLE IF NOT EXISTS admin_ai_proposals (
  id TEXT PRIMARY KEY,
  admin_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_user_id INTEGER,
  target_label TEXT,
  params TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_ai_proposals_admin_status ON admin_ai_proposals (admin_user_id, status);
