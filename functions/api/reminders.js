// /api/reminders — GET recent reminder log, POST log a sent reminder.
// Reminders are sent by the merchant through WhatsApp (wa.me links); this API
// only records what was sent so the app knows who is due for a nudge.
import { json, getAuthContext, requireAuth, audit } from "./_utils";
import { getBusinessOwnerTier } from "./billing";

// Tier gate: paid feature, business-scoped (staff act under the owner's plan).
async function requireFeatureTier(db, businessId) {
  const { tier } = await getBusinessOwnerTier(db, businessId);
  if (!["pro", "solo", "starter"].includes(tier)) {
    return json({ ok: false, upgradeRequired: true, message: "WhatsApp debt reminders are a Starter feature. Upgrade to use it." }, 403);
  }
  return null;
}


export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const logs = await context.env.KOPABOOK_DB.prepare(
      `SELECT r.*, c.name AS customer_name, u.full_name AS staff_name
       FROM reminder_logs r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.business_id = ?
       ORDER BY r.id DESC LIMIT 50`
    )
      .bind(auth.business.id)
      .all();
    return json({ ok: true, logs: logs.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load reminders.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const body = await context.request.json().catch(() => ({}));
    const kind = ["debt", "broadcast", "staff"].includes(body.kind) ? body.kind : "debt";
    const customerId = body.customerId ? Number(body.customerId) : null;
    const userId = body.userId ? Number(body.userId) : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const message = body.message ? String(body.message).slice(0, 2000) : null;
    if (!message) return json({ ok: false, message: "Message text is required." }, 400);

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO reminder_logs (business_id, kind, customer_id, user_id, phone, message, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, kind, customerId, userId, phone, message, auth.user.id)
      .run();

    await audit(context, auth, "reminder.log", "reminder_log", null, { kind, customerId, userId });
    return json({ ok: true }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not log reminder.", error: String(error) }, 500);
  }
}
