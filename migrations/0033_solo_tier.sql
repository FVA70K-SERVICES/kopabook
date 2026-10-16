-- Solo tier: for single-shop owners who want the AI copilot as their worker

-- Add solo to subscription plans
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('solo', 'monthly', 500000);
INSERT OR IGNORE INTO subscription_plans (tier, billing_cycle, amount_kobo) VALUES ('solo', 'yearly', 5000000);

-- Update tier check constraints to include solo
-- Note: SQLite doesn't support altering CHECK constraints directly
-- The app validates tiers, so we document the allowed values here:
-- Allowed tiers: free, starter, solo, pro
