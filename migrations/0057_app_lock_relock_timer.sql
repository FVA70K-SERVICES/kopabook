-- 0057: Per-account re-lock timer for the PIN app lock.
-- Fortune's bank-app model: the lock lives only at the door. It asks on
-- cold open and again after the app has been away in the background for
-- the time the account chose; it never interrupts work inside the app.
-- relock_minutes is that choice: 0 = immediately (any backgrounding),
-- then 1, 5, 15 or 30 minutes. Existing accounts keep the behaviour
-- they already know, so the column lands at 5 (the original fixed
-- delay). The endpoint also self-heals this column for databases where
-- the code runs before this migration is applied.

ALTER TABLE user_app_locks
  ADD COLUMN relock_minutes INTEGER NOT NULL DEFAULT 5;
