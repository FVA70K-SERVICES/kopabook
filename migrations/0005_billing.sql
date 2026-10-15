-- KopaBook billing tiers (STREAM G)
-- One subscription row per business. The free tier always exists.
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id),
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro')),
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  renews_at TEXT
);

-- Backfill: every existing business starts on the free tier.
INSERT INTO subscriptions (business_id, tier, status, started_at)
SELECT id, 'free', 'active', datetime('now')
FROM businesses
WHERE id NOT IN (SELECT business_id FROM subscriptions);

CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
