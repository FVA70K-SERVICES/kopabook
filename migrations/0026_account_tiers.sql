-- 0026 Account-level tiers. A free account can create 1 business, then must upgrade.
CREATE TABLE IF NOT EXISTS account_subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  tier TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  updated_at TEXT DEFAULT (datetime('now'))
);
