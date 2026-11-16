-- 0062: plan-change requests must not strip the paid tier (Fix 1.9).
-- Adds pending_tier to account_subscriptions. A plan-change request records
-- the requested tier here and leaves tier/status untouched, so a paid
-- account keeps its tier and limits until payment is confirmed and the tier
-- is activated (by Paystack verify/webhook or manual approval).
-- Apply in the D1 console, one statement at a time, in KOPABOOK_DB only,
-- BEFORE the code push that reads this column. This migration only ADDS
-- one column. No row is changed, no table is dropped.
ALTER TABLE account_subscriptions ADD COLUMN pending_tier TEXT;
