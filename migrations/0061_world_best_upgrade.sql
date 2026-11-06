-- KopaBook world-best upgrade (migration 0061).
-- Apply AFTER migration 0060 (staff/owners build) in the D1 console, one
-- statement at a time, in KOPABOOK_DB only. Before running, do a read-only
-- check that each column/table below is absent; skip any statement whose
-- target already exists. Never rewrite an applied migration.
-- This migration only ADDS columns/tables. No row is changed, no table is
-- dropped, no past sale, price, or tax rate is rewritten.
-- Deploy order: migration 0060, then 0061, then the code push.

-- Customer contact + credit (receipt upgrade, rules D3/D7).
-- credit_limit: NULL = no limit set (current behaviour preserved: a balance
-- is allowed as today). 0 = no credit allowed. Above 0 = cap in business
-- currency. The proposal said default 0 = no credit; NULL is used instead
-- so live credit sales (e.g. Favour) are not blocked the day this lands.
-- The owner sets 0 per customer for no-credit, or a cap, in Customer detail.
ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN credit_limit NUMERIC;
ALTER TABLE customers ADD COLUMN telegram_chat_id TEXT;

-- Receipt settings on the business (proposal section 9, D4).
ALTER TABLE businesses ADD COLUMN receipt_email TEXT;
ALTER TABLE businesses ADD COLUMN receipt_telegram TEXT;
ALTER TABLE businesses ADD COLUMN receipt_show_phone INTEGER NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN receipt_show_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN receipt_show_telegram INTEGER NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN receipt_language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE businesses ADD COLUMN low_stock_default INTEGER NOT NULL DEFAULT 5;
ALTER TABLE businesses ADD COLUMN overdue_days INTEGER NOT NULL DEFAULT 7;

-- Who may sell on credit (D7). Owner/partner/manager are allowed by role;
-- this flag additionally allows other roles (cashier/attendant) when set to 1.
ALTER TABLE business_members ADD COLUMN can_sell_on_credit INTEGER NOT NULL DEFAULT 0;

-- Per-user app language (translation). 'en' default; the app falls back to
-- English for any language with no translation.
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

-- Payment mode kind (D8): 'cash' | 'transfer' | 'card' | 'credit'.
-- A mode with kind 'credit' is buy-now-pay-later: its tender does not count
-- as money received. Existing modes keep kind 'cash' until the owner sets
-- the kind in Settings. A mode NAMED 'credit' is treated as credit-kind by
-- the endpoints even before this migration runs (name fallback).
ALTER TABLE payment_modes ADD COLUMN kind TEXT NOT NULL DEFAULT 'cash';

-- Receipt send log: enforces the 100/day per-business caps (D1/D2).
CREATE TABLE IF NOT EXISTS receipt_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  sale_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipt_sends_business_day ON receipt_sends (business_id, channel, created_at);

-- Stock adjustments with a reason (roadmap: stock done fully).
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  delta NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product ON stock_adjustments (business_id, product_id, created_at);

-- History: append-only record of everything in the business (world-best
-- addition 2026-11-05). One row per event, never updated, never deleted.
-- type: sale | expense | payment | debt | stock | customer | staff | settings
-- | receipt. amount is in business currency when the event has one, else NULL.
-- actor_name/actor_role are snapshotted at write time so history stays
-- readable even if the member is later removed.
CREATE TABLE IF NOT EXISTS history_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  amount NUMERIC,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_events_business ON history_events (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_history_events_type ON history_events (business_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_history_events_actor ON history_events (business_id, actor_id, created_at);
