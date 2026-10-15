// /api/business — GET profile, PATCH update (owner only)
import { json, getAuthContext, requireAuth, audit } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const biz = await context.env.KOPABOOK_DB.prepare(
      `SELECT * FROM businesses WHERE id = ? LIMIT 1`
    ).bind(auth.business.id).first();

    return json({ ok: true, business: biz });
  } catch (error) {
    return json({ ok: false, message: "Could not load business.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can change business settings." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];
    for (const [key, col] of [["name", "name"], ["businessType", "business_type"], ["state", "state"], ["city", "city"], ["currency", "currency"], ["brandColor", "brand_color"], ["tagline", "tagline"], ["reminderTemplate", "reminder_template"], ["receiptPhone", "receipt_phone"], ["receiptAddress", "receipt_address"], ["receiptFooter", "receipt_footer"], ["receiptPaperWidth", "receipt_paper_width"]]) {
      if (body[key] !== undefined) { fields.push(`${col} = ?`); params.push(String(body[key]).trim() || null); }
    }
    if (fields.length === 0) return json({ ok: false, message: "Nothing to update." }, 400);

    params.push(auth.business.id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE businesses SET ${fields.join(", ")} WHERE id = ?`
    ).bind(...params).run();

    await audit(context, auth, "business.update", "business", auth.business.id, body);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update business.", error: String(error) }, 500);
  }
}
