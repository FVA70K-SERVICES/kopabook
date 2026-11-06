// Pure helpers for receipt contact fields (Sales done view, Receipt page).
// No DOM, no network — tests assert the rules here.
//
// Save rule: a contact filled in on the receipt screen is saved to the
// picked customer ONLY when that field was blank on the customer before.
// It never overwrites an existing contact. For a walk-in (no customer) the
// value is used for this receipt only and creates no customer.

// True when the value may be saved: the field was blank before and the
// merchant typed something now.
export function shouldSaveContactField(wasBlank, value) {
  return Boolean(wasBlank) && String(value || "").trim().length > 0;
}

// Given the blank-before flags and the current field values, return the
// PATCH body for the picked customer (empty object = nothing to save).
// wasBlank: { phone, email, telegram }; values: { phone, email, telegram }.
export function contactSavePatch(wasBlank = {}, values = {}) {
  const patch = {};
  for (const key of ["phone", "email", "telegram"]) {
    if (shouldSaveContactField(wasBlank[key], values[key])) patch[key] = String(values[key]).trim();
  }
  return patch;
}

// Loose email shape check: catches a grossly invalid value, never blocks
// a sale. Empty is fine (the field is optional).
export function isEmailShape(email) {
  const v = String(email || "").trim();
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Business contact lines for a receipt, owner-chosen channels only.
// business: { receipt_phone, receipt_email, receipt_telegram,
//             receipt_show_phone/email/telegram (1/0; missing = show) }.
export function buildContactLines(business = {}) {
  const show = (flag) => flag === undefined || flag === null || Number(flag) === 1;
  const lines = [];
  if (show(business.receipt_show_phone) && business.receipt_phone) lines.push(`Tel: ${business.receipt_phone}`);
  if (show(business.receipt_show_email) && business.receipt_email) lines.push(String(business.receipt_email));
  if (show(business.receipt_show_telegram) && business.receipt_telegram) {
    const h = String(business.receipt_telegram).trim();
    lines.push(h.startsWith("@") ? `Telegram: ${h}` : `Telegram: @${h}`);
  }
  return lines;
}

// Due date for an invoice view: sale date + overdue_days (default 7).
// Returns YYYY-MM-DD, or "" when the sale date is missing.
export function dueDateISO(saleDate, overdueDays) {
  if (!saleDate) return "";
  const days = Number(overdueDays) > 0 ? Number(overdueDays) : 7;
  const d = new Date(saleDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// mailto: fallback for email receipts. Body is capped at the item list +
// totals the caller passes in; long bodies are cut at 2000 chars because
// some mail apps drop the rest.
export function receiptMailtoLink(email, saleNumber, businessName, text) {
  const subject = `Receipt ${saleNumber || ""}${businessName ? ` — ${businessName}` : ""}`.trim();
  const body = String(text || "").slice(0, 2000);
  return `mailto:${encodeURIComponent(String(email || "").trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
