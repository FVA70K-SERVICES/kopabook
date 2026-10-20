// POST /api/billing/promo/claim: claim the Pro free for one month promotion.
// One claim per account, ever. No payment is involved: no card and no
// Paystack checkout. The claim is recorded in promo_claims only, and the
// underlying subscription in account_subscriptions is left untouched.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../../_utils.js";
import {
  PROMO_SLUG,
  ensurePromoTables,
  getPromoDef,
  getClaim,
  baseTierFromSubscription,
  promoStateForUser,
  isPromoRunning,
} from "../../_promo.js";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    await ensurePromoTables(db);

    const def = await getPromoDef(db);
    if (!def || !isPromoRunning(def)) {
      return json({ ok: false, message: "This promotion is not running right now." }, 400);
    }

    const existing = await getClaim(db, auth.user.id);
    if (existing) {
      return json({ ok: false, message: "This account has already claimed the free Pro month." }, 409);
    }

    const base = await baseTierFromSubscription(db, auth.user.id);
    if (base.tier === "pro") {
      return json({ ok: false, message: "You already have Pro, so there is nothing to claim." }, 400);
    }

    // Snapshot the underlying subscription exactly as it stands, so the
    // record shows what the account returns to when the promo ends.
    const subRow = await db.prepare(
      `SELECT tier, status, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
    ).bind(auth.user.id).first();

    const durationDays = Number(def.duration_days) || 30;
    const claimedAt = toSqliteDate();
    const expiresAt = toSqliteDate(new Date(Date.now() + durationDays * 86400000));
    const id = "claim_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    try {
      await db.prepare(
        `INSERT INTO promo_claims
           (id, promo_slug, user_id, claimed_at, expires_at, prior_tier, prior_status, prior_period_end, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      ).bind(
        id,
        PROMO_SLUG,
        auth.user.id,
        claimedAt,
        expiresAt,
        base.tier,
        subRow ? subRow.status : null,
        subRow ? subRow.current_period_end : null
      ).run();
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/unique|constraint/i.test(msg)) {
        return json({ ok: false, message: "This account has already claimed the free Pro month." }, 409);
      }
      throw e;
    }

    await audit(context, auth, "promo.claim", "promo_claim", id, {
      promo: PROMO_SLUG,
      prior_tier: base.tier,
    });

    const promo = await promoStateForUser(db, auth.user.id);
    return json({ ok: true, message: "Your free Pro month has started.", promo });
  } catch (error) {
    return json(
      { ok: false, message: "Could not claim the free Pro month.", error: String(error) },
      500
    );
  }
}
