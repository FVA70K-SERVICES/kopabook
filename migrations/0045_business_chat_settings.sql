-- 0045: per-business chatbot controls (bot on/off, auto-clear history).
-- Lets each business owner switch their public chat widget between bot
-- and human, and optionally auto-delete old chat messages.

CREATE TABLE IF NOT EXISTS business_chat_settings (
  business_id INTEGER PRIMARY KEY,
  bot_enabled INTEGER NOT NULL DEFAULT 1,
  auto_clear_enabled INTEGER NOT NULL DEFAULT 0,
  auto_clear_hours INTEGER NOT NULL DEFAULT 24,
  last_auto_clear_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link chat sites to the business that owns them, so per-business
-- chatbot settings (and lazy history cleanup) can find their sessions.
ALTER TABLE chat_sites ADD COLUMN business_id INTEGER;
