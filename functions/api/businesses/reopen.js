// POST /api/businesses/reopen — reopen a closed business (true owner only).
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const businessId = Number(body.businessId);
    if (!businessId) return json({ ok: false, message: "businessId is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const membership = await db.prepare(
      `SELECT role FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`
    ).bind(businessId, auth.user.id).first();
    if (!membership) return json({ ok: false, message: "Business not found." }, 404);
    if (membership.role !== "owner") {
      return json({ ok: false, message: "Only the business owner can reopen it." }, 403);
    }

    await db.prepare(`UPDATE businesses SET status = 'active' WHERE id = ?`).bind(businessId).run();

    await audit(context, auth, "business.reopen", "business", businessId, {});
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not reopen business.", error: String(error) }, 500);
  }
}
