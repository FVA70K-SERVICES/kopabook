// POST /api/businesses/switch — change the active business for this session.
// Body: { businessId }. The user must be a member of that business.
import { json, getAuthContext, requireAuth } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const businessId = Number(body.businessId);
    if (!businessId) return json({ ok: false, message: "businessId is required." }, 400);

    const member = await context.env.KOPABOOK_DB.prepare(
      `SELECT m.role, b.name, b.status FROM business_members m
       JOIN businesses b ON b.id = m.business_id
       WHERE m.user_id = ? AND m.business_id = ? LIMIT 1`
    ).bind(auth.user.id, businessId).first();
    if (!member) return json({ ok: false, message: "You are not a member of that business." }, 403);
    if (member.status === "closed") {
      return json({ ok: false, message: "That business is closed. Reopen it first." }, 403);
    }

    const token = (context.request.headers.get("cookie") || "").match(/kopabook_session=([^;]+)/)?.[1];
    if (!token) return json({ ok: false, message: "No active session." }, 401);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE sessions SET business_id = ? WHERE session_token = ?`
    ).bind(businessId, token).run();

    return json({ ok: true, business: { id: businessId, name: member.name, role: member.role } });
  } catch (error) {
    return json({ ok: false, message: "Could not switch business.", error: String(error) }, 500);
  }
}
