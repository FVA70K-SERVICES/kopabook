-- Bot brain: reminders, conversation memory, routines

CREATE TABLE IF NOT EXISTS bot_reminders (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL,
  user_id TEXT,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  repeat_type TEXT DEFAULT 'once',
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON bot_reminders(business_id, remind_at, status);

CREATE TABLE IF NOT EXISTS bot_routines (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL,
  routine_type TEXT NOT NULL,
  schedule_time TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_routines_biz ON bot_routines(business_id, enabled);

-- Conversation memory per session
ALTER TABLE chat_sessions ADD COLUMN memory_summary TEXT;
ALTER TABLE chat_sessions ADD COLUMN visitor_intent TEXT;
