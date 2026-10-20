// POST /api/auth/login — accepts email OR username, one login for everything.
import {
  json,
  verifyPassword,
  newSessionToken,
  toSqliteDate,
  sessionCookieHeader,
} from "../_utils";
import { recordAppLockSignIn } from "./_app-lock";

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
    // Try email-or-username match. Falls back to email-only when the
    // username column does not exist yet (migration 0049 not applied).
    let user = null;
    try {
      user = await db.prepare(
        `SELECT id, full_name, email, username, password_hash, role, status, last_login_at FROM users WHERE email = ? OR username = ? LIMIT 1`
      )
        .bind(idLower, idLower)
        .first();
    } catch (e) {
      user = await db.prepare(
        `SELECT id, full_name, email, password_hash, role, status, last_login_at FROM users WHERE email = ? LIMIT 1`
      )
        .bind(idLower)
        .first();
    }

    if (!user || user.status !== "active") {
      return json({ ok: false, message: "Invalid login or password." }, 401);
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      return json({ ok: false, message: "Invalid login or password." }, 401);
    }

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
