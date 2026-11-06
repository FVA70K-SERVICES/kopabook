// POST /api/receipts/sale/telegram — bot delivery of one receipt.
// Text first (sendMessage), then the card image (sendPhoto) when the
// caller supplies a PNG in multipart FormData. If the photo fails the
// text still goes and the failure is reported plainly. One receipt per
// tap, per-business daily cap 100. Gated on TELEGRAM_BOT_TOKEN (501 when
// not set) and on the customer having started the bot (their chat id must
// be stored; a username alone is not enough).
import { json, getAuthContext, requireAuth } from "../../_utils.js";
import {
  requireCanRecordSales, loadSaleForReceipt, checkDailyCap, recordSend,
  auditReceiptSend, buildReceiptPlain, telegramBotConfigured, getBotUsername,
  telegramStartUrl, telegramSendMessage, telegramSendPhoto, round2, dueDateISO,
} from "../../_receipts.js";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const roleDenied = requireCanRecordSales(auth);
    if (roleDenied) return roleDenied;

    const contentType = String(context.request.headers.get("content-type") || "");
    let saleId = 0;
    let photo = null;
    if (contentType.includes("multipart/form-data")) {
      const fd = await context.request.formData().catch(() => null);
      saleId = Number(fd?.get("saleId") || fd?.get("sale_id") || 0);
      const file = fd?.get("photo");
      if (file && typeof file.arrayBuffer === "function" && file.size > 0) photo = file;
    } else {
      const body = await context.request.json().catch(() => ({}));
      saleId = Number(body.saleId || body.sale_id || 0);
    }
    if (!saleId) return json({ ok: false, message: "Sale id is required." }, 400);

    if (!telegramBotConfigured(context.env)) {
      return json({ ok: false, message: "Telegram bot is not set up yet. Ask the owner to add the bot token.", notConfigured: true }, 501);
    }

    const db = context.env.KOPABOOK_DB;
    const data = await loadSaleForReceipt(db, auth.business.id, saleId);
    if (!data) return json({ ok: false, message: "Sale not found." }, 404);
    const { sale, items, payments, business, customer } = data;

    const chatId = customer.telegramChatId;
    if (!chatId) {
      let username = null;
      try { username = await getBotUsername(context.env); } catch { username = null; }
      return json({
        ok: false,
        needsOnboarding: true,
        startUrl: username ? telegramStartUrl(username, sale.sale_number) : null,
        message: username
          ? `The customer has not started @${username} on Telegram yet. Ask them to start the bot, then tap send.`
          : "The customer has not started the Telegram bot yet.",
      }, 200);
    }

    const capDenied = await checkDailyCap(db, auth.business.id, "telegram");
    if (capDenied) return capDenied;

    const currency = business.currency || auth.business.currency || "NGN";
    const paidByMethod = (payments.length ? payments : [{ amount: sale.amount_paid, mode: sale.payment_method }])
      .map((p) => ({ mode: p.mode || "Cash", amount: round2(p.amount) }));
    const dueDate = Number(sale.balance_due) > 0
      ? dueDateISO(sale.created_at, business.overdue_days ?? 7) : null;
    // Amounts are numbers here; buildReceiptPlain formats them.
    const plainText = buildReceiptPlain({
      businessName: business.name || "My Business",
      saleNumber: sale.sale_number,
      date: String(sale.created_at || "").slice(0, 16).replace("T", " "),
      items: items.map((it) => ({
        product_name: it.product_name || "Item",
        quantity: Number(it.quantity || 0),
        product_unit: it.product_unit || "",
        unit_price: Number(it.unit_price || 0),
        line_total: Number(it.line_total || 0),
      })),
      subtotal: Number(sale.subtotal ?? sale.total_amount),
      discount: Number(sale.discount_amount || 0),
      total: Number(sale.total_amount),
      paidByMethod,
      change: Number(sale.change_given || 0),
      balanceDue: Number(sale.balance_due || 0),
      dueDate,
      footer: business.receipt_footer || "",
      currency,
    });

    await telegramSendMessage(context.env, chatId, plainText);

    let photoError = null;
    if (photo) {
      try {
        await telegramSendPhoto(context.env, chatId, photo, `Receipt ${sale.sale_number}`);
      } catch (e) {
        photoError = "Receipt text sent, but the card image could not be sent. " + String(e && e.message || e).slice(0, 150);
      }
    }

    await recordSend(db, auth.business.id, "telegram", saleId);
    await auditReceiptSend(context, auth, "telegram", saleId, { customer: customer.name || null, photoError: photoError || undefined });
    return json({ ok: true, via: "bot", photoError });
  } catch (error) {
    return json({ ok: false, message: "Could not send receipt on Telegram.", error: String(error) }, 500);
  }
}
