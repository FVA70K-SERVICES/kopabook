-- 0009: custom payment modes per business
CREATE TABLE IF NOT EXISTS payment_modes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(business_id, name)
);
CREATE INDEX IF NOT EXISTS idx_payment_modes_business ON payment_modes(business_id, sort_order);

-- Seed sensible defaults for every existing business
INSERT OR IGNORE INTO payment_modes (business_id, name, sort_order)
SELECT id, 'Cash', 1 FROM businesses
UNION ALL SELECT id, 'Bank Transfer', 2 FROM businesses
UNION ALL SELECT id, 'POS / Card', 3 FROM businesses
UNION ALL SELECT id, 'USSD', 4 FROM businesses
UNION ALL SELECT id, 'Credit', 5 FROM businesses;
