// /api/admin/overview — platform admin only. Full platform stats.
import { json, getAuthContext, requireAuth } from "../_utils";

export async function requirePlatformAdmin(context, auth) {
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

    const totals = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended,
         (SELECT COUNT(*) FROM businesses) AS businesses,
         (SELECT COUNT(*) FROM businesses WHERE status IS NULL OR status = 'active') AS active_businesses,
         (SELECT COUNT(*) FROM sales) AS sales,
         (SELECT COALESCE(SUM(total_amount), 0) FROM sales) AS sales_volume,
         (SELECT COUNT(*) FROM account_subscriptions WHERE tier != 'free' AND status = 'active') AS paying,
         (SELECT COALESCE(SUM(amount_kobo), 0) FROM subscription_payments WHERE status = 'paid') AS revenue_kobo,
         (SELECT COUNT(*) FROM account_subscriptions WHERE status = 'pending') AS pending_upgrades`
    ).first();

    const byTier = await db.prepare(
      `SELECT COALESCE(s.tier, 'free') AS tier, COUNT(*) AS n
       FROM users u LEFT JOIN account_subscriptions s ON s.user_id = u.id
       GROUP BY COALESCE(s.tier, 'free')`
    ).all();

    const recentUsers = await db.prepare(
      `SELECT u.id, u.email, u.full_name, u.created_at, COALESCE(s.tier, 'free') AS tier
       FROM users u LEFT JOIN account_subscriptions s ON s.user_id = u.id
       ORDER BY u.id DESC LIMIT 10`
    ).all();

    const recentPayments = await db.prepare(
      `SELECT p.id, u.email, p.tier, p.billing_cycle, p.amount_kobo, p.currency, p.country, p.payment_method, p.status, p.paid_at
       FROM subscription_payments p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.id DESC LIMIT 20`
    ).all();

    return json({
      ok: true,
      totals: {
        users: totals.users,
        suspended: totals.suspended,
        businesses: totals.businesses,
        activeBusinesses: totals.active_businesses,
        sales: totals.sales,
        salesVolume: Math.round(Number(totals.sales_volume || 0) * 100) / 100,
        paying: totals.paying,
        revenue: Number(totals.revenue_kobo || 0) / 100,
        pendingUpgrades: totals.pending_upgrades,
      },
      byTier: byTier.results || [],
      recentUsers: recentUsers.results || [],
      recentPayments: recentPayments.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load admin overview.", error: String(error) }, 500);
  }
}
