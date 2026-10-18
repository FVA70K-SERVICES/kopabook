-- 0043 Manual bank-transfer payments.
-- A user initiates a manual payment, gets a KB-XXXXXX reference number, pays to the
-- FVA70K SERVICES OPay account with the reference in the transfer narration, then
-- uploads a photo of the receipt. A platform admin reviews and approves/rejects.
-- Approval activates the tier on account_subscriptions; rejection just marks the row.
CREATE TABLE IF NOT EXISTS manual_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tier TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_kobo INTEGER NOT NULL,
  reference_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  proof_url TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_payments_ref ON manual_payments(reference_number);
CREATE INDEX IF NOT EXISTS idx_manual_payments_user ON manual_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_payments_status ON manual_payments(status);
