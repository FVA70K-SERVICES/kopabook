-- Crypto hardening + durable rate limiting.
-- Apply AFTER 0034_country_pricing.sql.

-- Durable rate-limit buckets (works across Cloudflare isolates).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);

-- Extra controls on crypto payments.
ALTER TABLE crypto_payments ADD COLUMN expires_at TEXT;
ALTER TABLE crypto_payments ADD COLUMN submitted_at TEXT;
ALTER TABLE crypto_payments ADD COLUMN verification_json TEXT;
ALTER TABLE crypto_payments ADD COLUMN reject_reason TEXT;
-- One transaction hash can only ever pay for one subscription (NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payments_txhash ON crypto_payments(tx_hash);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_expiry ON crypto_payments(expires_at);
