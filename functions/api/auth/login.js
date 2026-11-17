// POST /api/auth/login — accepts email OR username, one login for everything.
//
// Fix 2.6: rate limiting plus lockout, all through the existing
// checkRateLimit helper (functions/api/_webhook_security.js, D1-backed
// rate_limits table — same helper billing/checkout.js already uses):
//   - per identifier: 10 attempts per hour (login_id_<identifier>)
//   - per IP: 30 attempts per hour (login_ip_<ip>) — higher than the
//     per-identifier cap because many users share one IP (offices,
//     schools, mobile NAT); it still caps credential spraying from a
//     single address
//   - lockout: 10 failed attempts per identifier per hour
//     (login_fail_<identifier>, failures only) then 429 until the
//     window passes; a successful login clears the failure count
//   - progressive delay on a failed attempt: 0ms, 500ms, 1s, 1.5s,
//     then 2s, from the failure count
// All three gates answer with the same generic message so the response
// never reveals which gate tripped, or whether the account exists.
// Unknown or inactive accounts still pay one full PBKDF2 verify
// against a dummy hash, so timing cannot enumerate accounts.
import {
  json,
  verifyPassword,
  newSessionToken,
  toSqliteDate,
  sessionCookieHeader,
  DUMMY_PASSWORD_HASH,
} from "../_utils";
import { checkRateLimit } from "../_webhook_security";
import { recordAppLockSignIn } from "./_app-lock";

const LOGIN_ID_MAX = 10;
const LOGIN_IP_MAX = 30;
const LOGIN_FAIL_MAX = 10;
const LOGIN_WINDOW_MS = 3600000; // 1 hour
const TOO_MANY = "Too many sign-in attempts. Please try again later.";

function clientIp(request) {
  const raw =
    request.headers.get("CF-Connecting-IP") ||
    String(request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown";
  // Keys land in the rate_limits table; keep them to safe characters.
  return raw.replace(/[^0-9a-zA-Z.:-]/g, "").slice(0, 64) || "unknown";
}

// Failures-only count for the lockout gate. checkRateLimit has no
// read-only form (it checks and increments), so the gate reads the row
// directly; a missing table fails open, matching checkRateLimit.
async function loginFailCount(db, failKey) {
  try {
    const row = await db.prepare(
      `SELECT count, window_start FROM rate_limits WHERE key = ?`
    ).bind(failKey).first();
    if (!row) return 0;
    if (Number(row.window_start) < Date.now() - LOGIN_WINDOW_MS) return 0;
    return Number(row.count || 0);
  } catch {
    return 0;
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const identifier = String(body.identifier || body.email || "").trim();
    const { password } = body;

    if (!identifier || !password) {
      return json({ ok: false, message: "Email or username and password are required." }, 400);
    }

    const idLower = identifier.toLowerCase();
    const db = context.env.KOPABOOK_DB;
    const failKey = `login_fail_${idLower}`;

    // Per-IP gate, then per-identifier gate, then the failures-only lockout.
    if (!(await checkRateLimit(db, `login_ip_${clientIp(context.request)}`, LOGIN_IP_MAX, LOGIN_WINDOW_MS))) {
      return json({ ok: false, message: TOO_MANY }, 429);
    }
    if (!(await checkRateLimit(db, `login_id_${idLower}`, LOGIN_ID_MAX, LOGIN_WINDOW_MS))) {
      return json({ ok: false, message: TOO_MANY }, 429);
    }
    if ((await loginFailCount(db, failKey)) >= LOGIN_FAIL_MAX) {
      return json({ ok: false, message: TOO_MANY }, 429);
    }

    // Try email-or-username match. The username column (migration 0049)
    // is relied on directly; live D1 has it.
    const user = await db.prepare(
      `SELECT id, full_name, email, username, password_hash, role, status, last_login_at FROM users WHERE email = ? OR username = ? LIMIT 1`
    )
      .bind(idLower, idLower)
      .first();

    // Unknown account: pay the PBKDF2 cost against the dummy hash so
    // this path times like a wrong password, then answer generically.
    if (!user) {
      await verifyPassword(String(password), DUMMY_PASSWORD_HASH);
      await checkRateLimit(db, failKey, LOGIN_FAIL_MAX, LOGIN_WINDOW_MS);
      return json({ ok: false, message: "Invalid login or password." }, 401);
    }

    // Inactive account: verify against the real hash (same cost as a
    // normal attempt) so status is not enumerable by timing either.
    if (user.status !== "active") {
      await verifyPassword(String(password), user.password_hash);
      await checkRateLimit(db, failKey, LOGIN_FAIL_MAX, LOGIN_WINDOW_MS);
      return json({ ok: false, message: "Invalid login or password." }, 401);
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      // Record the failure, then delay progressively from the count:
      // 1st failure no delay, then 500ms, 1s, 1.5s, capped at 2s.
      await checkRateLimit(db, failKey, LOGIN_FAIL_MAX, LOGIN_WINDOW_MS);
      const fails = await loginFailCount(db, failKey);
      const delayMs = Math.min(Math.max(fails - 1, 0), 4) * 500;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return json({ ok: false, message: "Invalid login or password." }, 401);
    }

    // Success clears the failure count (best effort; never blocks login).
    try {
      await db.prepare(`DELETE FROM rate_limits WHERE key = ?`).bind(failKey).run();
    } catch { /* failure count survives; the window still expires it */ }

    // App-lock invitation bookkeeping: a previous last_login_at means
    // this is at least the account's second sign-in; without one it is
    // the first. recordAppLockSignIn never throws.
    await recordAppLockSignIn(db, user.id, user.last_login_at ? 2 : 1);

    const now = toSqliteDate();
    await db.prepare(
      `UPDATE users SET last_login_at = ? WHERE id = ?`
    )
      .bind(now, user.id)
      .run();

    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const firstBiz = await db.prepare(
      `SELECT business_members.business_id FROM business_members
       INNER JOIN businesses ON businesses.id = business_members.business_id
       WHERE business_members.user_id = ?
         AND (businesses.status IS NULL OR businesses.status = 'active')
         AND (business_members.suspended IS NULL OR business_members.suspended = 0)
       ORDER BY business_members.id ASC LIMIT 1`
    ).bind(user.id).first();
    await db.prepare(
      `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at, business_id)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(user.id, token, toSqliteDate(expires), now, firstBiz ? firstBiz.business_id : null)
      .run();

    return json(
      {
        ok: true,
        user: { id: user.id, fullName: user.full_name, email: user.email, username: user.username || null, role: user.role },
      },
      200,
      { "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 3600) }
    );
  } catch (error) {
    return json({ ok: false, message: "Login failed.", error: String(error) }, 500);
  }
}
