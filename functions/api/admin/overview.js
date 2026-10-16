// /api/admin/overview — platform admin only. Accounts, tiers, and recent payments.
import { json, getAuthContext, requireAuth } from "../_utils";

async function requirePlatformAdmin(context, auth) {
  const row = await context.env.KOPABOOK_DB.prepare(
    `SELECT is_platform_admin FROM users WHERE id = ? LIMIT 1`
  ).bind(auth.user.id).first();
  if (!row || !row.is_platform_admin) {
    return json({ ok: false, message: "Platform admin only." }, 403);
  }
  return null;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;

    const accounts = await db.prepare(
      `SELECT u.id, u.email, u.full_name, u.created_at,
              COALESCE(s.tier, 'free') AS tier, COALESCE(s.status, 'active') AS status,
              s.billing_cycle, s.current_period_end,
              (SELECT COUNT(*) FROM businesses b WHERE b.owner_user_id = u.id) AS businesses
       FROM users u
       LEFT JOIN account_subscriptions s ON s.user_id = u.id
       ORDER BY u.id DESC LIMIT 100`
    ).all();

    const payments = await db.prepare(
      `SELECT p.id, p.user_id, u.email, p.tier, p.billing_cycle, p.amount_kobo,
              p.paystack_reference, p.status, p.paid_at, p.created_at
       FROM subscription_payments p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.id DESC LIMIT 50`
    ).all();

    const totals = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM account_subscriptions WHERE tier != 'free' AND status = 'active') AS paying,
         (SELECT COALESCE(SUM(amount_kobo), 0) FROM subscription_payments WHERE status = 'paid') AS revenue_kobo`
    ).first();

    return json({
      ok: true,
      totals: {
        users: totals.users,
        paying: totals.paying,
        revenue: Number(totals.revenue_kobo || 0) / 100,
      },
      accounts: accounts.results || [],
      payments: payments.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load admin overview.", error: String(error) }, 500);
  }
}
