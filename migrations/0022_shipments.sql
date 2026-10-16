-- 0022 Shipment tracking for sold products.
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  tracking_number TEXT NOT NULL,
  recipient_name TEXT,
  recipient_phone TEXT,
  address TEXT,
  courier TEXT,
  status TEXT DEFAULT 'pending',
  shipped_at TEXT,
  delivered_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(business_id, tracking_number)
);
CREATE INDEX IF NOT EXISTS idx_shipments_business ON shipments(business_id);
CREATE INDEX IF NOT EXISTS idx_shipments_sale ON shipments(sale_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
