// /api/billing — GET current account tier, limits and usage; POST request an upgrade.
// Tiers are per account (one person), not per business. Usage figures are
// informational only and are NEVER used to block recording a sale.
import { json, getAuthContext, requireAuth, toSqliteDate } from "./_utils";
import { getActivePromoClaim, promoStateForUser } from "./_promo.js";

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
  // pending_tier (Fix 1.9, migration 0062) holds a requested tier without
  // touching tier/status. If the column is not there yet the endpoint must
  // keep working, so fall back to the pre-0062 column list.
  let row;
  try {
    row = await db.prepare(
      `SELECT tier, status, billing_cycle, current_period_end, pending_tier FROM account_subscriptions WHERE user_id = ? LIMIT 1`
    ).bind(userId).first();
  } catch (e) {
    if (!/no such column/i.test(String(e && e.message))) throw e;
    row = await db.prepare(
      `SELECT tier, status, billing_cycle, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
    ).bind(userId).first();
  }
  const tier = row && LIMITS[row.tier] ? row.tier : "free";
  const pendingTier = row && row.pending_tier && LIMITS[row.pending_tier] ? row.pending_tier : null;
  // A pending upgrade keeps the old tier until payment is confirmed.
  if (row && row.status === "pending") {
    // Legacy rows (pre-0062) stored the requested tier in tier itself;
    // new rows keep tier as the current tier and the request in
    // pending_tier. Either way the account reads as free + pending.
    return { tier: "free", pendingTier: pendingTier || (LIMITS[row.tier] ? row.tier : null), status: "pending", billingCycle: null, periodEnd: null };
  }
  const periodEnd = row ? row.current_period_end : null;
  // Expiry enforcement: a paid tier whose billing period has ended, or whose
  // subscription is past due, is treated as free. A cancelled subscription
  // is different: cancel takes effect at the end of the current billing
  // period (Terms 9.1, Refund 5.1), so it keeps its tier until the period
  // end passes, and only then drops to free. A cancelled row with no period
  // end on record cannot prove a paid period remains, so it drops to free.
  // This function never writes to the database; it only changes the tier
  // that is returned.
  let result;
  if (tier !== "free") {
    const nowIso = toSqliteDate(); // "YYYY-MM-DD HH:MM:SS" UTC, comparable as a string
    const expired = !!periodEnd && String(periodEnd) < nowIso;
    const badStatus = !!row && (row.status === "past_due" ||
      (row.status === "cancelled" && !periodEnd));
    if (expired || badStatus) {
      result = {
        tier: "free",
        pendingTier: null,
        status: row ? row.status : "active",
        billingCycle: row ? row.billing_cycle : null,
        periodEnd,
      };
    }
  }
  if (!result) {
    result = {
      tier,
      pendingTier: null,
      status: row ? row.status : "active",
      billingCycle: row ? row.billing_cycle : null,
      periodEnd,
    };
  }
  // Fix 1.9: an outstanding request is visible as pendingTier while the
  // current tier (and its limits) stay in force until activation.
  if (pendingTier) result = { ...result, pendingTier };
  // Promo overlay: an active Pro free month claim lifts the tier to pro
  // at read time only. account_subscriptions is never written, so the
  // underlying tier resumes automatically when the claim expires.
  try {
    const claim = await getActivePromoClaim(db, userId);
    if (claim && result.tier !== "pro") {
      return { ...result, tier: "pro", promoClaim: { expires_at: claim.expires_at, prior_tier: claim.prior_tier } };
    }
  } catch (e) {}
  return result;
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
    let promo = null;
    try {
      promo = await promoStateForUser(db, auth.user.id);
    } catch (e) {
      promo = null;
    }
    // Self-serve cancel is only possible for an active paid plan that
    // renews on Paystack. A stored Paystack subscription code is the
    // marker: plan charges create one, while one-off bank-transfer and
    // crypto payments never do, so those have nothing to cancel. A
    // cancelled, past due or free plan also has nothing to cancel.
    let canCancelSubscription = false;
    try {
      const subRow = await db.prepare(
        `SELECT paystack_subscription_code FROM account_subscriptions WHERE user_id = ? LIMIT 1`
      ).bind(auth.user.id).first();
      canCancelSubscription = status === "active" && tier !== "free" &&
        !!(subRow && subRow.paystack_subscription_code);
    } catch {
      canCancelSubscription = false;
    }
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
      can_cancel_subscription: canCancelSubscription,
      limits,
      usage: {
        businesses: bizRow ? bizRow.n : 0,
        salesThisWeek: salesRow ? salesRow.n : 0,
        products: productsRow ? productsRow.n : 0,
        staff: staffRow ? staffRow.n : 0,
      },
      weekStart,
      promo,
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
    // Fix 1.9: the request is recorded in pending_tier and the account keeps
    // its current tier AND status until payment is confirmed and the tier is
    // activated. The old upsert overwrote tier + status with 'pending',
    // which made getAccountTier read a paid account as Free and stripped
    // its limits on the spot. Free accounts have no paid tier to lose, so
    // they keep today's behaviour (status 'pending', tier stays 'free').
    const now = toSqliteDate();
    const existing = await context.env.KOPABOOK_DB.prepare(
      `SELECT tier, status FROM account_subscriptions WHERE user_id = ? LIMIT 1`
    ).bind(auth.user.id).first();
    let status;
    if (!existing) {
      await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO account_subscriptions (user_id, tier, status, pending_tier, updated_at)
         VALUES (?, 'free', 'pending', ?, ?)`
      ).bind(auth.user.id, tier, now).run();
      status = "pending";
    } else if (existing.tier && LIMITS[existing.tier] && existing.tier !== "free") {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE account_subscriptions SET pending_tier = ?, updated_at = ? WHERE user_id = ?`
      ).bind(tier, now, auth.user.id).run();
      status = existing.status || "active";
    } else {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE account_subscriptions SET status = 'pending', pending_tier = ?, updated_at = ? WHERE user_id = ?`
      ).bind(tier, now, auth.user.id).run();
      status = "pending";
    }

    return json({
      ok: true,
      tier,
      pending_tier: tier,
      current_tier: !existing ? "free" : (LIMITS[existing.tier] ? existing.tier : "free"),
      status,
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
