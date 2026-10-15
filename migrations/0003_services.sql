-- KopaBook services mode (Stream D): services offered by artisans/professionals,
-- sellable alongside products in the same sale without stock tracking.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'per job',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Mark each sale line as a product line or a service line.
ALTER TABLE sale_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'product';
ALTER TABLE sale_items ADD COLUMN service_id INTEGER NULL REFERENCES services(id);

CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id, is_active);
