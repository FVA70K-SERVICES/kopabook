// POST /api/auth/register — public self-registration for a new business.
// Anyone can register their own business (e.g. a hotel) and become its owner.
// This is the multi-business signup; the original /owner-setup bootstrap stays
// for the very first business on a fresh deployment.
import {
  json,
  hashPassword,
  newSessionToken,
  toSqliteDate,
  sessionCookieHeader,
  audit,
} from "../_utils";

const DEFAULT_MODES = [
  ["Cash", 1],
  ["Bank Transfer", 2],
  ["POS / Card", 3],
  ["USSD", 4],
  ["Credit", 5],
];

const DEFAULT_CATEGORIES = ["Stock / Purchases", "Transport", "Rent", "Salaries", "Utilities", "Marketing", "Other"];

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const { fullName, email, password, phone, businessName, businessType, state, city } = body;

    if (!fullName || !email || !password || !businessName) {
      return json({ ok: false, message: "Your name, email, password and business name are required." }, 400);
    }
    if (String(password).length < 8) {
      return json({ ok: false, message: "Password must be at least 8 characters." }, 400);
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ ok: false, message: "Enter a valid email address." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const taken = await db.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(cleanEmail).first();
    if (taken) {
      return json({ ok: false, message: "An account with this email already exists. Please sign in." }, 409);
    }

    const passwordHash = await hashPassword(String(password));
    const now = toSqliteDate();

    const userResult = await db.prepare(
      `INSERT INTO users (full_name, email, phone, password_hash, role, status, last_login_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?)`
    ).bind(fullName.trim(), cleanEmail, String(phone || "").slice(0, 20) || null, passwordHash, now).run();
    const userId = userResult.meta.last_row_id;

    const bizResult = await db.prepare(
      `INSERT INTO businesses (owner_user_id, name, business_type, state, city, currency, plan_tier)
       VALUES (?, ?, ?, ?, ?, 'NGN', 'free')`
    ).bind(userId, businessName.trim(), businessType || "general", state || null, city || null).run();
    const businessId = bizResult.meta.last_row_id;

    await db.prepare(
      `INSERT INTO business_members (business_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`
    ).bind(businessId, userId, now).run();

    for (const name of DEFAULT_CATEGORIES) {
      await db.prepare(
        `INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 1)`
      ).bind(businessId, name).run();
    }
    for (const [modeName, sortOrder] of DEFAULT_MODES) {
      await db.prepare(
        `INSERT INTO payment_modes (business_id, name, sort_order) VALUES (?, ?, ?)`
      ).bind(businessId, modeName, sortOrder).run();
    }

    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await db.prepare(
      `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, token, toSqliteDate(expires), now).run();

    await audit(context,
      { user: { id: Number(userId) }, business: { id: Number(businessId) } },
      "auth.register", "businesses", Number(businessId),
      { businessType: businessType || "general" });

    return json(
      {
        ok: true,
        user: { id: Number(userId), fullName: fullName.trim(), email: cleanEmail, role: "owner" },
        business: { id: Number(businessId), name: businessName.trim() },
      },
      201,
      { "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 3600) }
    );
  } catch (error) {
    return json({ ok: false, message: "Registration failed. Please try again.", error: String(error) }, 500);
  }
}
