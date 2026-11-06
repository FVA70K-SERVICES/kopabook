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
    if (auth.business.role !== "owner" && auth.business.role !== "partner") {
      return json({ ok: false, message: "Only the owner or a partner can change business settings." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];
    for (const [key, col] of [["name", "name"], ["businessType", "business_type"], ["customType", "custom_type"], ["state", "state"], ["city", "city"], ["country", "country"], ["timezone", "timezone"], ["currency", "currency"], ["brandColor", "brand_color"], ["tagline", "tagline"], ["reminderTemplate", "reminder_template"], ["receiptPhone", "receipt_phone"], ["receiptAddress", "receipt_address"], ["receiptFooter", "receipt_footer"], ["receiptPaperWidth", "receipt_paper_width"]]) {
      if (body[key] !== undefined) { fields.push(`${col} = ?`); params.push(String(body[key]).trim() || null); }
    }
    // WORLD-BEST (Dashboard stream): business rules (migration 0061).
    // Numbers are validated and clamped; a non-number is refused.
    // low_stock_default: default low-stock threshold for new products.
    // overdue_days: days after which a debt counts as overdue.
    if (body.lowStockDefault !== undefined) {
      const v = Number(body.lowStockDefault);
      if (!Number.isFinite(v) || v < 0 || v > 1000) {
        return json({ ok: false, message: "Low-stock threshold must be a number from 0 to 1000." }, 400);
      }
      fields.push("low_stock_default = ?"); params.push(Math.floor(v));
    }
    if (body.overdueDays !== undefined) {
      const v = Number(body.overdueDays);
      if (!Number.isFinite(v) || v < 1 || v > 365) {
        return json({ ok: false, message: "Overdue days must be a number from 1 to 365." }, 400);
      }
      fields.push("overdue_days = ?"); params.push(Math.floor(v));
    }
    // WORLD-BEST (merge): receipt settings (migration 0061). The Receipt
    // stream read these columns but had no UI to set them; the Settings
    // Receipt section saves them here. Email/Telegram are plain text;
    // show flags are 0/1 integers; the language must be one of the 10
    // app languages (same list as src/lib/i18n.js LANGUAGES).
    if (body.receiptEmail !== undefined) {
      fields.push("receipt_email = ?"); params.push(String(body.receiptEmail).trim() || null);
    }
    if (body.receiptTelegram !== undefined) {
      fields.push("receipt_telegram = ?"); params.push(String(body.receiptTelegram).trim() || null);
    }
    for (const [key, col] of [["receiptShowPhone", "receipt_show_phone"], ["receiptShowEmail", "receipt_show_email"], ["receiptShowTelegram", "receipt_show_telegram"]]) {
      if (body[key] !== undefined) {
        const v = Number(body[key]);
        if (v !== 0 && v !== 1) return json({ ok: false, message: "Receipt show flags must be 0 or 1." }, 400);
        fields.push(`${col} = ?`); params.push(v);
      }
    }
    if (body.receiptLanguage !== undefined) {
      const lang = String(body.receiptLanguage).trim();
      if (!["en", "pcm", "ha", "yo", "ig", "fr", "es", "pt", "ar", "sw"].includes(lang)) {
        return json({ ok: false, message: "Receipt language is not supported." }, 400);
      }
      fields.push("receipt_language = ?"); params.push(lang);
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
