// POST /api/businesses/close — soft-close a business (true owner only).
// Records are kept; the business leaves the switcher and sign-in picks
// another active business. Reopen with /api/businesses/reopen.
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const businessId = Number(body.businessId) || auth.business.id;

    const db = context.env.KOPABOOK_DB;
    const membership = await db.prepare(
      `SELECT role FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    ).bind(businessId, auth.user.id).first();
    if (!membership) return json({ ok: false, message: "Business not found." }, 404);
    if (membership.role !== "owner") {
      return json({ ok: false, message: "Only the business owner can close it." }, 403);
    }

    await db.prepare(`UPDATE businesses SET status = 'closed' WHERE id = ?`).bind(businessId).run();

    // Move the session to another active business, if one exists.
    const next = await db.prepare(
      `SELECT business_id FROM business_members
       INNER JOIN businesses ON businesses.id = business_members.business_id
       WHERE business_members.user_id = ? AND businesses.id != ?
         AND (businesses.status IS NULL OR businesses.status = 'active')
       ORDER BY business_members.id ASC LIMIT 1`
    ).bind(auth.user.id, businessId).first();
    const token = (context.request.headers.get("cookie") || "").match(/kopabook_session=([^;]+)/);
    if (token) {
      await db.prepare(`UPDATE sessions SET business_id = ? WHERE session_token = ?`)
        .bind(next ? next.business_id : null, token[1]).run();
    }

    await audit(context, auth, "business.close", "business", businessId, {});
    return json({ ok: true, activeBusinessId: next ? next.business_id : null });
  } catch (error) {
    return json({ ok: false, message: "Could not close business.", error: String(error) }, 500);
  }
}
