-- 0055: Admin AI's own settings, owned by the platform owner account.
-- Voice gender, language and auto-speak for the Admin AI door live here,
-- keyed by the owner's user id. This is deliberately separate from the
-- per-business Ask Kopa assistant settings in business_chat_settings:
-- neither store reads or writes the other.

CREATE TABLE IF NOT EXISTS admin_ai_settings (
  user_id INTEGER PRIMARY KEY,
  voice TEXT NOT NULL DEFAULT 'default',
  language TEXT NOT NULL DEFAULT 'en',
  auto_speak INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
