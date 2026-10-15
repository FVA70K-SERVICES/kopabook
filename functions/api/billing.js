// /api/billing — GET current tier, limits and usage; POST record an upgrade request.
// Usage figures are informational only and are NEVER used to block recording a sale.
import { json, getAuthContext, requireAuth, toSqliteDate } from "./_utils";

// null = unlimited
const LIMITS = {
  free: { salesPerWeek: 100, products: 100, staff: 2, branches: 1 },
  starter: { salesPerWeek: 1000, products: 1000, staff: 5, branches: 1 },
  pro: { salesPerWeek: null, products: null, staff: null, branches: 3 },
};

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
    const businessId = auth.business.id;

    const sub = await db
      .prepare(`SELECT tier, status FROM subscriptions WHERE business_id = ? LIMIT 1`)
      .bind(businessId)
      .first();
    const tier = sub && LIMITS[sub.tier] ? sub.tier : "free";
    const limits = LIMITS[tier];

    const weekStart = toSqliteDate(weekStartUtc());

    const salesRow = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM sales WHERE business_id = ? AND created_at >= ?`
      )
      .bind(businessId, weekStart)
      .first();
    const productsRow = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM products WHERE business_id = ? AND is_active = 1`
      )
      .bind(businessId)
      .first();
    const staffRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`)
      .bind(businessId)
      .first();

    return json({
      ok: true,
      tier,
      status: sub ? sub.status : "active",
      limits,
      usage: {
        salesThisWeek: salesRow ? salesRow.n : 0,
        products: productsRow ? productsRow.n : 0,
        staff: staffRow ? staffRow.n : 0,
        // v1 ships single-branch only; branches stays 1 until the multi-branch build lands.
        branches: 1,
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
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can change the plan." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    if (!LIMITS[tier] || tier === "free") {
      return json({ ok: false, message: "Pick a valid paid tier: starter or pro." }, 400);
    }

    // Real payment comes later. For now the request is noted as pending and the
    // merchant keeps their current tier until payment is confirmed manually.
    const now = toSqliteDate();
    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO subscriptions (business_id, tier, status, started_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(business_id) DO UPDATE SET tier = excluded.tier, status = 'pending'`
    )
      .bind(auth.business.id, tier, now)
      .run();

    return json({
      ok: true,
      tier,
      status: "pending",
      message:
        "Upgrade request noted. We will contact you to complete payment before the new limits turn on.",
    });
  } catch (error) {
    return json(
      { ok: false, message: "Could not record the upgrade.", error: String(error) },
      500
    );
  }
}
