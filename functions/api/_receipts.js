// Shared helpers for the receipt send endpoints (email + Telegram bot).
// Not a route: underscore-prefixed, like _mail.js / _utils.js.
import { json, audit } from "./_utils.js";

export const RECEIPT_DAILY_CAP = 100;

// Roles that can record a sale in a business (modulesForRole in
// src/lib/businessTypes.js: owner/partner have every module; manager,
// cashier and attendant have the sales module). Accountant, storekeeper
// and hotel roles have no sales module, so they cannot send receipts.
// NOTE: POST /api/sales itself only checks requireAuth today, so this
// gate is stricter than the sale endpoint on purpose: a receipt send is
// an outbound message, not just a record.
export const SALES_ROLES = ["owner", "partner", "manager", "cashier", "attendant"];

export function canRecordSales(auth) {
  return !!auth && !!auth.business && SALES_ROLES.includes(auth.business.role);
}

export function requireCanRecordSales(auth) {
  if (!canRecordSales(auth)) {
    return json({ ok: false, message: "Only staff who can record sales can send receipts." }, 403);
  }
  return null;
}

const CURRENCY_SYMBOLS = {
  NGN: "₦", GHS: "₵", USD: "$", EUR: "€", GBP: "£", KES: "KSh ", UGX: "USh ",
  TZS: "TSh ", ZAR: "R ", INR: "₹", PHP: "₱", CNY: "¥", JPY: "¥", AED: "د.إ ",
};

export function formatMoney(n, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "NGN";
  const sym = CURRENCY_SYMBOLS[code] || (code + " ");
  return sym + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Loose email shape check (mirrors src/lib/receiptContacts.js — kept in
// sync by hand so server code never imports out of functions/).
export function isEmailShape(email) {
  const v = String(email || "").trim();
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Due date for an invoice view: sale date + overdue_days (default 7).
export function dueDateISO(saleDate, overdueDays) {
  if (!saleDate) return "";
  const days = Number(overdueDays) > 0 ? Number(overdueDays) : 7;
  const d = new Date(saleDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Plain-text receipt, the same figures as the WhatsApp text, the share
// card and the printed receipt. Amounts here are NUMBERS; callers format
// them with formatMoney first when building display strings.
export function buildReceiptPlain({ businessName, saleNumber, date, items, subtotal, discount, total, paidByMethod, change, balanceDue, dueDate, footer, currency }) {
  const m = (n) => formatMoney(n, currency);
  const lines = [];
  if (businessName) lines.push(businessName);
  lines.push(saleNumber ? `Receipt ${saleNumber}` : "Receipt");
  if (date) lines.push(String(date).slice(0, 16).replace("T", " "));
  if (Array.isArray(items) && items.length) {
    lines.push("");
    for (const it of items) {
      const qty = Number(it.quantity ?? it.qty ?? 0);
      const name = it.product_name || it.name || "Item";
      const unit = it.product_unit || it.unit ? ` ${it.product_unit || it.unit}` : "";
      lines.push(`${qty}${unit} x ${name} - ${m(it.unit_price)} = ${m(it.line_total ?? qty * Number(it.unit_price || 0))}`);
    }
  }
  lines.push("");
  if (subtotal !== undefined && Number(subtotal) !== Number(total)) lines.push(`Subtotal: ${m(subtotal)}`);
  if (Number(discount) > 0) lines.push(`Discount: ${m(discount)}`);
  lines.push(`Total: ${m(total)}`);
  if (Array.isArray(paidByMethod) && paidByMethod.length) {
    for (const p of paidByMethod) lines.push(`Paid (${p.mode || "Cash"}): ${m(p.amount)}`);
  }
  if (Number(change) > 0) lines.push(`Change given: ${m(change)}`);
  if (Number(balanceDue) > 0) {
    lines.push(`Balance due: ${m(balanceDue)}`);
    if (dueDate) lines.push(`Due date: ${dueDate}`);
    lines.push("Please pay the balance soon. Thank you.");
  } else {
    lines.push("Paid in full. Thank you for buying from us.");
  }
  if (footer) { lines.push(""); lines.push(String(footer)); }
  lines.push("Powered by KopaBook");
  return lines.join("\n");
}

// Load a sale with its items, payments, business and customer, scoped to
// the caller's business. Returns null when the sale is not in this business.
// Tolerates a database where migration 0061 has not run yet (new customer
// columns missing) by falling back to the old column list.
export async function loadSaleForReceipt(db, businessId, saleId) {
  let sale = null;
  try {
    sale = await db.prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email, c.telegram AS customer_telegram,
              c.telegram_chat_id AS customer_telegram_chat_id
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.business_id = ?`
    ).bind(saleId, businessId).first();
  } catch (e) {
    if (!/no such column/i.test(String(e && e.message))) throw e;
    sale = await db.prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.business_id = ?`
    ).bind(saleId, businessId).first();
  }
  if (!sale) return null;
  let items;
  try {
    items = await db.prepare(
      `SELECT si.quantity, si.unit_price, si.line_total, p.name AS product_name, p.unit AS product_unit
       FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? ORDER BY si.id ASC`
    ).bind(saleId).all();
  } catch (e) {
    if (!/no such column: p\.unit/i.test(String(e && e.message))) throw e;
    items = await db.prepare(
      `SELECT si.quantity, si.unit_price, si.line_total, p.name AS product_name
       FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? ORDER BY si.id ASC`
    ).bind(saleId).all();
  }
  const payments = await db.prepare(
    `SELECT amount, payment_method AS mode, created_at FROM payment_records
     WHERE sale_id = ? ORDER BY id ASC`
  ).bind(saleId).all().catch(() => ({ results: [] }));
  const business = await db.prepare(
    `SELECT * FROM businesses WHERE id = ?`
  ).bind(businessId).first();
  return {
    sale,
    items: items.results || [],
    payments: payments.results || [],
    business: business || {},
    customer: {
      id: sale.customer_id || null,
      name: sale.customer_name || null,
      phone: sale.customer_phone || null,
      email: sale.customer_email || null,
      telegram: sale.customer_telegram || null,
      telegramChatId: sale.customer_telegram_chat_id || null,
    },
  };
}

export async function countSendsToday(db, businessId, channel) {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM receipt_sends
       WHERE business_id = ? AND channel = ? AND date(created_at) = date('now')`
    ).bind(businessId, channel).first();
    return Number(row?.n || 0);
  } catch {
    // receipt_sends table not created yet (migration 0061 not applied):
    // do not block the send, the audit below will also fail soft.
    return 0;
  }
}

// Returns a 429 JSON response when the cap is hit, else null.
export async function checkDailyCap(db, businessId, channel) {
  const n = await countSendsToday(db, businessId, channel);
  if (n >= RECEIPT_DAILY_CAP) {
    return json({
      ok: false,
      message: `Daily limit reached: ${RECEIPT_DAILY_CAP} receipt ${channel === "email" ? "emails" : "Telegram messages"} per business per day. Try again tomorrow.`,
    }, 429);
  }
  return null;
}

export async function recordSend(db, businessId, channel, saleId) {
  try {
    await db.prepare(
      `INSERT INTO receipt_sends (business_id, channel, sale_id) VALUES (?, ?, ?)`
    ).bind(businessId, channel, saleId || null).run();
  } catch {
    // Never block a completed send on the log write.
  }
}

export async function auditReceiptSend(context, auth, channel, saleId, extra) {
  await audit(context, auth, `receipt.${channel}`, "sale", saleId, extra || {});
}

// Telegram Bot API helpers. The token never leaves the server.
export function telegramBotConfigured(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

export async function getBotUsername(env) {
  if (env.TELEGRAM_BOT_USERNAME) return String(env.TELEGRAM_BOT_USERNAME).replace(/^@/, "");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.result?.username) {
    throw new Error(`Telegram getMe failed (${res.status}).`);
  }
  return data.result.username;
}

export function telegramStartUrl(username, saleRef) {
  return `https://t.me/${String(username).replace(/^@/, "")}?start=${encodeURIComponent(String(saleRef || ""))}`;
}

async function telegramCall(env, method, body, isForm = false) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    ...(isForm ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(`Telegram ${method} failed (${res.status}): ${String(data?.description || "")}`.slice(0, 200));
  }
  return data;
}

export async function telegramSendMessage(env, chatId, text) {
  return telegramCall(env, "sendMessage", { chat_id: chatId, text });
}

export async function telegramSendPhoto(env, chatId, photoBlob, caption) {
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("photo", photoBlob, "receipt.png");
  if (caption) fd.append("caption", caption);
  return telegramCall(env, "sendPhoto", fd, true);
}
