// /api/auth/app-lock — the signed-in account's 4-digit PIN app lock.
//
// GET  returns the public lock state (never the hash): whether a PIN is
//      configured, whether the lock is on, lockout timing, and whether
//      the dashboard setup invitation should show for this account.
// POST actions (all require the normal session; there is no public path):
//   setup        { pin, confirmPin }            first PIN, turns lock on
//   verify       { pin }                        lock-screen unlock check
//   change       { currentPin, newPin, confirmPin }
//   reset        { password, newPin, confirmPin }  forgot-PIN recovery
//   set_enabled  { enabled, currentPin? }       disabling requires the PIN
//   dismiss_invite {}                           snooze / retire the invite
//   lock         {}                             audit that the screen locked
//
// The PIN is stored only as a salted PBKDF2 hash (see _app-lock.js for
// the lockout and invitation numbers). Verification shares one failure
// counter across verify and change so no path bypasses the lockout.
import {
  json,
  getAuthContext,
  hashPassword,
  verifyPassword,
  toSqliteDate,
} from "../_utils.js";
import {
  ensureAppLockRow,
  getAppLockRow,
  initialSignInCountForUser,
  publicAppLockState,
  lockoutSecondsRemaining,
  registerFailedPinAttempt,
  clearPinFailures,
  auditAppLock,
  PIN_INVITE_SNOOZE_DAYS,
} from "./_app-lock.js";

const PIN_RE = /^\d{4}$/;

function validPin(value) {
  return PIN_RE.test(String(value ?? ""));
}

async function loadState(context, auth) {
  const db = context.env.KOPABOOK_DB;
  let row = await getAppLockRow(db, auth.user.id);
  if (!row) {
    const initial = await initialSignInCountForUser(db, auth.user.id);
    row = await ensureAppLockRow(db, auth.user.id, initial);
  }
  return { db, row };
}

function stateResponse(row, extra = {}, status = 200) {
  return json({ ok: true, ...extra, appLock: publicAppLockState(row) }, status);
}

function lockoutResponse(row) {
  const seconds = lockoutSecondsRemaining(row);
  return json(
    {
      ok: false,
      message: `Too many wrong PIN attempts. Try again in ${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? "" : "s"}, or reset your PIN with your account password.`,
      retryAfterSeconds: seconds,
      appLock: publicAppLockState(row),
    },
    429,
    { "Retry-After": String(seconds) }
  );
}

// Shared wrong-PIN handling for verify and change: counts the failure,
// audits it, and answers 401 or 429 when the attempt trips a lockout.
async function failPinAttempt(db, auth, row, source) {
  const result = await registerFailedPinAttempt(db, auth.user.id);
  if (result.lockedOut) {
    await auditAppLock(db, auth, "auth.app_lock.lockout", {
      source, episode: result.episode, lockoutSeconds: result.lockoutSeconds,
    });
    return lockoutResponse(result.row);
  }
  await auditAppLock(db, auth, "auth.app_lock.verify_failed", { source });
  const state = publicAppLockState(result.row);
  return json(
    {
      ok: false,
      message: `Incorrect PIN. ${state.attemptsRemaining} attempt${state.attemptsRemaining === 1 ? "" : "s"} left before a pause.`,
      appLock: state,
    },
    401
  );
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
    const { row } = await loadState(context, auth);
    return stateResponse(row);
  } catch (error) {
    return json({ ok: false, message: "Could not load app lock state.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    if (!auth) return json({ ok: false, message: "Not signed in." }, 401);
    const { db, row } = await loadState(context, auth);
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "lock") {
      if (row.pin_hash && Number(row.enabled || 0) === 1) {
        await auditAppLock(db, auth, "auth.app_lock.lock", { source: String(body.source || "app").slice(0, 24) });
      }
      return stateResponse(row);
    }

    if (action === "dismiss_invite") {
      if (!row.pin_hash) {
        const dismissals = Number(row.invite_dismissal_count || 0) + 1;
        const snoozedUntil = dismissals < 3
          ? toSqliteDate(new Date(Date.now() + PIN_INVITE_SNOOZE_DAYS * 24 * 3600 * 1000))
          : null;
        await db.prepare(
          `UPDATE user_app_locks SET invite_dismissal_count = ?, invite_snoozed_until = ?, updated_at = ? WHERE user_id = ?`
        ).bind(dismissals, snoozedUntil, toSqliteDate(), auth.user.id).run();
        await auditAppLock(db, auth, "auth.app_lock.invite_dismiss", { dismissals });
      }
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh);
    }

    if (action === "setup") {
      if (row.pin_hash) {
        return json({ ok: false, message: "A PIN is already set. Use Change PIN instead." }, 409);
      }
      if (!validPin(body.pin)) return json({ ok: false, message: "Your PIN must be exactly 4 digits." }, 400);
      if (String(body.pin) !== String(body.confirmPin)) {
        return json({ ok: false, message: "The two PINs do not match." }, 400);
      }
      const pinHash = await hashPassword(String(body.pin));
      await db.prepare(
        `UPDATE user_app_locks
         SET pin_hash = ?, enabled = 1, failed_attempts = 0, lockout_episodes = 0,
             lockout_until = NULL, updated_at = ?
         WHERE user_id = ?`
      ).bind(pinHash, toSqliteDate(), auth.user.id).run();
      await auditAppLock(db, auth, "auth.app_lock.set", { enabled: true });
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh, { message: "App lock is on. Your PIN is set." });
    }

    if (action === "verify") {
      if (!row.pin_hash) return json({ ok: false, message: "No PIN is set for this account." }, 400);
      if (lockoutSecondsRemaining(row) > 0) return lockoutResponse(row);
      if (!validPin(body.pin)) return json({ ok: false, message: "Enter your 4-digit PIN." }, 400);
      const okPin = await verifyPassword(String(body.pin), row.pin_hash);
      if (!okPin) return failPinAttempt(db, auth, row, "verify");
      await clearPinFailures(db, auth.user.id);
      await auditAppLock(db, auth, "auth.app_lock.unlock", { source: "pin" });
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh, { message: "Unlocked." });
    }

    if (action === "change") {
      if (!row.pin_hash) return json({ ok: false, message: "No PIN is set for this account." }, 400);
      if (lockoutSecondsRemaining(row) > 0) return lockoutResponse(row);
      if (!validPin(body.currentPin)) return json({ ok: false, message: "Enter your current 4-digit PIN." }, 400);
      if (!validPin(body.newPin)) return json({ ok: false, message: "Your new PIN must be exactly 4 digits." }, 400);
      if (String(body.newPin) !== String(body.confirmPin)) {
        return json({ ok: false, message: "The two new PINs do not match." }, 400);
      }
      const okPin = await verifyPassword(String(body.currentPin), row.pin_hash);
      if (!okPin) return failPinAttempt(db, auth, row, "change");
      const pinHash = await hashPassword(String(body.newPin));
      await db.prepare(
        `UPDATE user_app_locks
         SET pin_hash = ?, failed_attempts = 0, lockout_episodes = 0, lockout_until = NULL, updated_at = ?
         WHERE user_id = ?`
      ).bind(pinHash, toSqliteDate(), auth.user.id).run();
      await auditAppLock(db, auth, "auth.app_lock.change", {});
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh, { message: "PIN changed." });
    }

    if (action === "reset") {
      if (!body.password) return json({ ok: false, message: "Enter your account password." }, 400);
      if (!validPin(body.newPin)) return json({ ok: false, message: "Your new PIN must be exactly 4 digits." }, 400);
      if (String(body.newPin) !== String(body.confirmPin)) {
        return json({ ok: false, message: "The two new PINs do not match." }, 400);
      }
      const user = await db.prepare(
        `SELECT password_hash FROM users WHERE id = ? LIMIT 1`
      ).bind(auth.user.id).first();
      if (!user || !(await verifyPassword(String(body.password), user.password_hash))) {
        await auditAppLock(db, auth, "auth.app_lock.reset_failed", {});
        return json({ ok: false, message: "That password is incorrect." }, 403);
      }
      const pinHash = await hashPassword(String(body.newPin));
      await db.prepare(
        `UPDATE user_app_locks
         SET pin_hash = ?, enabled = 1, failed_attempts = 0, lockout_episodes = 0,
             lockout_until = NULL, updated_at = ?
         WHERE user_id = ?`
      ).bind(pinHash, toSqliteDate(), auth.user.id).run();
      await auditAppLock(db, auth, "auth.app_lock.reset", { enabled: true });
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh, { message: "PIN reset and app lock is on." });
    }

    if (action === "set_enabled") {
      if (!row.pin_hash) return json({ ok: false, message: "Set a PIN first." }, 400);
      const enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1";
      if (!enabled) {
        // Turning the lock off needs the PIN, so a borrowed open session
        // cannot quietly strip the protection.
        if (lockoutSecondsRemaining(row) > 0) return lockoutResponse(row);
        if (!validPin(body.currentPin)) return json({ ok: false, message: "Enter your current PIN to turn the lock off." }, 400);
        const okPin = await verifyPassword(String(body.currentPin), row.pin_hash);
        if (!okPin) return failPinAttempt(db, auth, row, "disable");
        await clearPinFailures(db, auth.user.id);
      }
      await db.prepare(
        `UPDATE user_app_locks SET enabled = ?, updated_at = ? WHERE user_id = ?`
      ).bind(enabled ? 1 : 0, toSqliteDate(), auth.user.id).run();
      await auditAppLock(db, auth, enabled ? "auth.app_lock.enabled" : "auth.app_lock.disabled", {});
      const fresh = await getAppLockRow(db, auth.user.id);
      return stateResponse(fresh, { message: enabled ? "App lock is on." : "App lock is off. Your PIN is kept for when you turn it back on." });
    }

    return json({ ok: false, message: "Unknown app lock action." }, 400);
  } catch (error) {
    return json({ ok: false, message: "App lock request failed.", error: String(error) }, 500);
  }
}
