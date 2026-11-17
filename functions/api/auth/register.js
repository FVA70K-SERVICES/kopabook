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
import { verifyHumanToken } from "../_fvaverify";
import { checkRateLimit } from "../_webhook_security";
import { sha256Hex, randomToken } from "../_mail";
import { recordAppLockSignIn } from "./_app-lock";

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
    const { fullName, email, password, phone, businessName, businessType, customType, state, city, country, currency, timezone } = body;

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

    // Fix 2.6: rate limiting through the existing checkRateLimit helper
    // (same helper billing/checkout.js uses). 5 registrations per IP
    // per hour and 3 per email per hour: a public signup must not be a
    // free account farm.
    const ip = (context.request.headers.get("CF-Connecting-IP") ||
      String(context.request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
      "unknown").replace(/[^0-9a-zA-Z.:-]/g, "").slice(0, 64) || "unknown";
    if (!(await checkRateLimit(db, `register_ip_${ip}`, 5, 3600000))) {
      return json({ ok: false, message: "Too many registrations. Please try again later." }, 429);
    }
    if (!(await checkRateLimit(db, `register_email_${cleanEmail}`, 3, 3600000))) {
      return json({ ok: false, message: "Too many registrations. Please try again later." }, 429);
    }

    // FVAVerify human check (skipped until FVAVerify is live and configured).
    // NOTE (Fix 2.6): "skipped" is literal — verifyHumanToken returns null
    // when FVA_VERIFY_SECRET is not set in Pages, and the frontend widget
    // (src/components/HumanCheck.jsx) renders nothing while
    // FVA_VERIFY_SITEKEY is empty, so no token is ever sent today. The
    // wiring on both ends is complete and the check enforces itself the
    // moment the secret + site key land; until then it cannot be switched
    // on from code alone, because failing closed here would refuse every
    // new signup while there is no service to verify against. The rate
    // limit above is the compensating control until FVAVerify goes live.
    const human = await verifyHumanToken(context.env, body.fvaverify_token);
    if (human && !human.ok) {
      return json({ ok: false, message: human.message }, 403);
    }

    const taken = await db.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(cleanEmail).first();
    if (taken) {
      return json({ ok: false, message: "An account with this email already exists. Please sign in." }, 409);
    }

    const passwordHash = await hashPassword(String(password));
    const now = toSqliteDate();

    // Optional username: 3-20 chars, letters/numbers/underscore. One account,
    // one login: the username also works on the sign-in page.
    let username = String(body.username || "").trim().toLowerCase();
    if (username) {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return json({ ok: false, message: "Username must be 3 to 20 characters: letters, numbers and underscore only." }, 400);
      }
      // The username column (migration 0049) is relied on directly; live
      // D1 has it. A database error here fails registration instead of
      // silently registering without the username the user chose.
      const takenU = await db.prepare(`SELECT id FROM users WHERE username = ? LIMIT 1`).bind(username).first();
      if (takenU) {
        return json({ ok: false, message: "That username is taken. Try another." }, 409);
      }
    }

    let userResult;
    if (username) {
      userResult = await db.prepare(
        `INSERT INTO users (full_name, email, username, phone, password_hash, role, status, last_login_at)
         VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?)`
      ).bind(fullName.trim(), cleanEmail, username, String(phone || "").slice(0, 20) || null, passwordHash, now).run();
    } else {
      userResult = await db.prepare(
        `INSERT INTO users (full_name, email, phone, password_hash, role, status, last_login_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', ?)`
      ).bind(fullName.trim(), cleanEmail, String(phone || "").slice(0, 20) || null, passwordHash, now).run();
    }
    const userId = userResult.meta.last_row_id;

    // First session for the app-lock invitation: the PIN invite only
    // appears from this account's second sign-in onward.
    await recordAppLockSignIn(db, userId, 1);

    const bizResult = await db.prepare(
      `INSERT INTO businesses (owner_user_id, name, business_type, custom_type, state, city, country, currency, timezone, plan_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'free')`
    ).bind(userId, businessName.trim(), businessType || "general", businessType === "other" && customType ? String(customType).trim().slice(0, 60) : null, state || null, city || null, String(country || "Nigeria").slice(0, 60), /^[A-Z]{3}$/.test(String(currency)) ? currency : "NGN", String(timezone || "Africa/Lagos").slice(0, 60)).run();
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
      `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at, business_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(userId, token, toSqliteDate(expires), now, businessId).run();

    // Fix 2.6: email verification plumbing. Record a single-use token
    // (hashed, 24 h expiry) in email_verifications so the address can
    // be proven later at POST /api/auth/verify-email. Deliberately
    // incomplete by design, not by accident:
    //   - NO email is sent here — the send step waits on the
    //     mail-provider decision, so there is no link to deliver yet.
    //   - Sign-in behaviour is UNCHANGED: the account stays 'active',
    //     the session above is issued exactly as before, and login
    //     never requires email_verified_at. Existing users are
    //     unaffected, and a new user is never locked out by a
    //     verification email that was never sent.
    //   - If the table has not landed yet (migration 0063), the token
    //     insert fails quietly and registration still succeeds.
    try {
      const verifyToken = randomToken(32);
      const verifyHash = await sha256Hex(verifyToken);
      await db.prepare(
        `INSERT INTO email_verifications (user_id, token_hash, expires_at)
         VALUES (?, ?, datetime('now', '+24 hours'))`
      ).bind(userId, verifyHash).run();
    } catch { /* verification not armed yet; registration still succeeds */ }

    await audit(context,
      { user: { id: Number(userId) }, business: { id: Number(businessId) } },
      "auth.register", "businesses", Number(businessId),
      { businessType: businessType || "general" });

    return json(
      {
        ok: true,
        user: { id: Number(userId), fullName: fullName.trim(), email: cleanEmail, username: username || null, role: "owner" },
        business: { id: Number(businessId), name: businessName.trim() },
      },
      201,
      { "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 3600) }
    );
  } catch (error) {
    return json({ ok: false, message: "Registration failed. Please try again.", error: String(error) }, 500);
  }
}
