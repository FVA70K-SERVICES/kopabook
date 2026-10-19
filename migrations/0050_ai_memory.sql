CREATE TABLE IF NOT EXISTS ai_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_biz ON ai_memory(business_id);
