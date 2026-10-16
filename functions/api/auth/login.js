// POST /api/auth/login
import {
  json,
  verifyPassword,
  newSessionToken,
  toSqliteDate,
  sessionCookieHeader,
} from "../_utils";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return json({ ok: false, message: "Email and password are required." }, 400);
    }

    const user = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = ? LIMIT 1`
    )
      .bind(String(email).trim().toLowerCase())
      .first();

    if (!user || user.status !== "active") {
      return json({ ok: false, message: "Invalid email or password." }, 401);
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      return json({ ok: false, message: "Invalid email or password." }, 401);
    }

    const now = toSqliteDate();
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE users SET last_login_at = ? WHERE id = ?`
    )
      .bind(now, user.id)
      .run();

    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const firstBiz = await context.env.KOPABOOK_DB.prepare(
      `SELECT business_members.business_id FROM business_members
       INNER JOIN businesses ON businesses.id = business_members.business_id
       WHERE business_members.user_id = ?
         AND (businesses.status IS NULL OR businesses.status = 'active')
         AND (business_members.suspended IS NULL OR business_members.suspended = 0)
       ORDER BY business_members.id ASC LIMIT 1`
    ).bind(user.id).first();
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at, business_id)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(user.id, token, toSqliteDate(expires), now, firstBiz ? firstBiz.business_id : null)
      .run();

    return json(
      {
        ok: true,
        user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role },
      },
      200,
      { "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 3600) }
    );
  } catch (error) {
    return json({ ok: false, message: "Login failed.", error: String(error) }, 500);
  }
}
