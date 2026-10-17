-- Kopa Bot per-business memory + pending sale confirmations
-- Every row is scoped to a business_id. The bot must NEVER read
-- or write memories/actions for a different business.

CREATE TABLE IF NOT EXISTS bot_business_memory (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bot_memory_biz ON bot_business_memory(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_memory_biz_key ON bot_business_memory(business_id, memory_key);

CREATE TABLE IF NOT EXISTS bot_pending_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bot_pending_session ON bot_pending_actions(session_id, business_id);
