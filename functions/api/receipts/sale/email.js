// POST /api/receipts/sale/email — send one receipt by email.
// Server route (professional): HTML + plain-text receipt via the existing
// Zoho sendMail helper. One email per tap, no bulk. Per-business daily
// cap 100. When mail is not configured the endpoint returns 501 with the
// helper's clear error and the UI falls back to a mailto: link.
import { json, getAuthContext, requireAuth } from "../../_utils.js";
import { sendMail, receiptEmail } from "../../_mail.js";
import {
  requireCanRecordSales, loadSaleForReceipt, checkDailyCap, recordSend,
  auditReceiptSend, formatMoney, round2, isEmailShape, dueDateISO,
} from "../../_receipts.js";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const roleDenied = requireCanRecordSales(auth);
    if (roleDenied) return roleDenied;

    const body = await context.request.json().catch(() => ({}));
    const saleId = Number(body.saleId || body.sale_id);
    const email = String(body.email || "").trim();
    if (!saleId) return json({ ok: false, message: "Sale id is required." }, 400);
    if (!email) return json({ ok: false, message: "Customer email is required." }, 400);
    if (!isEmailShape(email)) return json({ ok: false, message: "Enter a valid email address." }, 400);

    const db = context.env.KOPABOOK_DB;
    const data = await loadSaleForReceipt(db, auth.business.id, saleId);
    if (!data) return json({ ok: false, message: "Sale not found." }, 404);
    const { sale, items, payments, business, customer } = data;

    // Config gate first: when mail is not set up the UI falls back to
    // mailto, and an unconfigured send must not eat the daily cap.
    if (!context.env.ZOHO_CLIENT_ID || !context.env.ZOHO_CLIENT_SECRET
      || !context.env.ZOHO_REFRESH_TOKEN || !context.env.MAIL_FROM) {
      return json({ ok: false, message: "Email is not configured yet (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / MAIL_FROM).", notConfigured: true }, 501);
    }
    const capDenied = await checkDailyCap(db, auth.business.id, "email");
    if (capDenied) return capDenied;

    const currency = business.currency || auth.business.currency || "NGN";
    const paidByMethod = (payments.length ? payments : [{ amount: sale.amount_paid, mode: sale.payment_method }])
      .map((p) => ({ mode: p.mode || "Cash", amount: round2(p.amount) }));
    const dueDate = Number(sale.balance_due) > 0
      ? dueDateISO(sale.created_at, business.overdue_days ?? 7) : null;
    const mail = receiptEmail({
      businessName: business.name || "My Business",
      saleNumber: sale.sale_number,
      date: String(sale.created_at || "").slice(0, 16).replace("T", " "),
      items: items.map((it) => ({
        name: it.product_name || "Item",
        qty: Number(it.quantity || 0),
        unit: it.product_unit || "",
        unitPrice: formatMoney(it.unit_price, currency),
        lineTotal: formatMoney(it.line_total, currency),
      })),
      subtotal: formatMoney(sale.subtotal ?? sale.total_amount, currency),
      discount: Number(sale.discount_amount || 0) > 0 ? formatMoney(sale.discount_amount, currency) : "",
      total: formatMoney(sale.total_amount, currency),
      paidByMethod: paidByMethod.map((p) => ({ mode: p.mode, amount: formatMoney(p.amount, currency) })),
      change: Number(sale.change_given || 0) > 0 ? formatMoney(sale.change_given, currency) : "",
      balanceDue: Number(sale.balance_due || 0) > 0 ? formatMoney(sale.balance_due, currency) : "",
      dueDate,
      footer: business.receipt_footer || "",
    });

    try {
      await sendMail(context.env, { to: email, subject: mail.subject, html: mail.html, text: mail.text });
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/not configured/i.test(msg)) {
        return json({ ok: false, message: msg, notConfigured: true }, 501);
      }
      return json({ ok: false, message: "Could not send the email. " + msg.slice(0, 200) }, 502);
    }

    await recordSend(db, auth.business.id, "email", saleId);
    await auditReceiptSend(context, auth, "email", saleId, { to: email, customer: customer.name || null });
    return json({ ok: true, via: "server" });
  } catch (error) {
    return json({ ok: false, message: "Could not send receipt email.", error: String(error) }, 500);
  }
}
