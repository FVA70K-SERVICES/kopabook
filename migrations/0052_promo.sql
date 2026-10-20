-- 0052: Pro free for one month promotion.
-- The promo lives entirely in its own tables and never writes to
-- account_subscriptions, so the underlying billing state is preserved
-- and resumes automatically when a claim expires. No payment is
-- involved in this promotion at all.

CREATE TABLE IF NOT EXISTS promos (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS promo_claims (
  id TEXT PRIMARY KEY,
  promo_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  prior_tier TEXT NOT NULL,
  prior_status TEXT,
  prior_period_end TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(promo_slug, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_claims_user ON promo_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_promo_claims_slug_status ON promo_claims (promo_slug, status);

INSERT OR IGNORE INTO promos (slug, name, tier, duration_days, is_active, starts_at, ends_at)
VALUES ('pro-free-month', 'Pro free for one month', 'pro', 30, 1, NULL, NULL);
