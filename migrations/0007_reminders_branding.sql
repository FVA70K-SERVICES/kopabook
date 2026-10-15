-- 0007: WhatsApp upgrades — store branding, staff phones, reminder log
ALTER TABLE businesses ADD COLUMN brand_color TEXT DEFAULT '#166534';
ALTER TABLE businesses ADD COLUMN tagline TEXT;
ALTER TABLE businesses ADD COLUMN reminder_template TEXT;

ALTER TABLE users ADD COLUMN phone TEXT;

CREATE TABLE IF NOT EXISTS reminder_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  phone TEXT,
  message TEXT,
  sent_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_business ON reminder_logs(business_id, created_at DESC);
