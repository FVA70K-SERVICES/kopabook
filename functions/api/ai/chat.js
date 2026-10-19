// POST /api/ai/chat: Kopa, the KopaBook business assistant (Workers AI).
//
// One live chatbot that answers EVERYTHING about the business from real,
// live store data. The LLM never writes SQL and never invents numbers: every
// request injects a rich business snapshot (all queries parameterized, every
// one filtered by business_id from the authenticated session).
//
// On Solo/Pro the assistant is also agentic: when the user asks it to DO
// something, the model emits an ACTION line, the backend validates and
// executes it against the real tables, then confirms with real numbers.
//
// Tiered AI for every plan. Free: 5 questions/day, read-only. Starter: 20/day,
// read + record_sale/add_expense (10 actions/day). Solo: 50/day, all tools.
// Pro: 100/day, all tools. 60/hr rate limit on top.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "../_utils";
import { getBusinessOwnerTier, LIMITS } from "../billing";
import { checkRateLimit } from "../_webhook_security";

const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const HISTORY_LIMIT = 6;

// Per-tier AI allowances. tools: [] = read-only answers; "all" = every tool.
// actionsPerDay: null = unlimited actions within the question cap.
const AI_TIER_LIMITS = {
  free:    { questionsPerDay: 5,   tools: [], actionsPerDay: 0 },
  starter: { questionsPerDay: 20,  tools: ["record_sale", "add_expense", "draft_debtor_message"], actionsPerDay: 10 },
  solo:    { questionsPerDay: 50,  tools: "all", actionsPerDay: null },
  pro:     { questionsPerDay: 100, tools: "all", actionsPerDay: null },
};
const ALL_TOOLS = ["record_sale", "add_expense", "add_product", "record_customer_payment", "set_reminder", "get_customer_balance", "draft_debtor_message", "send_debtor_message"];
const UPGRADE_NUDGE = "Upgrade to Starter for AI actions, or Solo/Pro for the full AI assistant.";

function tierAllowsTool(tier, tool) {
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  if (cfg.tools === "all") return true;
  return cfg.tools.includes(tool);
}

function allowedToolsForTier(tier) {
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  return cfg.tools === "all" ? ALL_TOOLS : cfg.tools;
}

// Roles that may use every AI tool. Everyone else (shop staff) may only
// record sales and check customer balances.
const PRIVILEGED_ROLES = ["owner", "partner", "admin"];
const STAFF_TOOLS = ["record_sale", "get_customer_balance"];

function fmt(n, currency) {
  const v = Number(n || 0);
  return (currency || "NGN") + " " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function isPrivileged(auth) {
  return PRIVILEGED_ROLES.includes(auth.business && auth.business.role);
}

function toolAllowed(auth, tool) {
  if (isPrivileged(auth)) return true;
  return STAFF_TOOLS.includes(tool);
}

// ---------------------------------------------------------------------------
// Rich business snapshot. One bad query must never kill the whole answer, so
// each section is wrapped in its own try/catch. Every query binds business_id
// from auth, never from user input.
// ---------------------------------------------------------------------------
async function buildSnapshot(db, auth) {
  const businessId = auth.business.id;
  const currency = auth.business.currency || "NGN";
  const snap = {};
  const q = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      return fallback;
    }
  };

  snap.businessName = auth.business.name || "Your business";
  snap.businessType = auth.business.business_type || "general";
  snap.tier = (await q(async () => (await getBusinessOwnerTier(db, businessId)).tier, "free")) || "free";

  snap.products = await q(async () => {
    let rows;
    try {
      rows = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.business_id = ? AND s.created_at >= date('now', '-30 days')), 0) AS sold_30d
         FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.business_id = ? AND p.is_active = 1
         ORDER BY sold_30d DESC, p.name ASC LIMIT 50`
      ).bind(businessId, businessId).all();
    } catch (e) {
      if (!/no such column: unit/i.test(String(e && e.message))) throw e;
      rows = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, COALESCE(ii.quantity_on_hand, 0) AS stock,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.business_id = ? AND s.created_at >= date('now', '-30 days')), 0) AS sold_30d
         FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.business_id = ? AND p.is_active = 1
         ORDER BY sold_30d DESC, p.name ASC LIMIT 50`
      ).bind(businessId, businessId).all();
    }
    return (rows.results || []).map((p) => ({
      name: p.name,
      price: Number(p.unit_price || 0),
      unit: p.unit || "piece",
      stock: Number(p.stock || 0),
    }));
  }, []);

  const today = await q(async () => await db.prepare(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND date(created_at) = date('now')`
  ).bind(businessId).first(), null);
  snap.salesToday = { total: Number(today && today.total) || 0, count: Number(today && today.cnt) || 0 };

  const month = await q(async () => await db.prepare(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`
  ).bind(businessId).first(), null);
  snap.salesMonth = { total: Number(month && month.total) || 0, count: Number(month && month.cnt) || 0 };

  const exp = await q(async () => await db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses WHERE business_id = ? AND strftime('%Y-%m', incurred_on) = strftime('%Y-%m','now')`
  ).bind(businessId).first(), null);
  snap.expensesMonth = { total: Number(exp && exp.total) || 0, count: Number(exp && exp.cnt) || 0 };

  snap.debtors = await q(async () => {
    const rs = await db.prepare(
      `SELECT c.name, COALESCE((SELECT balance_after FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS bal
       FROM customers c WHERE c.business_id = ? ORDER BY bal DESC LIMIT 20`
    ).bind(businessId).all();
    return (rs.results || [])
      .map((r) => ({ name: r.name, balance: Number(r.bal) || 0 }))
      .filter((r) => r.balance > 0);
  }, []);

  snap.lowStock = await q(async () => {
    let rs;
    try {
      rs = await db.prepare(
        `SELECT p.name, p.unit, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p
         LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold LIMIT 10`
      ).bind(businessId).all();
    } catch (e) {
      if (!/no such column: unit/i.test(String(e && e.message))) throw e;
      rs = await db.prepare(
        `SELECT p.name, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p
         LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold LIMIT 10`
      ).bind(businessId).all();
    }
    return (rs.results || []).map((p) => ({ name: p.name, unit: p.unit || "piece", qty: Number(p.qty) || 0 }));
  }, []);

  snap.recentSales = await q(async () => {
    const rs = await db.prepare(
      `SELECT s.sale_number, COALESCE(c.name, 'Walk-in') AS customer, s.total_amount, s.amount_paid, s.balance_due, s.created_at
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? ORDER BY s.id DESC LIMIT 5`
    ).bind(businessId).all();
    return (rs.results || []).map((s) => ({
      ref: s.sale_number, customer: s.customer, total: Number(s.total_amount) || 0,
      paid: Number(s.amount_paid) || 0, balance: Number(s.balance_due) || 0, at: s.created_at,
    }));
  }, []);

  snap.recentExpenses = await q(async () => {
    const rs = await db.prepare(
      `SELECT COALESCE(e.note, ec.name, 'Expense') AS description, e.amount, e.incurred_on
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.business_id = ? ORDER BY e.id DESC LIMIT 5`
    ).bind(businessId).all();
    return (rs.results || []).map((e) => ({ description: e.description, amount: Number(e.amount) || 0, date: e.incurred_on }));
  }, []);

  snap.staffCount = await q(async () => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`).bind(businessId).first();
    return Number(r && r.n) || 0;
  }, 0);

  return snap;
}

function snapshotText(snap, currency) {
  const L = [];
  L.push(`Business: ${snap.businessName} (${snap.businessType}), plan: ${snap.tier}, staff members: ${snap.staffCount}.`);
  if (snap.products.length) {
    L.push("Products (name, price, unit, stock): " + snap.products.map((p) => `${p.name} ${fmt(p.price, currency)} per ${p.unit} (stock ${p.stock})`).join("; ") + ".");
  } else {
    L.push("Products: none added yet.");
  }
  L.push(`Sales today: ${fmt(snap.salesToday.total, currency)} across ${snap.salesToday.count} sales.`);
  L.push(`Sales this month: ${fmt(snap.salesMonth.total, currency)} across ${snap.salesMonth.count} sales.`);
  L.push(`Expenses this month: ${fmt(snap.expensesMonth.total, currency)} across ${snap.expensesMonth.count} expenses.`);
  if (snap.debtors.length) {
    L.push("Customers owing (name: balance): " + snap.debtors.map((d) => `${d.name}: ${fmt(d.balance, currency)}`).join("; ") + ".");
  } else {
    L.push("Customers owing: nobody owes money right now.");
  }
  if (snap.lowStock.length) {
    L.push("Low stock: " + snap.lowStock.map((p) => `${p.name} (${p.qty} ${p.unit} left)`).join("; ") + ".");
  } else {
    L.push("Low stock: nothing is running low.");
  }
  if (snap.recentSales.length) {
    L.push("Last sales: " + snap.recentSales.map((s) => `${s.ref} ${s.customer} ${fmt(s.total, currency)} paid ${fmt(s.paid, currency)}${s.balance > 0 ? ` (owes ${fmt(s.balance, currency)})` : ""}`).join("; ") + ".");
  }
  if (snap.recentExpenses.length) {
    L.push("Last expenses: " + snap.recentExpenses.map((e) => `${e.description} ${fmt(e.amount, currency)} on ${e.date}`).join("; ") + ".");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt: conversational manager + action protocol. The tool list is
// tailored to the business's tier so the model only offers what is allowed.
// ---------------------------------------------------------------------------
const TOOL_DOCS = {
  record_sale: `- record_sale: {"items": [{"product": "product name", "qty": 2}], "customer_name": "optional", "amount_paid": optional number, "payment_method": "cash"}. Use the EXACT product names from the snapshot. If amount_paid is missing, assume full payment.`,
  add_expense: `- add_expense: {"description": "what it was for", "amount": number, "category": "optional"}`,
  add_product: `- add_product: {"name": "product name", "price": number, "unit": "optional e.g. cup", "stock": optional number}`,
  record_customer_payment: `- record_customer_payment: {"customer_name": "name", "amount": number}`,
  set_reminder: `- set_reminder: {"text": "what to remember", "remind_at": "e.g. tomorrow 9am"}`,
  get_customer_balance: `- get_customer_balance: {"customer_name": "name"}`,
  draft_debtor_message: `- draft_debtor_message: {"customer_name": "name", "tone": "polite|firm|final" (optional, default polite)}. Writes a professional payment reminder to a customer who owes money. I will show you the draft for review first.`,
  send_debtor_message: `- send_debtor_message: {"customer_name": "name", "message": "the EXACT draft text"}. Sends a debtor reminder ONLY after you have shown the user the draft and they said yes. The message param must match the draft you showed them word for word.`,
};

function systemPrompt(snap, currency, tier) {
  const allowed = allowedToolsForTier(tier);
  const toolDocs = allowed.map((t) => TOOL_DOCS[t]).join("\n");
  const actionSection = allowed.length
    ? `ACTIONS (you can DO things, not just answer):
When the user asks you to DO something, output ONE line on its own, exactly in this format, with no code fences:
ACTION: {"tool": "tool_name", "params": {...}}
Then on the next lines write your normal reply text (e.g. what you are about to do).

Available tools and params:
${toolDocs}

DEBTOR MESSAGES: when the user wants a payment reminder written for a customer who owes money, use draft_debtor_message. I will show the draft for review. Only use send_debtor_message after the user has seen the draft and explicitly said yes (e.g. "yes", "send it", "go ahead"). The message you send must be word-for-word the draft they approved.

Only output an ACTION line when the user clearly wants something done. For plain questions, just answer in natural text with no ACTION line.`
    : `ACTIONS: you are in read-only mode on this plan. You cannot record sales, add expenses, or take any other action. If the user asks you to DO something, answer warmly that actions need an upgrade: "${UPGRADE_NUDGE}"`;
  return `You are Kopa, the KopaBook business assistant for Nigerian small business owners. You talk like a knowledgeable, warm human shop manager who knows this business inside out, not like a robot. Keep answers short and practical. Use Nigerian business language naturally.

RULES:
- Answer ANY question about the business using ONLY the numbers in BUSINESS SNAPSHOT below. Never invent numbers, prices, stock levels, or customer balances. If the data is not in the snapshot, say so plainly (e.g. "I don't have that in your records yet").
- Never reveal another business's data. All figures below belong to this business only.
- Money is in ${currency}.

BUSINESS SNAPSHOT (live data, read just now):
${snapshotText(snap, currency)}

${actionSection}`;
}

// ---------------------------------------------------------------------------
// Fuzzy matchers. Never guess: 0 or 2+ matches returns a clarification need.
// ---------------------------------------------------------------------------
async function matchProduct(db, businessId, name) {
  const raw = String(name || "").trim();
  // Numeric id fast-path.
  if (/^\d+$/.test(raw)) {
    let r;
    try {
      r = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock
         FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.id = ? AND p.business_id = ? AND p.is_active = 1 LIMIT 1`
      ).bind(Number(raw), businessId).first();
    } catch (e) {
      if (!/no such column: unit/i.test(String(e && e.message))) throw e;
      r = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, COALESCE(ii.quantity_on_hand, 0) AS stock
         FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.id = ? AND p.business_id = ? AND p.is_active = 1 LIMIT 1`
      ).bind(Number(raw), businessId).first();
    }
    if (r) return [{ id: r.id, name: r.name, price: Number(r.unit_price) || 0, unit: r.unit || "piece", stock: Number(r.stock) || 0 }];
  }
  const like = `%${raw.toLowerCase()}%`;
  let rs;
  try {
    rs = await db.prepare(
      `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock
       FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1 AND LOWER(p.name) LIKE ? LIMIT 5`
    ).bind(businessId, like).all();
  } catch (e) {
    if (!/no such column: unit/i.test(String(e && e.message))) throw e;
    rs = await db.prepare(
      `SELECT p.id, p.name, p.unit_price, COALESCE(ii.quantity_on_hand, 0) AS stock
       FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1 AND LOWER(p.name) LIKE ? LIMIT 5`
    ).bind(businessId, like).all();
  }
  const rows = (rs.results || []).map((p) => ({
    id: p.id, name: p.name, price: Number(p.unit_price) || 0, unit: p.unit || "piece", stock: Number(p.stock) || 0,
  }));
  // Prefer an exact (case-insensitive) name hit when several fuzzy matches exist.
  const exact = rows.filter((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
  return exact.length === 1 ? [exact[0]] : rows;
}

async function matchCustomer(db, businessId, name) {
  const like = `%${String(name).trim().toLowerCase()}%`;
  const rs = await db.prepare(
    `SELECT c.id, c.name, COALESCE((SELECT balance_after FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS bal
     FROM customers c WHERE c.business_id = ? AND LOWER(c.name) LIKE ? LIMIT 5`
  ).bind(businessId, like).all();
  const rows = (rs.results || []).map((c) => ({ id: c.id, name: c.name, balance: Number(c.bal) || 0 }));
  const exact = rows.filter((c) => c.name.toLowerCase() === String(name).trim().toLowerCase());
  return exact.length === 1 ? [exact[0]] : rows;
}

// ---------------------------------------------------------------------------
// Natural-language remind_at parser. Accepts "tomorrow 9am", "in 3 hours",
// "2026-10-25 14:00", weekday names. Defaults to tomorrow 9am WAT.
// Returns "YYYY-MM-DD HH:MM:SS" in UTC.
// ---------------------------------------------------------------------------
function parseRemindAt(text, businessTz) {
  const WAT = 1; // Africa/Lagos
  const now = new Date();
  const nowWat = new Date(now.getTime() + WAT * 3600 * 1000);
  const t = String(text || "").trim().toLowerCase();
  const toUtc = (watDate) => {
    const utc = new Date(watDate.getTime() - WAT * 3600 * 1000);
    return utc.toISOString().slice(0, 19).replace("T", " ");
  };
  const atTime = (base, hh, mm) => {
    const d = new Date(base);
    d.setUTCHours(hh, mm || 0, 0, 0);
    return d;
  };
  const parseClock = (s) => {
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    let hh = Number(m[1]);
    const mm = Number(m[2] || 0);
    const ap = m[3];
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  };

  let m;
  if ((m = t.match(/in\s+(\d+)\s*(minute|hour|day)s?/))) {
    const n = Number(m[1]);
    const ms = m[2].startsWith("minute") ? n * 60000 : m[2].startsWith("hour") ? n * 3600000 : n * 86400000;
    return toUtc(new Date(nowWat.getTime() + ms));
  }
  if ((m = t.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?)?/))) {
    const [y, mo, d] = m[1].split("-").map(Number);
    const hh = m[2] !== undefined ? Number(m[2]) : 9;
    const mm = m[3] !== undefined ? Number(m[3]) : 0;
    return toUtc(new Date(Date.UTC(y, mo - 1, d, hh, mm, 0)));
  }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayIdx = days.findIndex((d) => t.includes(d));
  let base = new Date(nowWat);
  let hasDateHint = false;
  if (t.includes("tomorrow")) {
    base = new Date(base.getTime() + 86400000);
    hasDateHint = true;
  } else if (t.includes("today")) {
    hasDateHint = true;
  } else if (dayIdx >= 0) {
    let delta = (dayIdx - base.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    base = new Date(base.getTime() + delta * 86400000);
    hasDateHint = true;
  }
  const clock = parseClock(t);
  if (!hasDateHint && !clock) {
    // Unparseable: default to tomorrow 9am WAT.
    base = new Date(base.getTime() + 86400000);
  }
  const { hh, mm } = clock || { hh: 9, mm: 0 };
  return toUtc(atTime(base, hh, mm));
}

// ---------------------------------------------------------------------------
// Tool executors. Each returns { ok, summary, clarification? }.
// clarification (string) means: do not execute, ask the user this instead.
// ---------------------------------------------------------------------------
async function execRecordSale(context, db, auth, params, currency) {
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) return { ok: false, clarification: "What exactly should I record? Tell me the product and quantity, e.g. '2 Rice'." };

  const lines = [];
  for (const it of items) {
    const qty = Number(it.qty || it.quantity || 1);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, clarification: `How many "${it.product}"? I need a valid quantity.` };
    const matches = await matchProduct(db, auth.business.id, it.product || "");
    if (!matches.length) return { ok: false, clarification: `I could not find "${it.product}" in your products. Check the name and try again.` };
    if (matches.length > 1) return { ok: false, clarification: `"${it.product}" matches more than one product: ${matches.map((p) => p.name).join(", ")}. Which one do you mean?` };
    const p = matches[0];
    if (p.stock < qty) return { ok: false, clarification: `Not enough stock for ${p.name}. You have ${p.stock} ${p.unit} left.` };
    const lineTotal = Math.round(p.price * qty * 100) / 100;
    lines.push({ product: p, qty, unitPrice: p.price, lineTotal });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const paymentMethod = String(params.payment_method || params.paymentMethod || "cash").slice(0, 40);
  const amountPaid = params.amount_paid !== undefined && params.amount_paid !== null ? Number(params.amount_paid) : subtotal;
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return { ok: false, clarification: "How much did the customer pay? I need a valid amount." };
  const paid = Math.min(amountPaid, subtotal);
  const change = Math.round((amountPaid - paid) * 100) / 100;
  const balanceDue = Math.round((subtotal - paid) * 100) / 100;

  const customerName = params.customer_name || params.customerName ? String(params.customer_name || params.customerName).trim() : "";
  let custId = null;
  let createCustomer = false;
  if (customerName) {
    const cm = await matchCustomer(db, auth.business.id, customerName);
    if (cm.length > 1) return { ok: false, clarification: `"${customerName}" matches more than one customer: ${cm.map((c) => c.name).join(", ")}. Which one?` };
    if (cm.length === 1) custId = cm[0].id;
    else createCustomer = true;
  }
  if (balanceDue > 0 && !custId && !createCustomer) {
    return { ok: false, clarification: `There is an unpaid balance of ${fmt(balanceDue, currency)}. Whose account should I put it on?` };
  }

  const now = toSqliteDate();
  const saleNumber = `KB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const S_SALE = `(SELECT id FROM sales WHERE sale_number = ? AND business_id = ?)`;
  const S_CUST = `(SELECT customer_id FROM sales WHERE sale_number = ? AND business_id = ?)`;

  let prevLedgerBalance = 0;
  if (balanceDue > 0 && custId) {
    const last = await db.prepare(`SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`).bind(custId).first();
    prevLedgerBalance = last ? Number(last.balance_after) : 0;
  }

  const stmts = [];
  if (createCustomer) {
    stmts.push(db.prepare(`INSERT INTO customers (business_id, name) VALUES (?, ?)`).bind(auth.business.id, customerName));
  }
  stmts.push(
    db.prepare(
      `INSERT INTO sales (business_id, staff_user_id, customer_id, sale_number, subtotal, total_amount, amount_paid, balance_due, payment_method, status, change_given)
       VALUES (?, ?, ${createCustomer ? "last_insert_rowid()" : "?"}, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).bind(auth.business.id, auth.user.id, ...(createCustomer ? [] : [custId]), saleNumber, subtotal, subtotal, paid, balanceDue, paymentMethod, change)
  );
  const headerIdx = stmts.length - 1;
  for (const l of lines) {
    stmts.push(
      db.prepare(`INSERT INTO sale_items (sale_id, item_type, product_id, quantity, unit_price, cost_snapshot, line_total)
                  VALUES (${S_SALE}, 'product', ?, ?, ?, 0, ?)`)
        .bind(saleNumber, auth.business.id, l.product.id, l.qty, l.unitPrice, l.lineTotal)
    );
    stmts.push(
      db.prepare(`UPDATE inventory_items SET quantity_on_hand = quantity_on_hand - ?, updated_at = ? WHERE product_id = ?`)
        .bind(l.qty, now, l.product.id)
    );
    stmts.push(
      db.prepare(`INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, source_id, note, created_by)
                  VALUES (?, 'sale', ?, 'sale', ${S_SALE}, ?, ?)`)
        .bind(l.product.id, -l.qty, saleNumber, auth.business.id, `Sale ${saleNumber}`, auth.user.id)
    );
  }
  const payRows = paid > 0 ? [{ mode: paymentMethod, amount: paid }] : [{ mode: "cash", amount: 0 }];
  for (const pr of payRows) {
    stmts.push(
      db.prepare(`INSERT INTO payment_records (business_id, sale_id, customer_id, amount, payment_method, recorded_by)
                  VALUES (?, ${S_SALE}, ${S_CUST}, ?, ?, ?)`)
        .bind(auth.business.id, saleNumber, auth.business.id, saleNumber, auth.business.id, pr.amount, pr.mode, auth.user.id)
    );
  }
  if (balanceDue > 0) {
    const newBalance = Math.round((prevLedgerBalance + balanceDue) * 100) / 100;
    stmts.push(
      db.prepare(`INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
                  VALUES (${S_CUST}, 'debt', ?, ?, 'sale', ${S_SALE}, ?)`)
        .bind(saleNumber, auth.business.id, balanceDue, newBalance, saleNumber, auth.business.id, `Sale ${saleNumber}`)
    );
  }
  const batchResults = await db.batch(stmts);
  const saleId = batchResults[headerIdx].meta.last_row_id;
  await audit(context, auth, "ai.sale.create", "sale", saleId, { saleNumber, total: subtotal, via: "kopa_ai" });

  const itemDesc = lines.map((l) => `${l.qty} ${l.product.name} at ${fmt(l.unitPrice, currency)} per ${l.product.unit}`).join(", ");
  const custDesc = customerName ? ` for ${customerName}` : "";
  const payDesc = balanceDue > 0
    ? `paid ${fmt(paid, currency)} ${paymentMethod}, balance ${fmt(balanceDue, currency)} recorded as debt`
    : `paid ${fmt(paid, currency)} ${paymentMethod}`;
  return { ok: true, summary: `Recorded sale of ${itemDesc}${custDesc}, total ${fmt(subtotal, currency)}, ${payDesc}. Ref ${saleNumber}.` };
}

async function execAddExpense(context, db, auth, params, currency) {
  const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can record expenses.");
  if (permDenied) return { ok: false, clarification: "You don't have permission to record expenses. Ask the business owner to grant it." };
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, clarification: "How much was the expense? I need an amount greater than zero." };
  const description = String(params.description || "").trim();
  if (!description) return { ok: false, clarification: "What was the expense for? Give me a short description." };

  let catId = null;
  const categoryName = params.category ? String(params.category).trim().slice(0, 60) : null;
  if (categoryName) {
    const existing = await db.prepare(`SELECT id FROM expense_categories WHERE business_id = ? AND name = ? LIMIT 1`)
      .bind(auth.business.id, categoryName).first();
    if (existing) catId = existing.id;
    else {
      const ins = await db.prepare(`INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 0)`)
        .bind(auth.business.id, categoryName).run();
      catId = ins.meta.last_row_id;
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  const result = await db.prepare(
    `INSERT INTO expenses (business_id, category_id, amount, note, incurred_on, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(auth.business.id, catId, Math.round(amt * 100) / 100, description, date, auth.user.id).run();
  await audit(context, auth, "ai.expense.create", "expense", result.meta.last_row_id, { amount: amt, via: "kopa_ai" });
  return { ok: true, summary: `Recorded expense: ${description}, ${fmt(amt, currency)}${categoryName ? ` under ${categoryName}` : ""}.` };
}

async function execAddProduct(context, db, auth, params, currency) {
  const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can add products.");
  if (permDenied) return { ok: false, clarification: "You don't have permission to add products. Ask the business owner to grant it." };
  const name = String(params.name || "").trim();
  const price = Number(params.price);
  if (!name) return { ok: false, clarification: "What is the product called?" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, clarification: `What is the selling price of "${name}"? I need a valid number.` };

  const { tier } = await getBusinessOwnerTier(db, auth.business.id);
  const maxProducts = LIMITS[tier] ? LIMITS[tier].products : 100;
  if (maxProducts !== null) {
    const count = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM products WHERE business_id = ? AND is_active = 1)
            + (SELECT COUNT(*) FROM services WHERE business_id = ? AND is_active = 1) AS n`
    ).bind(auth.business.id, auth.business.id).first();
    if (Number(count && count.n) >= maxProducts) {
      return { ok: false, clarification: `Your plan allows ${maxProducts} products and services per business. Upgrade to add more.` };
    }
  }

  const unit = String(params.unit || "piece").trim().slice(0, 30) || "piece";
  const opening = Number(params.stock || 0);
  const countRow = await db.prepare(`SELECT COUNT(*) AS c FROM products WHERE business_id = ?`).bind(auth.business.id).first();
  let n = Number(countRow && countRow.c || 0) + 1;
  let finalSku = null;
  for (;;) {
    const candidate = "KB-" + String(n).padStart(4, "0");
    const clash = await db.prepare(`SELECT id FROM products WHERE business_id = ? AND sku = ? LIMIT 1`).bind(auth.business.id, candidate).first();
    if (!clash) { finalSku = candidate; break; }
    n++;
  }
  let result;
  try {
    result = await db.prepare(
      `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, unit, is_active)
       VALUES (?, ?, ?, ?, 0, 5, ?, 1)`
    ).bind(auth.business.id, name, finalSku, price, unit).run();
  } catch (e) {
    if (!/no such column: unit/i.test(String(e && e.message))) throw e;
    result = await db.prepare(
      `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, is_active)
       VALUES (?, ?, ?, ?, 0, 5, 1)`
    ).bind(auth.business.id, name, finalSku, price).run();
  }
  const productId = result.meta.last_row_id;
  await db.prepare(`INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level) VALUES (?, ?, 5)`)
    .bind(productId, opening).run();
  if (opening > 0) {
    await db.prepare(`INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
                      VALUES (?, 'opening', ?, 'manual', ?, ?)`)
      .bind(productId, opening, `Opening stock for ${name}`, auth.user.id).run();
  }
  await audit(context, auth, "ai.product.create", "product", productId, { name, price, via: "kopa_ai" });
  return { ok: true, summary: `Added product "${name}" at ${fmt(price, currency)} per ${unit}${opening > 0 ? ` with opening stock of ${opening}` : ""}.` };
}

async function execRecordCustomerPayment(context, db, auth, params, currency) {
  const name = String(params.customer_name || params.customerName || "").trim();
  const amt = Number(params.amount);
  if (!name) return { ok: false, clarification: "Which customer paid?" };
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, clarification: "How much did they pay? I need an amount greater than zero." };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}". Check the name and try again.` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  if (c.balance <= 0) return { ok: false, clarification: `${c.name} has no outstanding balance, so there is nothing to record.` };
  if (amt > c.balance) {
    return { ok: false, clarification: `${c.name} owes ${fmt(c.balance, currency)}. ${fmt(amt, currency)} is more than the balance. Tell me the correct amount.` };
  }
  const applied = Math.round(amt * 100) / 100;
  const newBalance = Math.round((c.balance - applied) * 100) / 100;
  const payResult = await db.prepare(
    `INSERT INTO payment_records (business_id, customer_id, amount, payment_method, recorded_by) VALUES (?, ?, ?, 'cash', ?)`
  ).bind(auth.business.id, c.id, applied, auth.user.id).run();
  await db.prepare(
    `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
     VALUES (?, 'payment', ?, ?, 'payment', ?, 'Payment recorded by Kopa AI')`
  ).bind(c.id, -applied, newBalance, payResult.meta.last_row_id).run();
  await audit(context, auth, "ai.debt.payment", "customer", c.id, { amount: applied, via: "kopa_ai" });
  return { ok: true, summary: `Recorded payment of ${fmt(applied, currency)} from ${c.name}. New balance: ${fmt(newBalance, currency)}.` };
}

async function execSetReminder(context, db, auth, params) {
  const text = String(params.text || "").trim().slice(0, 200);
  if (!text) return { ok: false, clarification: "What should I remind you about?" };
  const remindAt = parseRemindAt(params.remind_at || params.remindAt, auth.business.timezone);
  const id = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare(
    `INSERT INTO bot_reminders (id, business_id, user_id, title, remind_at, repeat_type, status) VALUES (?, ?, ?, ?, ?, 'once', 'pending')`
  ).bind(id, auth.business.id, String(auth.user.id), text, remindAt).run();
  await audit(context, auth, "ai.reminder.create", "reminder", null, { text, remind_at: remindAt, via: "kopa_ai" });
  return { ok: true, summary: `Reminder set: "${text}" for ${remindAt} (UTC).` };
}

async function execGetCustomerBalance(db, auth, params, currency) {
  const name = String(params.customer_name || params.customerName || "").trim();
  if (!name) return { ok: false, clarification: "Which customer's balance do you want to check?" };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}".` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  return {
    ok: true,
    summary: c.balance > 0
      ? `${c.name} owes ${fmt(c.balance, currency)}.`
      : `${c.name} has no outstanding balance.`,
  };
}

// Draft a professional debtor reminder. The model writes the draft via a
// second AI call using the customer's REAL balance; the reply is the draft
// for the user to review. Nothing is sent.
async function execDraftDebtorMessage(ai, db, auth, params, currency) {
  const name = String(params.customer_name || params.customerName || "").trim();
  if (!name) return { ok: false, clarification: "Which customer should I write the reminder for?" };
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}". Check the name and try again.` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer: ${matches.map((c) => c.name).join(", ")}. Which one?` };
  const c = matches[0];
  if (c.balance <= 0) return { ok: false, clarification: `${c.name} has no outstanding balance, so there is no reminder to write.` };
  const tone = ["polite", "firm", "final"].includes(String(params.tone || "").toLowerCase())
    ? String(params.tone).toLowerCase() : "polite";
  const businessName = auth.business.name || "us";
  let draft;
  try {
    const resp = await ai.run(AI_MODEL, {
      messages: [
        { role: "system", content: `You write short, professional payment reminders for Nigerian small businesses. Tone: ${tone} (${tone === "polite" ? "warm and respectful, first reminder" : tone === "firm" ? "direct but respectful, second reminder" : "serious and final, last warning before further action"}). Rules: address the customer by first name only, state the EXACT amount owed, mention the business name once, sign off with the business name, no emojis, no slang, keep it under 60 words. Plain text only, no quotes around it.` },
        { role: "user", content: `Customer: ${c.name}. Owes: ${fmt(c.balance, currency)}. Business: ${businessName}. Write the ${tone} reminder now.` },
      ],
    });
    draft = resp && (resp.response || resp.answer || resp.text);
    if (!draft) throw new Error("empty");
    draft = String(draft).trim();
  } catch (e) {
    draft = `Hello ${c.name.split(" ")[0]}, this is ${businessName}. This is a friendly reminder that you have an outstanding balance of ${fmt(c.balance, currency)} with us. Kindly pay at your earliest convenience. Thank you. - ${businessName}`;
  }
  await logAiAction(db, auth, params, "draft_debtor_message", { customer: c.name, balance: c.balance, tone }, { draft });
  return {
    ok: true,
    isDraft: true,
    draft,
    summary: `Drafted a ${tone} payment reminder for ${c.name} (${fmt(c.balance, currency)}).`,
  };
}

// Send a debtor reminder ONLY after the user approved the exact draft.
// Delivery is a wa.me link the user taps; Kopa never auto-sends WhatsApp.
async function execSendDebtorMessage(db, auth, params, currency, history) {
  const name = String(params.customer_name || params.customerName || "").trim();
  const message = String(params.message || "").trim();
  if (!name || !message) return { ok: false, clarification: "Tell me which customer and the exact message to send." };
  // Enforcement: the previous assistant message must contain the exact draft.
  const lastAssistant = [...(history || [])].reverse().find((h) => h.role === "assistant");
  const approved = lastAssistant && typeof lastAssistant.content === "string" && lastAssistant.content.includes(message);
  if (!approved) {
    return { ok: false, clarification: `I need you to see and approve the message before I send anything. Tell me which customer you want reminded and I will draft it first.` };
  }
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}".` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer. Which one?` };
  const c = matches[0];
  // Fetch phone for the wa.me link.
  const row = await db.prepare(`SELECT phone FROM customers WHERE id = ? AND business_id = ?`).bind(c.id, auth.business.id).first().catch(() => null);
  const digits = String((row && row.phone) || "").replace(/\D/g, "");
  let link = null;
  if (digits) {
    const intl = digits.startsWith("234") ? digits : digits.startsWith("0") ? "234" + digits.slice(1) : digits;
    link = `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
  }
  await logAiAction(db, auth, params, "send_debtor_message", { customer: c.name, balance: c.balance }, { waLink: link, hasPhone: !!digits });
  if (!link) {
    return { ok: true, summary: `Message approved for ${c.name}, but I don't have a phone number saved for them, so I can't open WhatsApp. Here is the message to copy:\n\n${message}` };
  }
  return { ok: true, waLink: link, summary: `Ready to send to ${c.name} on WhatsApp.` };
}

async function logAiAction(db, auth, params, tool, p, result) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(
      `INSERT INTO ai_action_log (business_id, user_id, day, tool, params, result) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(auth.business.id, auth.user.id, day, tool, JSON.stringify(p || params || {}), JSON.stringify(result || {})).run();
  } catch (e) { /* logging must never break the action */ }
}

const TOOL_EXECUTORS = {
  record_sale: execRecordSale,
  add_expense: execAddExpense,
  add_product: execAddProduct,
  record_customer_payment: execRecordCustomerPayment,
  set_reminder: execSetReminder,
  get_customer_balance: execGetCustomerBalance,
  draft_debtor_message: execDraftDebtorMessage,
  send_debtor_message: execSendDebtorMessage,
};

// ---------------------------------------------------------------------------
// ACTION line parsing.
// ---------------------------------------------------------------------------
function parseAction(text) {
  if (!text) return null;
  // Be lenient: strip code fences in case the model wraps the JSON anyway.
  const stripped = String(text).replace(/```(?:json)?/gi, "");
  const idx = stripped.search(/^\s*ACTION:/m);
  if (idx < 0) return null;
  // Extract a balanced JSON object starting after "ACTION:".
  const start = stripped.indexOf("{", idx);
  if (start < 0) return { parseError: true };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return { parseError: true };
  try {
    const obj = JSON.parse(stripped.slice(start, end));
    if (obj && typeof obj.tool === "string" && obj.params && typeof obj.params === "object") {
      const rest = (stripped.slice(0, idx) + stripped.slice(end)).replace(/^\s*ACTION:\s*/m, "").trim();
      return { tool: obj.tool, params: obj.params, rest };
    }
  } catch (e) {
    return { parseError: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main handler.
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
  const db = context.env.KOPABOOK_DB;
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const businessId = auth.business && auth.business.id;
    if (!businessId) return json({ ok: false, message: "Pick a business first." }, 400);
    const currency = auth.business.currency || "NGN";

    // Tiered AI: every plan gets Kopa AI. Staff use the business owner's plan.
    const { tier: rawTier } = await getBusinessOwnerTier(db, businessId);
    const tier = AI_TIER_LIMITS[rawTier] ? rawTier : "free";
    const tierCfg = AI_TIER_LIMITS[tier];

    // Abuse guard on top of the daily AI cap.
    if (!(await checkRateLimit(db, `ai_${auth.user.id}`, 60, 3600000))) {
      return json({ ok: false, message: "Too many questions at once. Slow down a little." }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const message = String(body.message || body.question || "").trim().slice(0, 1000);
    if (!message) return json({ ok: false, message: "Ask a question first." }, 400);
    const history = Array.isArray(body.history)
      ? body.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string").slice(-HISTORY_LIMIT)
      : [];

    // Daily question cap for this tier (per business per UTC day).
    const day = new Date().toISOString().slice(0, 10);
    // Resilient usage read: if migration 0046 (the `actions` column) was never
    // applied, fall back to the legacy shape so the assistant never 500s.
    let usage = null;
    try {
      usage = await db.prepare(`SELECT count, actions FROM ai_usage WHERE business_id = ? AND day = ?`).bind(String(businessId), day).first();
    } catch (e) {
      usage = await db.prepare(`SELECT count FROM ai_usage WHERE business_id = ? AND day = ?`).bind(String(businessId), day).first().catch(() => null);
    }
    const usedToday = usage ? Number(usage.count) || 0 : 0;
    const actionsToday = usage && typeof usage.actions !== "undefined" ? Number(usage.actions) || 0 : 0;
    const bumpActions = async () => {
      await db.prepare(
        `INSERT INTO ai_usage (business_id, day, count, actions) VALUES (?, ?, 0, 1)
         ON CONFLICT(business_id, day) DO UPDATE SET actions = actions + 1`
      ).bind(String(businessId), day).run().catch(() => {});
    };
    if (usedToday >= tierCfg.questionsPerDay) {
      const capMsg = `You have used today's Kopa AI limit (${tierCfg.questionsPerDay} questions on your plan). It resets tomorrow, and your data is untouched.` + (tier === "free" ? ` ${UPGRADE_NUDGE}` : "");
      return json({
        ok: true,
        reply: capMsg,
        answer: capMsg,
        actions_taken: [],
        fallback: true,
        capped: true,
        usage: { used_today: usedToday, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay },
      });
    }

    // Rich live snapshot, injected into every request.
    const snap = await buildSnapshot(db, auth);
    const snapshotFallbackText = snapshotText(snap, currency);

    // Count the question before the AI call so failures still respect the cap.
    await db.prepare(
      `INSERT INTO ai_usage (business_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT(business_id, day) DO UPDATE SET count = count + 1`
    ).bind(String(businessId), day).run();
    const newUsed = usedToday + 1;

    const ai = context.env.AI;
    const sys = systemPrompt(snap, currency, tier);

    // Graceful degradation: the app must never break because AI is down.
    if (!ai) {
      const reply = `Kopa AI is not connected yet, but here is what your books say.\n${snapshotFallbackText}`;
      return json({ ok: true, reply, answer: reply, actions_taken: [], fallback: true, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay } });
    }

    let modelText;
    try {
      const messages = [{ role: "system", content: sys }];
      for (const h of history) messages.push({ role: h.role, content: h.content.slice(0, 1000) });
      messages.push({ role: "user", content: message });
      const resp = await ai.run(AI_MODEL, { messages });
      modelText = resp && (resp.response || resp.answer || resp.text);
      if (!modelText) throw new Error("empty AI response");
      modelText = String(modelText);
    } catch (e) {
      const reply = `Kopa AI is resting at the moment, but your books are fine.\n${snapshotFallbackText}`;
      return json({ ok: true, reply, answer: reply, actions_taken: [], fallback: true, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay } });
    }

    // Agentic path: the model asked to DO something.
    const action = parseAction(modelText);
    const actionsTaken = [];
    if (action && !action.parseError) {
      const usageObj = () => ({ used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay });
      if (!TOOL_EXECUTORS[action.tool]) {
        return json({
          ok: true, reply: `I understood you want me to do something, but "${action.tool}" is not something I can do. Try asking me to record a sale, add an expense, or draft a debtor reminder.`,
          answer: `I understood you want me to do something, but "${action.tool}" is not something I can do.`,
          actions_taken: [], fallback: false, usage: usageObj(),
        });
      }
      // Tier check first: Free is read-only; Starter has a small tool set.
      if (!tierAllowsTool(tier, action.tool)) {
        const tierMsg = tier === "free"
          ? `I can answer questions about your business on your Free plan, but doing things like that needs an upgrade. ${UPGRADE_NUDGE}`
          : `Your ${tier[0].toUpperCase() + tier.slice(1)} plan does not include "${action.tool}". Upgrade to Solo or Pro for the full AI assistant.`;
        return json({ ok: true, reply: tierMsg, answer: tierMsg, actions_taken: [], fallback: false, usage: usageObj() });
      }
      if (!toolAllowed(auth, action.tool)) {
        return json({
          ok: true,
          reply: "Your staff role does not allow that action. You can record sales and check customer balances; everything else needs the owner or an admin.",
          answer: "Your staff role does not allow that action.",
          actions_taken: [], fallback: false, usage: usageObj(),
        });
      }
      // Per-day action cap for capped tiers (Starter).
      if (tierCfg.actionsPerDay !== null && tierCfg.actionsPerDay !== undefined && actionsToday >= tierCfg.actionsPerDay) {
        const capMsg = `You have used today's AI action limit (${tierCfg.actionsPerDay} actions on Starter). It resets tomorrow. Upgrade to Solo or Pro for more.`;
        return json({ ok: true, reply: capMsg, answer: capMsg, actions_taken: [], fallback: false, capped: true, usage: usageObj() });
      }
      let result;
      try {
        const exec = TOOL_EXECUTORS[action.tool];
        // Debtor tools need the Workers AI handle and conversation history.
        result = action.tool === "draft_debtor_message"
          ? await exec(ai, db, auth, action.params, currency)
          : action.tool === "send_debtor_message"
            ? await exec(db, auth, action.params, currency, history)
            : await exec(context, db, auth, action.params, currency);
      } catch (e) {
        result = { ok: false, clarification: "Something went wrong while doing that. Your data is untouched. Try again." };
      }
      if (result.clarification) {
        // Never execute on ambiguity. Ask the user, conversationally.
        return json({
          ok: true, reply: result.clarification, answer: result.clarification,
          actions_taken: [], fallback: false, usage: usageObj(),
        });
      }
      await bumpActions();
      actionsTaken.push({ tool: action.tool, summary: result.summary, waLink: result.waLink || null });

      // Drafts are returned as-is for review (with a send prompt for Solo/Pro).
      if (result.isDraft) {
        const draftReply = `${result.draft}\n\nShall I send this?`;
        return json({
          ok: true, reply: draftReply, answer: draftReply, actions_taken: actionsTaken,
          draft: result.draft, fallback: false, usage: usageObj(),
        });
      }
      // WhatsApp send links ride along on the confirmation.
      if (result.waLink) {
        const waReply = `${result.summary}\n\nTap to send on WhatsApp:\n${result.waLink}`;
        return json({
          ok: true, reply: waReply, answer: waReply, actions_taken: actionsTaken,
          waLink: result.waLink, fallback: false, usage: usageObj(),
        });
      }

      // Confirmation in Kopa's voice, with real numbers.
      let reply;
      try {
        const conf = await ai.run(AI_MODEL, {
          messages: [
            { role: "system", content: `You are Kopa, the warm, human KopaBook business assistant for Nigerian shop owners. The user asked you to do something and you just did it. Write a short, natural confirmation (2-3 sentences max) using ONLY the facts given. Never add numbers that are not in the facts.` },
            { role: "user", content: `User request: ${message}\nWhat was done: ${result.summary}\nWrite the confirmation now.` },
          ],
        });
        reply = conf && (conf.response || conf.answer || conf.text);
        if (!reply) throw new Error("empty");
        reply = String(reply);
      } catch (e) {
        reply = "Done. " + result.summary;
      }
      return json({
        ok: true, reply, answer: reply, actions_taken: actionsTaken,
        fallback: false, usage: usageObj(),
      });
    }

    // Plain conversational answer (ACTION line stripped if the model left one).
    const cleanReply = action && action.rest ? action.rest : modelText;
    return json({
      ok: true, reply: cleanReply, answer: cleanReply, actions_taken: [],
      fallback: false, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay },
    });
  } catch (error) {
    return json({ ok: false, message: "Something went wrong. Try again." }, 500);
  }
}
