// /api/billing — GET current account tier, limits and usage; POST request an upgrade.
// Tiers are per account (one person), not per business. Usage figures are
// informational only and are NEVER used to block recording a sale.
import { json, getAuthContext, requireAuth, toSqliteDate } from "./_utils";

// null = unlimited
export const LIMITS = {
  free: { businesses: 1, salesPerWeek: 100, products: 100, staff: 1 },
  starter: { businesses: 5, salesPerWeek: 1000, products: 1000, staff: 5 },
  solo: { businesses: 1, salesPerWeek: null, products: 500, staff: 3, aiWorker: true },
  pro: { businesses: null, salesPerWeek: null, products: null, staff: null, aiWorker: true },
};

export const TIER_NAMES = { free: "Free", starter: "Starter", solo: "Solo", pro: "Pro" };
export const TIER_PRICES = { free: "Free", starter: "NGN 1,000/month", solo: "NGN 5,000/month", pro: "NGN 10,000/month" };

export async function getAccountTier(db, userId) {
  const row = await db.prepare(
    `SELECT tier, status, billing_cycle, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
  const tier = row && LIMITS[row.tier] ? row.tier : "free";
  // A pending upgrade keeps the old tier until payment is confirmed.
  if (row && row.status === "pending") {
    return { tier: "free", pendingTier: row.tier, status: "pending", billingCycle: null, periodEnd: null };
  }
  const periodEnd = row ? row.current_period_end : null;
  // Expiry enforcement: a paid tier whose billing period has ended, or whose
  // subscription is past due or cancelled, is treated as free. This function
  // never writes to the database; it only changes the tier that is returned.
  if (tier !== "free") {
    const nowIso = toSqliteDate(); // "YYYY-MM-DD HH:MM:SS" UTC, comparable as a string
    const expired = !!periodEnd && String(periodEnd) < nowIso;
    const badStatus = !!row && (row.status === "past_due" || row.status === "cancelled");
    if (expired || badStatus) {
      return {
        tier: "free",
        pendingTier: null,
        status: row ? row.status : "active",
        billingCycle: row ? row.billing_cycle : null,
        periodEnd,
      };
    }
  }
  return {
    tier,
    pendingTier: null,
    status: row ? row.status : "active",
    billingCycle: row ? row.billing_cycle : null,
    periodEnd,
  };
}

// Tier of the account that owns a business (staff act under the owner's plan).
export async function getBusinessOwnerTier(db, businessId) {
  const biz = await db.prepare(
    `SELECT owner_user_id FROM businesses WHERE id = ? LIMIT 1`
  ).bind(businessId).first();
  if (!biz) return { tier: "free", pendingTier: null, status: "active" };
  return getAccountTier(db, biz.owner_user_id);
}

// Monday 00:00 UTC of the current week. sales.created_at is stored in UTC
// ("YYYY-MM-DD HH:MM:SS" via datetime('now')), so the week window must use
// UTC too, not server-local time, or Monday would shift for some merchants.
function weekStartUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const mondayOffset = (d.getUTCDay() + 6) % 7; // Monday -> 0, Sunday -> 6
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    const { tier, pendingTier, status, billingCycle, periodEnd } = await getAccountTier(db, auth.user.id);
    const limits = LIMITS[tier];
    const businessId = auth.business.id;

    const weekStart = toSqliteDate(weekStartUtc());

    const bizRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM businesses
       WHERE owner_user_id = ? AND (status IS NULL OR status = 'active')`
    ).bind(auth.user.id).first();
    const salesRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM sales WHERE business_id = ? AND created_at >= ?`
    ).bind(businessId, weekStart).first();
    const productsRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM products WHERE business_id = ? AND is_active = 1`
    ).bind(businessId).first();
    const staffRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`
    ).bind(businessId).first();

    return json({
      ok: true,
      tier,
      tierName: TIER_NAMES[tier],
      price: TIER_PRICES[tier],
      status,
      pendingTier,
      billing_cycle: billingCycle,
      current_period_end: periodEnd,
      limits,
      usage: {
        businesses: bizRow ? bizRow.n : 0,
        salesThisWeek: salesRow ? salesRow.n : 0,
        products: productsRow ? productsRow.n : 0,
        staff: staffRow ? staffRow.n : 0,
      },
      weekStart,
    });
  } catch (error) {
    return json(
      { ok: false, message: "Could not load billing.", error: String(error) },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    if (!LIMITS[tier] || tier === "free") {
      return json({ ok: false, message: "Pick a valid paid tier: starter or pro." }, 400);
    }

    // Real payment is arranged outside the app (KopaBook never processes money).
    // The request is noted as pending; the account keeps its current tier until
    // payment is confirmed and the tier is activated manually.
    const now = toSqliteDate();
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO account_subscriptions (user_id, tier, status, updated_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, status = 'pending', updated_at = excluded.updated_at`
    ).bind(auth.user.id, tier, now).run();

    return json({
      ok: true,
      tier,
      status: "pending",
      message:
        "Upgrade request noted. We will contact you on WhatsApp to complete payment, then your new limits turn on.",
    });
  } catch (error) {
    return json(
      { ok: false, message: "Could not record the upgrade.", error: String(error) },
      500
    );
  }
}
