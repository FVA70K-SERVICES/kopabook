-- 0044: per-business daily usage cap for Kopa AI (20 answers per UTC day).
CREATE TABLE IF NOT EXISTS ai_usage (
  business_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day)
);
