// /api/businesses — GET list my businesses, POST create a new one.
// One owner account can own and switch between many businesses.
import { json, getAuthContext, requireAuth, toSqliteDate, audit } from "./_utils";

const DEFAULT_MODES = [
  ["Cash", 1],
  ["Bank Transfer", 2],
  ["POS / Card", 3],
  ["USSD", 4],
  ["Credit", 5],
];
const DEFAULT_CATEGORIES = ["Stock / Purchases", "Transport", "Rent", "Salaries", "Utilities", "Marketing", "Other"];

export async function onRequestGet(context) {
  const auth = await getAuthContext(context);
  const denied = requireAuth(auth);
  if (denied) return denied;

  const rows = await context.env.KOPABOOK_DB.prepare(
    `SELECT b.id, b.name, b.business_type, b.status, m.role,
            (SELECT COUNT(*) FROM business_members WHERE business_id = b.id) AS member_count
     FROM businesses b
     JOIN business_members m ON m.business_id = b.id
     WHERE m.user_id = ?
     ORDER BY m.id ASC`
  ).bind(auth.user.id).all();

  return json({ ok: true, businesses: rows.results || [], activeId: auth.business?.id || null });
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const businessType = String(body.businessType || "other").slice(0, 40);
    const customType = String(body.customType || "").trim().slice(0, 60);
    const currency = /^[A-Z]{3}$/.test(String(body.currency)) ? body.currency : "NGN";
    const country = String(body.country || "Nigeria").slice(0, 60);
    const timezone = String(body.timezone || "Africa/Lagos").slice(0, 60);
    if (!name) return json({ ok: false, message: "Business name is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const now = toSqliteDate();

    const bizResult = await db.prepare(
      `INSERT INTO businesses (owner_user_id, name, business_type, custom_type, country, currency, timezone, plan_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'free')`
    ).bind(auth.user.id, name, businessType, businessType === "other" && customType ? customType : null, country, currency, timezone).run();
    const businessId = bizResult.meta.last_row_id;

    await db.prepare(
      `INSERT INTO business_members (business_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`
    ).bind(businessId, auth.user.id, now).run();

    for (const cat of DEFAULT_CATEGORIES) {
      await db.prepare(
        `INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 1)`
      ).bind(businessId, cat).run();
    }
    for (const [modeName, sortOrder] of DEFAULT_MODES) {
      await db.prepare(
        `INSERT INTO payment_modes (business_id, name, sort_order) VALUES (?, ?, ?)`
      ).bind(businessId, modeName, sortOrder).run();
    }

    // Switch this session straight into the new business.
    const token = (context.request.headers.get("cookie") || "").match(/kopabook_session=([^;]+)/)?.[1];
    if (token) {
      await db.prepare(`UPDATE sessions SET business_id = ? WHERE session_token = ?`)
        .bind(businessId, token).run();
    }

    await audit(context, auth, "business.create", "businesses", Number(businessId), { name, businessType });
    return json({ ok: true, business: { id: Number(businessId), name } }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create business.", error: String(error) }, 500);
  }
}
