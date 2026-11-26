-- 0065: Kopa AI Llama shadow pilot (26 Nov 2026).
-- Shadow mode only: Llama runs beside Gemini on ONE business (FVA70K STORE,
-- business id 1) and its answers are logged, never served. Gemini stays the
-- provider for every customer. The flag table is server-side only; there is
-- no endpoint that flips it, so no customer can turn it on for themselves.
-- The log is per business_id, server-side only, and no route returns it.
CREATE TABLE IF NOT EXISTS ai_shadow_pilot (
  business_id INTEGER PRIMARY KEY,
  shadow INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_shadow_log (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  question TEXT NOT NULL,
  llama_ms INTEGER,
  llama_ok INTEGER NOT NULL DEFAULT 0,
  llama_status TEXT,
  llama_text TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  neurons_estimate INTEGER,
  figures_check_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_shadow_log_business_day ON ai_shadow_log(business_id, day);
CREATE INDEX IF NOT EXISTS idx_ai_shadow_log_day ON ai_shadow_log(day);
-- Seed: shadow ON for FVA70K STORE (business id 1, Fortune's own business,
-- verified in live D1 26 Nov 2026). Every other business defaults to off:
-- no row reads as off.
INSERT OR IGNORE INTO ai_shadow_pilot (business_id, shadow, updated_at)
VALUES (1, 1, CAST(strftime('%s', 'now') AS INTEGER));
