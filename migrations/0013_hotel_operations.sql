-- 0013: hotel operations module
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'Standard',
  floor TEXT,
  rate_per_night REAL NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'vacant',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(business_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_hotel_rooms_business ON hotel_rooms(business_id, status);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  room_id INTEGER NOT NULL REFERENCES hotel_rooms(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_id_type TEXT,
  guest_id_number TEXT,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_room ON hotel_bookings(business_id, room_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_status ON hotel_bookings(business_id, status, check_in);

CREATE TABLE IF NOT EXISTS hotel_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  booking_id INTEGER NOT NULL REFERENCES hotel_bookings(id),
  category TEXT NOT NULL DEFAULT 'room',
  description TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hotel_charges_booking ON hotel_charges(booking_id);

CREATE TABLE IF NOT EXISTS hotel_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  booking_id INTEGER NOT NULL REFERENCES hotel_bookings(id),
  amount REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'Cash',
  note TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_booking ON hotel_payments(booking_id);
