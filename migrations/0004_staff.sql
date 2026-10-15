-- KopaBook migration 0004: staff permission flags, commission rates, shift tracking.
-- STREAM F (staff upgrade).

-- Granular staff permissions on business_members. Owners always have full
-- access regardless of these flags; the flags gate manager/attendant actions.
ALTER TABLE business_members ADD COLUMN can_view_profit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_members ADD COLUMN can_discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_members ADD COLUMN can_manage_expenses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_members ADD COLUMN can_manage_products INTEGER NOT NULL DEFAULT 0;

-- Commission rate in percent (0-100) used by /api/staff/commissions.
ALTER TABLE business_members ADD COLUMN commission_percent REAL NOT NULL DEFAULT 0;

-- Clock-in / clock-out records. member_id points at business_members so a
-- user who is removed from the business keeps their historical shifts.
CREATE TABLE IF NOT EXISTS staff_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  member_id INTEGER NOT NULL REFERENCES business_members(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shifts_business_member ON staff_shifts(business_id, member_id, clock_in);
