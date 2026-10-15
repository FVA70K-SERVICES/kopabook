// Free-tier WhatsApp helpers for KopaBook.
// No paid APIs: everything opens a wa.me link the merchant sends themselves.

// Convert Nigerian phone formats (080..., +234..., 234...) to 234XXXXXXXXXX digits.
export function normalizeNaijaPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("234") && digits.length >= 11) return digits.slice(0, 13);
  if (digits.startsWith("0") && digits.length === 11) return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits; // local number without leading 0
  return digits;
}

// Build a WhatsApp share/send link. With an empty phone it opens the contact
// picker instead, which is a fine fallback for merchants who type a number late.
export function waLink(phone, text) {
  const digits = normalizeNaijaPhone(phone);
  const q = "?text=" + encodeURIComponent(text || "");
  return digits ? `https://wa.me/${digits}${q}` : `https://wa.me/${q}`;
}

// Plain-text sale receipt. Pass amounts pre-formatted with fmt() from api.js.
// items is optional: [{ qty, name, unitPrice }] (unitPrice pre-formatted too).
export function receiptText({ saleNumber, total, items, businessName, balanceDue }) {
  const lines = [];
  if (businessName) lines.push(businessName);
  lines.push(saleNumber ? `Receipt ${saleNumber}` : "Receipt");
  if (Array.isArray(items) && items.length) {
    lines.push("");
    for (const it of items) lines.push(`${it.qty} x ${it.name} - ${it.unitPrice}`);
  }
  lines.push("");
  lines.push(`Total: ${total}`);
  if (balanceDue) {
    lines.push(`Balance due: ${balanceDue}`);
    lines.push("Please pay the balance soon. Thank you.");
  } else {
    lines.push("Paid in full. Thank you for buying from us.");
  }
  return lines.join("\n");
}

// Polite debt reminder. Amount should be pre-formatted with fmt() from api.js.
export function debtReminderText({ debtorName, amount, businessName }) {
  const from = businessName ? ` from ${businessName}` : "";
  return (
    `Hello ${debtorName}, this is a friendly reminder${from}. ` +
    `Your outstanding balance is ${amount}. ` +
    `Please pay at your earliest convenience. Thank you.`
  );
}

// Fill a custom reminder template. Placeholders: {name}, {amount}, {business}.
// Falls back to debtReminderText when the template is empty.
export function fillReminderTemplate(template, { debtorName, amount, businessName }) {
  const t = String(template || "").trim();
  if (!t) return debtReminderText({ debtorName, amount, businessName });
  return t
    .replace(/\{name\}/g, debtorName || "valued customer")
    .replace(/\{amount\}/g, amount || "")
    .replace(/\{business\}/g, businessName || "us");
}
