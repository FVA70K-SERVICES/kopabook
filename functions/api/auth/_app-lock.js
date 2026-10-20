// Shared app-lock state helpers for the 4-digit PIN lock.
//
// One row per user account in user_app_locks. Only a salted PBKDF2 hash
// of the PIN is ever stored (same format as account passwords). The PIN
// gates the screen only; it never replaces the session or the password.
//
// Brute-force policy (also stated in the build report):
//   - 5 consecutive wrong PIN attempts start a lockout.
//   - Lockout durations escalate per episode: 1 minute, 5 minutes,
//     then 15 minutes for the third and later episodes.
//   - A correct PIN clears the failure count, but the episode count
//     survives a successful unlock, so the ladder keeps escalating
//     across repeated attacks; only a PIN change or a password-based
//     reset (both fully authenticated) resets the ladder.
// Dashboard invitation policy:
//   - Shown only when no PIN exists, from the account's second sign-in.
//   - "Later" snoozes it for 3 days; after 3 dismissals it never shows.
import { toSqliteDate } from "../_utils.js";

export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCKOUT_SECONDS = [60, 300, 900];
export const PIN_INVITE_SNOOZE_DAYS = 3;
export const PIN_INVITE_DISMISSAL_LIMIT = 3;
export const PIN_BACKGROUND_LOCK_MS = 5 * 60 * 1000;

// Accounts created at or before the feature was ordered count as
// existing accounts if their state row has to be created lazily (the
// migration normally seeds them at 2).
const FEATURE_EPOCH = "2026-10-20 16:56:00";

export async function ensureAppLockTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS user_app_locks (
       user_id INTEGER PRIMARY KEY REFERENCES users(id),
       pin_hash TEXT,
       enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
       failed_attempts INTEGER NOT NULL DEFAULT 0,
       lockout_episodes INTEGER NOT NULL DEFAULT 0,
       lockout_until TEXT,
       invite_dismissal_count INTEGER NOT NULL DEFAULT 0,
       invite_snoozed_until TEXT,
       sign_in_count INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT DEFAULT (datetime('now'))
     )`
  ).run();
}

export async function getAppLockRow(db, userId) {
  await ensureAppLockTable(db);
  return db.prepare(
    `SELECT * FROM user_app_locks WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
}

// Create the row if missing. initialSignInCount is only used on insert:
// sign-in flows pass the count this sign-in represents (1 for a first
// session, 2 when the account demonstrably had an earlier one).
export async function ensureAppLockRow(db, userId, initialSignInCount = 0) {
  await ensureAppLockTable(db);
  const now = toSqliteDate();
  await db.prepare(
    `INSERT INTO user_app_locks (user_id, sign_in_count, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(userId, Math.max(0, Number(initialSignInCount) || 0), now, now).run();
  return getAppLockRow(db, userId);
}

// Fallback initial count for a lazily created row (migration not yet
// applied and the sign-in predates the instrumentation): accounts that
// existed when the feature was ordered are on at least their second
// sign-in; everyone else is credited with the current session only.
export async function initialSignInCountForUser(db, userId) {
  try {
    const user = await db.prepare(
      `SELECT created_at, last_login_at FROM users WHERE id = ? LIMIT 1`
    ).bind(userId).first();
    if (user && user.created_at && String(user.created_at) <= FEATURE_EPOCH) return 2;
    if (user && user.last_login_at) return 1;
  } catch { /* fall through */ }
  return 1;
}

// Called by login, registration and bootstrap after a session is issued.
// Never throws: the app lock must not be able to break sign-in.
export async function recordAppLockSignIn(db, userId, firstObservedCount = 1) {
  try {
    await ensureAppLockTable(db);
    const now = toSqliteDate();
    const first = Math.max(1, Number(firstObservedCount) || 1);
    await db.prepare(
      `INSERT INTO user_app_locks (user_id, sign_in_count, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         sign_in_count = user_app_locks.sign_in_count + 1,
         updated_at = excluded.updated_at`
    ).bind(userId, first, now, now).run();
  } catch { /* sign-in must never fail because of the PIN lock */ }
}

function parseSqliteDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function lockoutSecondsRemaining(row, now = new Date()) {
  const until = parseSqliteDate(row && row.lockout_until);
  if (!until) return 0;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

export function publicAppLockState(row, now = new Date()) {
  const configured = !!(row && row.pin_hash);
  const enabled = configured && Number(row.enabled || 0) === 1;
  const lockoutSeconds = lockoutSecondsRemaining(row, now);
  const dismissals = Number(row?.invite_dismissal_count || 0);
  const signInCount = Number(row?.sign_in_count || 0);
  const snoozedUntil = parseSqliteDate(row && row.invite_snoozed_until);
  const snoozed = !!(snoozedUntil && snoozedUntil.getTime() > now.getTime());
  return {
    configured,
    enabled,
    failedAttempts: Number(row?.failed_attempts || 0),
    attemptsRemaining: lockoutSeconds > 0
      ? 0
      : Math.max(0, PIN_MAX_FAILED_ATTEMPTS - Number(row?.failed_attempts || 0)),
    lockoutUntil: row?.lockout_until || null,
    lockoutSecondsRemaining: lockoutSeconds,
    invite: {
      shouldShow: !configured
        && signInCount >= 2
        && dismissals < PIN_INVITE_DISMISSAL_LIMIT
        && !snoozed,
      dismissals,
      dismissalLimit: PIN_INVITE_DISMISSAL_LIMIT,
      snoozeDays: PIN_INVITE_SNOOZE_DAYS,
      snoozedUntil: row?.invite_snoozed_until || null,
      signInCount,
    },
  };
}

// Audit into the shared audit_logs table, tolerating accounts with no
// active business. The PIN and its hash are never written to the log.
export async function auditAppLock(db, auth, actionType, metadata) {
  try {
    await db.prepare(
      `INSERT INTO audit_logs (actor_user_id, business_id, action_type, entity_type, entity_id, metadata_json)
       VALUES (?, ?, ?, 'user_app_lock', ?, ?)`
    ).bind(
      auth.user.id,
      auth.business ? auth.business.id : null,
      actionType,
      auth.user.id,
      metadata ? JSON.stringify(metadata) : null
    ).run();
  } catch { /* audit must never break the lock flow */ }
}

// Register one wrong PIN attempt (shared by verify and change-PIN so the
// settings screen cannot be used to bypass the lock-screen limits).
// Returns the fresh row plus whether this attempt started a lockout.
export async function registerFailedPinAttempt(db, userId) {
  const row = await getAppLockRow(db, userId);
  const attempts = Number(row?.failed_attempts || 0) + 1;
  const now = new Date();
  if (attempts >= PIN_MAX_FAILED_ATTEMPTS) {
    const episodes = Number(row?.lockout_episodes || 0) + 1;
    const seconds = PIN_LOCKOUT_SECONDS[Math.min(episodes - 1, PIN_LOCKOUT_SECONDS.length - 1)];
    const until = toSqliteDate(new Date(now.getTime() + seconds * 1000));
    await db.prepare(
      `UPDATE user_app_locks
       SET failed_attempts = 0, lockout_episodes = ?, lockout_until = ?, updated_at = ?
       WHERE user_id = ?`
    ).bind(episodes, until, toSqliteDate(now), userId).run();
    const fresh = await getAppLockRow(db, userId);
    return { row: fresh, lockedOut: true, lockoutSeconds: seconds, episode: episodes };
  }
  await db.prepare(
    `UPDATE user_app_locks SET failed_attempts = ?, updated_at = ? WHERE user_id = ?`
  ).bind(attempts, toSqliteDate(now), userId).run();
  const fresh = await getAppLockRow(db, userId);
  return { row: fresh, lockedOut: false, lockoutSeconds: 0, episode: Number(row?.lockout_episodes || 0) };
}

// After a correct PIN: clear the running failure count and any expired
// lockout stamp, but deliberately keep lockout_episodes so the
// escalation ladder survives (see the header note).
export async function clearPinFailures(db, userId) {
  await db.prepare(
    `UPDATE user_app_locks
     SET failed_attempts = 0, lockout_until = NULL, updated_at = ?
     WHERE user_id = ?`
  ).bind(toSqliteDate(), userId).run();
}
