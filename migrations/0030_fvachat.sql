-- FVAChat tables for KopaBook

CREATE TABLE IF NOT EXISTS chat_sites (
  site_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  website_url TEXT,
  bot_name TEXT DEFAULT 'Kopa Bot',
  bot_enabled INTEGER DEFAULT 1,
  welcome_message TEXT,
  brand_color TEXT DEFAULT '#15803d',
  plan TEXT DEFAULT 'internal',
  memory_json TEXT,
  created_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  site_id TEXT DEFAULT 'kopabook',
  visitor_name TEXT NOT NULL DEFAULT 'Visitor',
  visitor_email TEXT,
  page_url TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  needs_human INTEGER DEFAULT 0,
  rating INTEGER,
  rating_feedback TEXT,
  rated_at INTEGER,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  agent_typing INTEGER DEFAULT 0,
  visitor_typing INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('visitor', 'agent', 'bot')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_by_agent INTEGER DEFAULT 0,
  read_by_visitor INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_usage (
  site_id TEXT NOT NULL,
  month TEXT NOT NULL,
  conversations INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  bookings INTEGER DEFAULT 0,
  PRIMARY KEY (site_id, month)
);

CREATE INDEX IF NOT EXISTS idx_kb_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kb_sessions_status ON chat_sessions(status, last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_kb_sessions_site ON chat_sessions(site_id, status);

-- Register KopaBook as a chat site
INSERT OR IGNORE INTO chat_sites (site_id, business_name, website_url, bot_name, welcome_message, brand_color, plan, created_at)
VALUES (
  'kopabook',
  'KopaBook',
  'https://kopabook-bop.pages.dev',
  'Kopa Bot',
  'Hello! I''m Kopa Bot. Ask me about KopaBook features, pricing, or how to get started!',
  '#15803d',
  'internal',
  strftime('%s', 'now') * 1000
);

-- Staff assignment for chats (owner center + staff control)
ALTER TABLE chat_sessions ADD COLUMN assigned_to TEXT;
ALTER TABLE chat_sessions ADD COLUMN assigned_at TEXT;
ALTER TABLE chat_sessions ADD COLUMN handled_by TEXT DEFAULT 'bot';
