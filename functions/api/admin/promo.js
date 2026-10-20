// /api/admin/promo: platform admin only. View and manage the
// Pro free for one month promotion: toggle it on or off, list claims,
// and revoke a claim.
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "../_utils.js";
import { requirePlatformAdmin } from "./overview.js";
import { PROMO_SLUG, ensurePromoTables, getPromoDef } from "../_promo.js";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;
    await ensurePromoTables(db);

    const def = await getPromoDef(db);
    const now = toSqliteDate();

    const countsRow = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN status = 'active' AND expires_at > ? THEN 1 ELSE 0 END), 0) AS active
       FROM promo_claims WHERE promo_slug = ?`
    ).bind(now, PROMO_SLUG).first();

    const claimsRes = await db.prepare(
      `SELECT c.id, c.promo_slug, c.user_id, c.claimed_at, c.expires_at,
              c.prior_tier, c.prior_status, c.prior_period_end, c.status, c.created_at,
              u.email AS email, u.full_name AS full_name
       FROM promo_claims c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.promo_slug = ?
       ORDER BY c.claimed_at DESC, c.id DESC
       LIMIT 200`
    ).bind(PROMO_SLUG).all();

    return json({
      ok: true,
      promo: def
        ? {
            slug: def.slug,
            name: def.name,
            tier: def.tier,
            duration_days: def.duration_days,
            is_active: def.is_active,
            starts_at: def.starts_at,
            ends_at: def.ends_at,
          }
        : null,
      counts: {
        total: countsRow ? Number(countsRow.total || 0) : 0,
        active: countsRow ? Number(countsRow.active || 0) : 0,
      },
      claims: claimsRes.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load the promotion.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const adminDenied = await requirePlatformAdmin(context, auth);
    if (adminDenied) return adminDenied;

    const db = context.env.KOPABOOK_DB;
    await ensurePromoTables(db);

    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "toggle") {
      if (![0, 1, "0", "1", true, false].includes(body.is_active)) {
        return json({ ok: false, message: "is_active must be 0 or 1." }, 400);
      }
      const isActive = body.is_active === true || Number(body.is_active) === 1 ? 1 : 0;
      await db.prepare(
        `UPDATE promos SET is_active = ?, updated_at = ? WHERE slug = ?`
      ).bind(isActive, toSqliteDate(), PROMO_SLUG).run();
      await audit(context, auth, "promo.toggle", "promo", PROMO_SLUG, {
        promo: PROMO_SLUG,
        is_active: isActive,
      });
      return json({
        ok: true,
        message: isActive ? "Promotion switched on." : "Promotion switched off.",
        is_active: isActive,
      });
    }

    if (action === "revoke") {
      const claimId = String(body.claim_id || "");
      if (!claimId) {
        return json({ ok: false, message: "claim_id is required." }, 400);
      }
      const result = await db.prepare(
        `UPDATE promo_claims SET status = 'revoked' WHERE id = ? AND promo_slug = ? AND status = 'active'`
      ).bind(claimId, PROMO_SLUG).run();
      const changed = result && result.meta ? Number(result.meta.changes || 0) : 0;
      if (!changed) {
        return json({ ok: false, message: "Claim not found or not active." }, 404);
      }
      await audit(context, auth, "promo.revoke", "promo_claim", claimId, {
        promo: PROMO_SLUG,
        claim_id: claimId,
      });
      return json({ ok: true, message: "Claim revoked." });
    }

    return json({ ok: false, message: "Unknown action." }, 400);
  } catch (error) {
    return json({ ok: false, message: "Could not update the promotion.", error: String(error) }, 500);
  }
}
