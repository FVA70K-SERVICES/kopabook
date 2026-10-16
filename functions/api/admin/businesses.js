// /api/admin/businesses — platform admin only. All businesses on the platform.
import { json, getAuthContext, requireAuth } from "../_utils";
import { requirePlatformAdmin } from "./overview";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT b.id, b.name, b.business_type, b.country, b.currency, b.status, b.created_at,
              u.email AS owner_email, u.full_name AS owner_name,
              COALESCE(s.tier, 'free') AS owner_tier,
              (SELECT COUNT(*) FROM sales WHERE business_id = b.id) AS sales,
              (SELECT COUNT(*) FROM products WHERE business_id = b.id AND is_active = 1) AS products,
              (SELECT COUNT(*) FROM business_members WHERE business_id = b.id) AS staff
       FROM businesses b
       LEFT JOIN users u ON u.id = b.owner_user_id
       LEFT JOIN account_subscriptions s ON s.user_id = u.id
       ORDER BY b.id DESC LIMIT 100`
    ).all();
    return json({ ok: true, businesses: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load businesses.", error: String(error) }, 500);
  }
}
