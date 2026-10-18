-- 0043: Recurring billing support
-- Adds Paystack plan codes to subscription_plans, raises Pro to NGN 10,000/mo
-- (NGN 100,000/yr), and adds manual_payments for bank-transfer verification.

ALTER TABLE subscription_plans ADD COLUMN paystack_plan_code TEXT;

UPDATE subscription_plans SET amount_kobo = 1000000 WHERE tier = 'pro' AND billing_cycle = 'monthly';
UPDATE subscription_plans SET amount_kobo = 10000000 WHERE tier = 'pro' AND billing_cycle = 'yearly';

CREATE TABLE manual_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('starter','pro','solo')),
  billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('monthly','yearly')),
  amount_kobo INTEGER NOT NULL,
  reference_number TEXT UNIQUE NOT NULL,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by TEXT
);
