-- 0027 Paystack subscription billing.
-- Extends account_subscriptions with billing cycle and Paystack references.
-- New table logs every Paystack payment attempt for the account.

ALTER TABLE account_subscriptions ADD COLUMN billing_cycle TEXT DEFAULT 'monthly';
ALTER TABLE account_subscriptions ADD COLUMN paystack_customer_code TEXT;
ALTER TABLE account_subscriptions ADD COLUMN paystack_subscription_code TEXT;
ALTER TABLE account_subscriptions ADD COLUMN current_period_start TEXT;
ALTER TABLE account_subscriptions ADD COLUMN current_period_end TEXT;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tier TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_kobo INTEGER NOT NULL,
  currency TEXT DEFAULT 'NGN',
  paystack_reference TEXT UNIQUE NOT NULL,
  paystack_customer_code TEXT,
  paystack_subscription_code TEXT,
  status TEXT DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_payments_user ON subscription_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_ref ON subscription_payments(paystack_reference);
