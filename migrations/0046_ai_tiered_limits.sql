-- 0046: Tiered Kopa AI limits + AI action audit log.
-- Every tier now gets Kopa AI (Free 5/day read-only, Starter 20/day + limited
-- actions, Solo 50/day, Pro 100/day). Tracks per-day action use for capped tiers.

ALTER TABLE ai_usage ADD COLUMN actions INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  user_id INTEGER,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  params TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_action_log_biz_day ON ai_action_log(business_id, day);
