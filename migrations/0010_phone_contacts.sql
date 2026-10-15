-- 0010: phone contact matching + telegram handles
CREATE TABLE IF NOT EXISTS phone_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(business_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_phone_contacts_business ON phone_contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_phone_contacts_phone ON phone_contacts(business_id, phone);

ALTER TABLE customers ADD COLUMN telegram TEXT;
