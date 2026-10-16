-- 0029 Subscription plans table. Prices are editable from the admin panel,
-- so fees are never hardcoded in the app.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_kobo INTEGER NOT NULL,
  currency TEXT DEFAULT 'NGN',
  active INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tier, billing_cycle)
);
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('starter', 'monthly', 100000);
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('starter', 'yearly', 1000000);
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('pro', 'monthly', 250000);
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('pro', 'yearly', 2500000);
