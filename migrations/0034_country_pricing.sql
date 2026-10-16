-- Country-aware pricing: track country and payment method on payments.
-- NOTE: subscription_payments.currency already exists (added by 0027_paystack_billing.sql),
-- so it is intentionally not added here.
-- Crypto payments table for countries where cards don't work well.

ALTER TABLE subscription_payments ADD COLUMN country TEXT DEFAULT 'Nigeria';
ALTER TABLE subscription_payments ADD COLUMN payment_method TEXT DEFAULT 'paystack';

CREATE TABLE IF NOT EXISTS crypto_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  crypto_currency TEXT NOT NULL DEFAULT 'USDT',
  crypto_amount TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  confirmed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_user ON crypto_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_ref ON crypto_payments(reference);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_status ON crypto_payments(status);
