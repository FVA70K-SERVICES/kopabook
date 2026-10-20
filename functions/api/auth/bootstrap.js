// POST /api/auth/bootstrap — first-time owner setup.
// Requires BOOTSTRAP_KEY secret; only works when no users exist yet.
import {
  json,
  hashPassword,
  newSessionToken,
  toSqliteDate,
  sessionCookieHeader,
} from "../_utils";
import { recordAppLockSignIn } from "./_app-lock";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { bootstrapKey, fullName, email, password, businessName, businessType, state, city } = body;

    const expected = context.env.BOOTSTRAP_KEY;
    if (!expected || bootstrapKey !== expected) {
      return json({ ok: false, message: "Invalid bootstrap key." }, 403);
    }

    const existing = await context.env.KOPABOOK_DB.prepare(
      `SELECT COUNT(*) AS c FROM users`
    ).first();
    if (existing && Number(existing.c) > 0) {
      return json({ ok: false, message: "Owner already set up. Please log in." }, 409);
    }

    if (!fullName || !email || !password || !businessName) {
      return json({ ok: false, message: "Name, email, password and business name are required." }, 400);
    }
    if (String(password).length < 8) {
      return json({ ok: false, message: "Password must be at least 8 characters." }, 400);
    }

    const passwordHash = await hashPassword(String(password));
    const now = toSqliteDate();

    const userResult = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO users (full_name, email, password_hash, role, status, last_login_at)
       VALUES (?, ?, ?, 'owner', 'active', ?)`
    )
      .bind(fullName.trim(), String(email).trim().toLowerCase(), passwordHash, now)
      .run();
    const userId = userResult.meta.last_row_id;

    // First session for the app-lock invitation (see register.js).
    await recordAppLockSignIn(context.env.KOPABOOK_DB, userId, 1);

    const bizResult = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO businesses (owner_user_id, name, business_type, state, city, currency, plan_tier)
       VALUES (?, ?, ?, ?, ?, 'NGN', 'free')`
    )
      .bind(userId, businessName.trim(), businessType || null, state || null, city || null)
      .run();
    const businessId = bizResult.meta.last_row_id;

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO business_members (business_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`
    )
      .bind(businessId, userId, now)
      .run();

    // Seed default expense categories
    const defaults = ["Stock / Purchases", "Transport", "Rent", "Salaries", "Utilities", "Marketing", "Other"];
    for (const name of defaults) {
      await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 1)`
      )
        .bind(businessId, name)
        .run();
    }

    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at, business_id)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, token, toSqliteDate(expires), now, typeof businessId !== "undefined" ? businessId : null)
      .run();

    return json(
      {
        ok: true,
        user: { id: userId, fullName: fullName.trim(), email: String(email).trim().toLowerCase(), role: "owner" },
        business: { id: businessId, name: businessName.trim() },
      },
      201,
      { "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 3600) }
    );
  } catch (error) {
    return json({ ok: false, message: "Setup failed.", error: String(error) }, 500);
  }
}
