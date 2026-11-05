// Deterministic fast path for Ask Kopa AI.
//
// Purpose: answer the common intents from the live business snapshot in
// seconds, with NO model call. The model is used only for open questions
// the snapshot cannot answer. This is prompt, knowledge and intent tuning
// on the live code, not a separate model training run: the phrases a shop
// owner actually uses are matched here, in plain code, and every figure
// comes from the snapshot passed in at run time.
//
// Rules this module keeps:
// - Pure: no imports, no database, no network, no model. Every function
//   takes what it needs as arguments, so it is unit-testable in node.
// - Nothing is hardcoded to any one business: no business name, no
//   product name, no customer name, no amount, no currency, no plan.
//   Currency is passed in and figures are formatted with it.
// - Conservative: when a message is ambiguous, return null (fall through
//   to the model) or a targeted question for the one missing detail.
//   Never guess a name, a product, or an amount.
// - Write intents return { kind: "action", tool, params } and flow into
//   the existing ACTION dispatch in chat.js: dry-run, guardrails, then a
//   proposal card. Nothing is recorded by chat words; only a Confirm tap
//   executes. This module never writes anything itself.
//
// Return shapes from resolveFastPath(message, history, snap, currency):
// - { kind: "reply", text }        answer now, no model call.
// - { kind: "action", tool, params } run through the ACTION dispatch.
// - { kind: "briefing" }           chat.js calls buildBriefing.
// - { kind: "eod" }                chat.js calls buildEodSummary.
// - { kind: "reminders" }          chat.js lists due reminders from D1.
// - { kind: "reminder_done", title } chat.js marks the reminder (proposal).
// - null                           not a fast-path intent; use the model.

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Lowercase, straight quotes, collapse whitespace. Keeps the words intact.
export function normalizeFastText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Title-case a name for display ("fortune godson" -> "Fortune Godson").
export function titleCaseName(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Same money format as chat.js fmt(): currency code, then grouped digits.
export function formatMoney(n, currency) {
  const v = Number(n || 0);
  return (currency || "NGN") + " " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

// Words that may sit next to an amount and are not part of a name.
const CURRENCY_WORDS = [
  "ngn", "naira", "ghs", "cedis", "ghc", "kes", "ksh", "shillings",
  "usd", "dollars", "gbp", "pounds", "eur", "euros", "zar", "rand",
  "inr", "rupees", "cfa", "xof", "xaf", "ugx", "tzs", "zmw", "gmd",
];
const CURRENCY_SYMBOLS = ["₦", "₵", "¢", "$", "£", "€", "₹", "KSh", "GH₵", "GH¢"];

// Find every amount in the text: a number, optional magnitude word.
// "1,000,000" -> 1000000, "1.5m" -> 1500000, "5k" -> 5000,
// "2 million" -> 2000000, "3 thousand" -> 3000.
// Returns [{ value, index, length }] in order of appearance.
export function findAmounts(text) {
  const t = String(text || "");
  const out = [];
  const re = /(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const raw = m[1].replace(/,/g, "");
    let value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const mag = (m[2] || "").toLowerCase();
    if (mag === "million" || mag === "m") value *= 1000000;
    else if (mag === "thousand" || mag === "k") value *= 1000;
    // A bare "m" after a number is only a magnitude when the number is
    // clearly money (it follows a currency word/symbol or a money verb).
    // "2m of rope" is not money; "paid 2m" is. Guard by checking the
    // word before the number in the caller, not here: findAmounts is
    // only called from money contexts, so "m" always means million.
    out.push({ value: Math.round(value * 100) / 100, index: m.index, length: m[0].length });
  }
  return out;
}

// Remove one amount (and a currency word/symbol next to it) from the text.
function removeAmount(text, amount) {
  let t = String(text || "");
  const before = t.slice(0, amount.index);
  const after = t.slice(amount.index + amount.length);
  t = (before + " " + after).replace(/\s+/g, " ").trim();
  // Strip a currency word or symbol that sat next to the amount.
  for (const w of CURRENCY_WORDS) {
    t = t.replace(new RegExp("\\b" + w + "\\b", "gi"), " ");
  }
  for (const s of CURRENCY_SYMBOLS) {
    t = t.split(s).join(" ");
  }
  return t.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Payment mentions: "Favour paid 1000000", "Record Favour paid 1m",
// "Paid 50000 from Mama Ngozi", "Received 20000 from Chidi".
// ---------------------------------------------------------------------------

const PAYMENT_VERBS = /\b(paid|pay|payment|received|receive|collected|collect|settled|settle|gave|given)\b/;
const PAYMENT_FILLER = /\b(record|please|kindly|just|has|have|had|now|the|a|an|payment|paid|pay|received|receive|collected|collect|settled|settle|gave|given|from|to|for|of|me|us|it|that|this|today|yesterday|this morning|on)\b/g;

export function parsePaymentMention(text) {
  const t = normalizeFastText(text);
  if (!PAYMENT_VERBS.test(t)) return null;
  const amounts = findAmounts(t);
  if (!amounts.length) return null;
  // The amount is the last number in the message.
  const amount = amounts[amounts.length - 1];
  if (!(amount.value > 0)) return null;
  let rest = removeAmount(t, amount);
  // A trailing "for <something>" is a purpose, not part of the name.
  rest = rest.replace(/\s+for\s+.*$/, "");
  rest = rest.replace(/\s+(towards|against)\s+.*$/, "");
  rest = rest.replace(PAYMENT_FILLER, " ").replace(/\s+/g, " ").trim();
  rest = rest.replace(/^[.,;:!?]+|[.,;:!?]+$/g, "").trim();
  if (!rest) return null;
  // A name is one to four words; anything longer is not a name.
  const words = rest.split(/\s+/);
  if (words.length > 4) return null;
  return { customer_name: titleCaseName(rest), amount: amount.value };
}

// ---------------------------------------------------------------------------
// Sale mentions: "Record a sale", "Sold 2 Rice to Mama Ngozi",
// "Record 2 Rice", "I sold 3 Fuel for 5000", "New sale 1 Laptop".
// ---------------------------------------------------------------------------

const SALE_VERBS = /\b(record|new|add|sold|sell|sale|sales)\b/;

export function parseSaleMention(text) {
  const t = normalizeFastText(text);
  if (!SALE_VERBS.test(t)) return null;
  let rest = t;
  // Amount paid: "paid <amount>" or a trailing "for <amount>".
  let amountPaid = null;
  const paidMatch = rest.match(/\bpaid\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?/i);
  if (paidMatch) {
    const found = findAmounts(paidMatch[0]);
    if (found.length) amountPaid = found[0].value;
    rest = rest.replace(paidMatch[0], " ");
  } else {
    const forAmount = rest.match(/\sfor\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?\s*$/i);
    if (forAmount) {
      const found = findAmounts(forAmount[0]);
      if (found.length) amountPaid = found[0].value;
      rest = rest.replace(forAmount[0], " ");
    }
  }
  // Customer: a trailing "to <name>" or "for <name>".
  let customerName = "";
  const toMatch = rest.match(/\bto\s+([a-z][a-z' ]+?)\s*$/);
  if (toMatch) {
    customerName = toMatch[1].trim();
    rest = rest.replace(toMatch[0], " ");
  } else {
    const forName = rest.match(/\bfor\s+([a-z][a-z' ]+?)\s*$/);
    if (forName && !findAmounts(forName[1]).length) {
      customerName = forName[1].trim();
      rest = rest.replace(forName[0], " ");
    }
  }
  // Remove the sale verbs and filler, then split into item segments.
  rest = rest
    .replace(/\b(record|new|add|sold|sell|sale|sales|of|the|a|an|please|kindly|just|item|items|product|i|we)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const items = [];
  if (rest) {
    const segments = rest.split(/\s*,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const qm = seg.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (qm) {
        items.push({ product: qm[2].trim(), qty: Number(qm[1]) });
      } else if (!/^(to|for|paid)\b/.test(seg)) {
        items.push({ product: seg, qty: 1 });
      }
    }
  }
  // A lone payment/expense word is not a product ("record a payment" is
  // not a sale of one "payment"). Let the model ask for the details.
  if (items.length === 1 && /^(payment|paid|expense|expenses|reminder|reminders?)$/.test(items[0].product)) return null;
  // A bare "record a sale" is a real intent with no details yet: return
  // empty items so the executor asks its one targeted question.
  const params = { items };
  if (customerName) params.customer_name = titleCaseName(customerName);
  if (amountPaid !== null) params.amount_paid = amountPaid;
  return params;
}

// ---------------------------------------------------------------------------
// Expense mentions: "Record an expense", "Record expense 5000 for fuel",
// "Spent 5000 on fuel", "Add expense fuel 600".
// ---------------------------------------------------------------------------

const EXPENSE_VERBS = /\b(record|add|spent|spend|expense|expenses|bought)\b/;

export function parseExpenseMention(text) {
  const t = normalizeFastText(text);
  if (!EXPENSE_VERBS.test(t)) return null;
  // Must be an expense intent, not a sale or payment.
  if (SALE_VERBS.test(t) && !/\bexpense\b/.test(t)) return null;
  if (PAYMENT_VERBS.test(t) && !/\bexpense\b/.test(t)) return null;
  const amounts = findAmounts(t);
  let amount = null;
  let rest = t;
  if (amounts.length) {
    amount = amounts[0].value;
    rest = removeAmount(t, amounts[0]);
  }
  rest = rest
    .replace(/\b(record|add|spent|spend|expense|expenses|bought|an|the|a|please|kindly|just|for|on|of|to)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  return { amount, description: rest };
}

// ---------------------------------------------------------------------------
// Add product: "Add product Laptop 500000", "New product Rice 2000".
// ---------------------------------------------------------------------------

export function parseAddProduct(text) {
  const t = normalizeFastText(text);
  if (!/\b(add|new)\b/.test(t) || !/\bproduct\b/.test(t)) return null;
  const amounts = findAmounts(t);
  let price = null;
  let rest = t;
  if (amounts.length) {
    price = amounts[amounts.length - 1].value;
    rest = removeAmount(t, amounts[amounts.length - 1]);
  }
  rest = rest
    .replace(/\b(add|new|product|the|a|an|please|kindly|at|for|priced|price|selling)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  return { name: titleCaseName(rest), price };
}

// ---------------------------------------------------------------------------
// Reminders: "Remind me to call the supplier tomorrow 9am",
// "Set reminder pay rent in 3 hours", "Remind me to restock".
// ---------------------------------------------------------------------------

const TIME_TAIL_RE = /\b(tomorrow|today|in\s+\d+\s*(minutes?|hours?|days?|weeks?)|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2})?)\b.*$/i;

export function parseSetReminder(text) {
  const t = normalizeFastText(text);
  if (!/\b(remind|reminder)\b/.test(t)) return null;
  let rest = t.replace(/\b(set|remind|reminder|me|please|kindly|to|a|an|the)\b/g, " ").replace(/\s+/g, " ").trim();
  // The time tail, if any, is the remind_at; the rest is the title.
  let remindAt = "";
  const timeMatch = rest.match(TIME_TAIL_RE);
  if (timeMatch) {
    remindAt = timeMatch[0].trim();
    rest = rest.slice(0, timeMatch.index).trim();
  }
  // "remind me to X" leaves "to X" after the filler strip; drop a leading to.
  rest = rest.replace(/^to\s+/, "").trim();
  if (!rest) return null;
  return { text: rest, remind_at: remindAt };
}

// ---------------------------------------------------------------------------
// Memory: "Remember rent is due on the 1st", "Remember: supplier is Ada".
// ---------------------------------------------------------------------------

export function parseSaveMemory(text) {
  const t = normalizeFastText(text);
  if (!/\b(remember|note|note that|keep in mind)\b/.test(t)) return null;
  let rest = t.replace(/^\s*(please\s+|kindly\s+)?(remember|note that|note|keep in mind)\s*:?\s*/i, "").trim();
  if (!rest) return null;
  let key = "";
  let value = "";
  const colon = rest.indexOf(":");
  const isSplit = rest.match(/^(.+?)\s+is\s+(.+)$/);
  const eqSplit = rest.indexOf("=");
  if (colon > 0) {
    key = rest.slice(0, colon).trim();
    value = rest.slice(colon + 1).trim();
  } else if (eqSplit > 0) {
    key = rest.slice(0, eqSplit).trim();
    value = rest.slice(eqSplit + 1).trim();
  } else if (isSplit) {
    key = isSplit[1].trim();
    value = isSplit[2].trim();
  } else {
    key = rest;
    value = "";
  }
  // Drop a leading "the" from the label ("remember the supplier is Ada"
  // stores "supplier", not "the supplier").
  key = key.replace(/^the\s+/i, "").trim();
  if (!key) return null;
  return { key, value };
}

// ---------------------------------------------------------------------------
// Balance question: "How much does Favour owe?", "Balance for Chidi",
// "Does Mama Ngozi owe anything?", "Check Ada balance".
// ---------------------------------------------------------------------------

export function parseBalanceQuery(text) {
  const t = normalizeFastText(text);
  if (!/\b(owe|owes|owing|balance|debt)\b/.test(t)) return null;
  // The debtors list ("who owes me", "customers owing") is a different
  // intent; a generic plural is not a customer name.
  if (/\b(who|anyone|anybody|everyone|everybody|all)\b/.test(t) && !/\bdoes\b/.test(t)) return null;
  let rest = t
    .replace(/\b(how|much|does|do|is|what|the|a|an|check|show|tell|me|for|please|kindly|anything|owe|owes|owing|balance|debt|outstanding|left|still)\b/g, " ")
    .replace(/'s/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  if (/^(customers?|everyone|anybody|anyone|everybody)$/.test(rest)) return null;
  const words = rest.split(/\s+/);
  if (words.length > 4) return null;
  return { customer_name: titleCaseName(rest) };
}

// ---------------------------------------------------------------------------
// Debtor draft: "Draft a message to Favour", "Remind Chidi to pay",
// "Write a firm reminder to Ada". Tone from the words used.
// ---------------------------------------------------------------------------

export function parseDraftDebtor(text) {
  const t = normalizeFastText(text);
  if (!/\b(draft|write|message|remind|reminder|chase|follow up)\b/.test(t)) return null;
  if (!/\b(to|for)\b/.test(t) && !/\bremind\b/.test(t)) return null;
  let tone = "polite";
  if (/\b(final|last warning|last reminder)\b/.test(t)) tone = "final";
  else if (/\b(firm|strong|serious|strict)\b/.test(t)) tone = "firm";
  let rest = t
    .replace(/\b(draft|write|message|remind|reminder|chase|follow up|a|an|the|please|kindly|to|for|about|their|his|her|debt|balance|payment|pay|paying|owe|owes|owing|firm|strong|serious|strict|final|last warning|last reminder|polite|friendly)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  const words = rest.split(/\s+/);
  if (words.length > 4) return null;
  return { customer_name: titleCaseName(rest), tone };
}

// Deterministic debtor draft, same wording as the existing model-failure
// fallback in chat.js so the user sees one consistent draft. Balance and
// business name come from the snapshot, never from this module.
export function buildDebtorDraft(customerName, balance, currency, businessName, tone) {
  const first = String(customerName || "").split(" ")[0];
  const amount = formatMoney(balance, currency);
  const biz = businessName || "us";
  if (tone === "final") {
    return `Hello ${first}, this is ${biz}. This is a final reminder that your outstanding balance of ${amount} must be settled immediately. Please contact us today to arrange payment. Thank you. - ${biz}`;
  }
  if (tone === "firm") {
    return `Hello ${first}, this is ${biz}. Your outstanding balance of ${amount} is due. Please arrange payment as soon as possible. Thank you. - ${biz}`;
  }
  return `Hello ${first}, this is ${biz}. This is a friendly reminder that you have an outstanding balance of ${amount} with us. Kindly pay at your earliest convenience. Thank you. - ${biz}`;
}

// ---------------------------------------------------------------------------
// Send debtor message: "Send it", "Send that message", "Send it to Favour".
// The draft text is recovered from the last assistant message, because the
// send executor requires the exact approved draft.
// ---------------------------------------------------------------------------

export function parseSendDebtor(text, history) {
  const t = normalizeFastText(text);
  if (!/\bsend\b/.test(t)) return null;
  if (!/\b(it|that|this|message|reminder|whatsapp)\b/.test(t)) return null;
  const lastAssistant = [...(history || [])].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string");
  if (!lastAssistant) return null;
  // The draft reply ends with "Shall I send this?"; the draft is the part
  // before it. If the last assistant message has no draft shape, there is
  // nothing approved to send.
  let draft = lastAssistant.content;
  const tail = draft.indexOf("Shall I send this?");
  if (tail < 0) return null;
  draft = draft.slice(0, tail).trim();
  if (!draft) return null;
  // Customer name: from the message ("send it to Favour"), else from the
  // user turn that asked for the draft ("draft a message to Favour"),
  // else from the draft greeting ("Hello Favour, ..."). The greeting
  // only carries the first name, so the draft-request turn is preferred:
  // the send executor fuzzy-matches, but the full name avoids ambiguity.
  let customerName = "";
  const toMatch = t.match(/\bto\s+([a-z][a-z' ]+?)\s*$/);
  if (toMatch) customerName = toMatch[1].trim();
  if (!customerName) {
    const draftReq = [...(history || [])].reverse().find((h) => h && h.role === "user" && typeof h.content === "string" && parseDraftDebtor(h.content));
    if (draftReq) {
      const parsed = parseDraftDebtor(draftReq.content);
      if (parsed) customerName = parsed.customer_name;
    }
  }
  if (!customerName) {
    const hello = draft.match(/^hello\s+([^,.]+)[,.]/i);
    if (hello) customerName = hello[1].trim();
  }
  if (!customerName) return null;
  return { customer_name: titleCaseName(customerName), message: draft };
}

// ---------------------------------------------------------------------------
// Projects: report, create (interview), milestones, transactions.
// ---------------------------------------------------------------------------

export const PROJECT_TYPES = ["construction", "event", "charity", "business", "custom"];

export function parseProjectReport(text) {
  const t = normalizeFastText(text);
  if (!/\bproject\b/.test(t)) return null;
  if (!/\b(report|status|how|doing|progress|update|show|summary)\b/.test(t)) return null;
  let rest = t
    .replace(/\b(how|is|the|a|an|project|report|status|doing|progress|update|show|summary|for|on|of|please|kindly|me|give|doing)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  return { project_name: rest || "" };
}

// "Create project Shop Renovation", "New business project Ada Store to sell food".
// Returns { name, type, goal } with whatever was found; missing fields are
// asked one at a time by the executor's interview gate.
export function parseProjectPlan(text) {
  const t = normalizeFastText(text);
  if (!/\b(create|new|start|plan)\b/.test(t) || !/\bproject\b/.test(t)) return null;
  let rest = t;
  let type = "";
  for (const pt of PROJECT_TYPES) {
    if (new RegExp("\\b" + pt + "\\b").test(rest)) { type = pt; break; }
  }
  let goal = "";
  const goalMatch = rest.match(/\bto\s+([a-z][a-z' ]+?)\s*$/);
  if (goalMatch) {
    goal = goalMatch[1].trim();
    rest = rest.replace(goalMatch[0], " ");
  } else {
    const goalWord = rest.match(/\bgoal\s*(is|:)?\s*(.+)$/);
    if (goalWord) {
      goal = goalWord[2].trim();
      rest = rest.replace(goalWord[0], " ");
    }
  }
  rest = rest
    .replace(/\b(create|new|start|plan|project|a|an|the|please|kindly|business|event|charity|construction|custom)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  const name = rest;
  if (!name && !type && !goal) return null;
  return { name: name ? titleCaseName(name) : "", type, goal };
}

// "Add milestone Buy shelves to project Shop Renovation",
// "Complete milestone Buy shelves in Shop Renovation".
export function parseProjectMilestone(text) {
  const t = normalizeFastText(text);
  if (!/\bmilestone\b/.test(t)) return null;
  const isComplete = /\b(complete|completed|done|finish|finished|mark)\b/.test(t);
  const projectMatch = t.match(/\b(?:to|in|for|of)\s+(?:project\s+)?([a-z][a-z' ]+?)\s*$/);
  let project = "";
  let rest = t;
  if (projectMatch) {
    project = projectMatch[1].trim();
    rest = rest.replace(projectMatch[0], " ");
  }
  rest = rest
    .replace(/\b(add|create|new|complete|completed|done|finish|finished|mark|milestone|a|an|the|please|kindly|to|in|for|of|as)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  return { tool: isComplete ? "project_complete_milestone" : "project_add_milestone", project, title: rest };
}

// "Record 50000 income for project Shop Renovation",
// "Add 20000 expense to project Ada Store for paint".
export function parseProjectTransaction(text) {
  const t = normalizeFastText(text);
  if (!/\bproject\b/.test(t)) return null;
  if (!/\b(income|expense)\b/.test(t)) return null;
  const kind = /\bincome\b/.test(t) ? "income" : "expense";
  const amounts = findAmounts(t);
  if (!amounts.length) return null;
  const amount = amounts[0].value;
  let rest = removeAmount(t, amounts[0]);
  const projectMatch = rest.match(/\b(?:for|to|in|of)\s+(?:project\s+)?([a-z][a-z' ]+?)\s*$/);
  let project = "";
  if (projectMatch) {
    project = projectMatch[1].trim();
    rest = rest.replace(projectMatch[0], " ");
  }
  const description = rest
    .replace(/\b(record|add|income|expense|project|a|an|the|please|kindly|for|to|in|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!project) return null;
  return { project, kind, amount, description };
}

// ---------------------------------------------------------------------------
// Multi-turn: "Record it", "Record that", "Record am", "Do it".
// Scans recent user turns for an unrecorded payment, sale or expense.
// ---------------------------------------------------------------------------

export const RECORD_IT_RE = /^\s*(record it now|record that now|record it|record that|record am|record this|do it|go ahead and record|yes record|record the payment|record the sale|record the expense)\s*[.!?]*\s*$/i;

export function isRecordIt(text) {
  return RECORD_IT_RE.test(String(text || "").trim());
}

// Most recent unrecorded mention in the history (last 6 user turns).
// Returns { kind: "payment"|"sale"|"expense", ...parsed } or null.
export function findPendingMention(history) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-6);
  for (let i = turns.length - 1; i >= 0; i--) {
    const content = turns[i].content;
    const payment = parsePaymentMention(content);
    if (payment) return { kind: "payment", ...payment };
    const sale = parseSaleMention(content);
    if (sale && sale.items && sale.items.length) return { kind: "sale", ...sale };
    const expense = parseExpenseMention(content);
    if (expense && (expense.amount || expense.description)) return { kind: "expense", ...expense };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Read intents: short answers straight from the snapshot.
// ---------------------------------------------------------------------------

// The four suggestion chips, and their exact labels.
export const CHIP_TEXTS = ["Record a sale", "Record an expense", "Today's sales", "Who owes me"];

export function isChipTap(text) {
  return CHIP_TEXTS.includes(String(text || "").trim());
}

function includesAny(t, phrases) {
  return phrases.some((p) => {
    // Single words match on word boundaries, so "restock" never triggers
    // the "stock" intent. Multi-word phrases are distinctive enough to
    // match as substrings.
    if (/^[a-z]+$/.test(p)) return new RegExp("\\b" + p + "\\b").test(t);
    return t.includes(p);
  });
}

export function classifyReadIntent(text) {
  const t = normalizeFastText(text);
  if (includesAny(t, ["brief me", "briefing", "morning briefing", "daily briefing", "give me a briefing", "brief us"])) return "briefing";
  if (includesAny(t, ["end of day", "day summary", "today's summary", "todays summary", "how did we do today", "close of day", "end of day summary"])) return "eod";
  if (includesAny(t, ["reminders due", "reminders", "what reminders", "any reminders", "remind me list", "due reminders", "what is due", "whats due"])) return "reminders";
  if (/\breminder\b/.test(t) && /\b(done|mark|complete|finished)\b/.test(t)) return "reminder_done";
  if (includesAny(t, ["who owes", "who owe", "who dey owe", "who is owing", "who is owed", "debtors", "customers owing", "who owes me", "who owes us", "who still owes", "anyone owing", "who has not paid", "who hasn't paid", "unpaid customers"])) return "debtors";
  if (includesAny(t, ["low stock", "running low", "running out", "out of stock", "low on stock", "almost finished", "almost out"])) return "lowstock";
  if (includesAny(t, ["stock", "inventory", "how much stock", "what do we have in stock", "check stock", "stock levels", "stock level"])) return "stock";
  if (includesAny(t, ["recent sales", "last sales", "latest sales", "sales history", "show sales", "last few sales", "recent transactions"])) return "recentsales";
  if (includesAny(t, ["recent expenses", "last expenses", "latest expenses", "show expenses", "what did we spend", "what have we spent"])) return "recentexpenses";
  if (includesAny(t, ["sales today", "today's sales", "todays sales", "sales so far today", "how much did we sell today", "how much we sell today", "wetin we sell today", "what did we sell today", "today sales", "sales for today"])) return "today";
  if (includesAny(t, ["sales this month", "sales for the month", "this month sales", "how much did we sell this month", "monthly sales", "sales month"])) return "month";
  return null;
}

// Short snapshot answers. Each is one or a few lines, never the whole
// snapshot. Empty states say so plainly instead of dumping everything.
export function formatTodaySales(snap, currency) {
  const total = snap.salesToday.total || 0;
  const count = snap.salesToday.count || 0;
  if (!count) return "No sales yet today.";
  return `Sales today so far: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
}

export function formatMonthSales(snap, currency) {
  const total = snap.salesMonth.total || 0;
  const count = snap.salesMonth.count || 0;
  if (!count) return "No sales yet this month.";
  return `Sales this month: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
}

export function formatDebtors(snap, currency) {
  if (!snap.debtors || !snap.debtors.length) return "Nobody owes money right now.";
  const lines = snap.debtors.map((d) => `- ${d.name}: ${formatMoney(d.balance, currency)}`);
  const total = snap.debtors.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  return `Customers owing (${snap.debtors.length}):\n${lines.join("\n")}\nTotal owed: ${formatMoney(total, currency)}.`;
}

export function formatStock(snap, currency) {
  if (!snap.products || !snap.products.length) return "No products added yet.";
  const lines = snap.products.slice(0, 20).map((p) => `- ${p.name}: ${p.stock} ${p.unit || "units"} left at ${formatMoney(p.price, currency)} each`);
  return `Stock:\n${lines.join("\n")}`;
}

export function formatLowStock(snap, currency) {
  if (!snap.lowStock || !snap.lowStock.length) return "Nothing is running low.";
  const lines = snap.lowStock.map((p) => `- ${p.name}: ${p.qty} ${p.unit || "units"} left`);
  return `Running low:\n${lines.join("\n")}`;
}

export function formatRecentSales(snap, currency) {
  if (!snap.recentSales || !snap.recentSales.length) return "No sales recorded yet.";
  const lines = snap.recentSales.map((s) => `- ${s.ref || ""} ${s.customer || "Walk-in"}: ${formatMoney(s.total, currency)}${s.balance > 0 ? ` (owes ${formatMoney(s.balance, currency)})` : ""}`.trim());
  return `Last sales:\n${lines.join("\n")}`;
}

export function formatRecentExpenses(snap, currency) {
  if (!snap.recentExpenses || !snap.recentExpenses.length) return "No expenses recorded yet.";
  const lines = snap.recentExpenses.map((e) => `- ${e.description}: ${formatMoney(e.amount, currency)} on ${e.date || ""}`.trim());
  return `Last expenses:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Orchestrator: message + history + snapshot -> fast-path result or null.
// ---------------------------------------------------------------------------

export function resolveFastPath(message, history, snap, currency) {
  const text = String(message || "").trim();
  if (!text) return null;
  const t = normalizeFastText(text);

  // 1. "Record it" (and its variations): resolve the pending mention from
  // the recent turns. No mention -> one short line, not a dump.
  if (isRecordIt(text)) {
    const pending = findPendingMention(history);
    if (!pending) {
      return { kind: "reply", text: "I do not have anything to record yet. Tell me what happened, for example 'Favour paid 1000000'." };
    }
    if (pending.kind === "payment") {
      return { kind: "action", tool: "record_customer_payment", params: { customer_name: pending.customer_name, amount: pending.amount } };
    }
    if (pending.kind === "sale") {
      return { kind: "action", tool: "record_sale", params: pending };
    }
    return { kind: "action", tool: "add_expense", params: { amount: pending.amount, description: pending.description } };
  }

  // 2. Direct payment mention: "Favour paid 1000000" -> propose it now.
  const payment = parsePaymentMention(text);
  if (payment) {
    return { kind: "action", tool: "record_customer_payment", params: { customer_name: payment.customer_name, amount: payment.amount } };
  }

  // 3. Send the approved debtor draft.
  if (/\bsend\b/.test(t)) {
    const send = parseSendDebtor(text, history);
    if (send) {
      return { kind: "action", tool: "send_debtor_message", params: { customer_name: send.customer_name, message: send.message } };
    }
    if (/\b(it|that|this|message|reminder)\b/.test(t)) {
      return { kind: "reply", text: "I do not have a message to send yet. Tell me who to remind and I will draft it first." };
    }
  }

  // 4. Balance question for one customer.
  const balance = parseBalanceQuery(text);
  if (balance) {
    return { kind: "action", tool: "get_customer_balance", params: { customer_name: balance.customer_name } };
  }

  // 5. Debtor draft (deterministic template, no model call). Only for
  // debtor patterns: "draft/write/message/chase ... to/for <name>" or
  // "remind <name> to pay". A self-reminder ("remind me to ...") is not
  // a debtor draft; it is handled by the reminder step below.
  const isDraftReq = (/\b(draft|write|message|chase)\b/.test(t)
    || /\bremind\s+[a-z']+\s+to\s+pay\b/.test(t)
    || /\bremind\s+[a-z']+\s+about\b/.test(t)
    || /\bremind\s+[a-z']+\s*$/.test(t))
    && !/\bremind\s+(me|us)\b/.test(t);
  if (isDraftReq) {
    const draftReq = parseDraftDebtor(text);
    if (draftReq) {
      const debtor = (snap.debtors || []).find((d) => String(d.name || "").toLowerCase() === draftReq.customer_name.toLowerCase())
        || (snap.debtors || []).find((d) => String(d.name || "").toLowerCase().includes(draftReq.customer_name.toLowerCase()));
      if (!debtor) {
        // Not in the snapshot's debtor list: let the model path do the
        // database lookup instead of guessing a balance.
        return null;
      }
      if (!(Number(debtor.balance) > 0)) {
        return { kind: "reply", text: `${debtor.name} has no outstanding balance, so there is no reminder to write.` };
      }
      const draft = buildDebtorDraft(debtor.name, debtor.balance, currency, snap.businessName, draftReq.tone);
      return { kind: "reply", text: `${draft}\n\nShall I send this?` };
    }
  }

  // 5b. Set a reminder ("remind me to ...", "set reminder ..."). Runs
  // before the read intents on purpose: "remind me to check stock
  // tomorrow" is a reminder to set, not a stock question. The broad
  // reminder phrasings are handled by the later reminder step; the
  // "what reminders are due" question is a read intent, not a set.
  if (/^\s*(remind\s+(me|us)\b|set\s+reminder\b)/.test(t) && !/\b(done|mark|complete|finished)\b/.test(t)) {
    const reminder = parseSetReminder(text);
    if (reminder) {
      return { kind: "action", tool: "set_reminder", params: { text: reminder.text, remind_at: reminder.remind_at } };
    }
  }

  // 6. Read intents from the snapshot. These run BEFORE the sale and
  // project steps on purpose: "today's sales", "recent sales" and
  // "sales this month" are reports, not sales to record, and the sale
  // parser would otherwise eat them (they contain the word "sale").
  const read = classifyReadIntent(text);
  if (read === "briefing") return { kind: "briefing" };
  if (read === "eod") return { kind: "eod" };
  if (read === "reminders") return { kind: "reminders" };
  if (read === "reminder_done") {
    const titleMatch = t.replace(/\b(reminder|reminders|mark|done|complete|finished|please|kindly|the|a|an|as)\b/g, " ").replace(/\s+/g, " ").trim();
    return { kind: "reminder_done", title: titleMatch || "" };
  }
  if (read === "today") return { kind: "reply", text: formatTodaySales(snap, currency) };
  if (read === "month") return { kind: "reply", text: formatMonthSales(snap, currency) };
  if (read === "debtors") return { kind: "reply", text: formatDebtors(snap, currency) };
  if (read === "stock") return { kind: "reply", text: formatStock(snap, currency) };
  if (read === "lowstock") return { kind: "reply", text: formatLowStock(snap, currency) };
  if (read === "recentsales") return { kind: "reply", text: formatRecentSales(snap, currency) };
  if (read === "recentexpenses") return { kind: "reply", text: formatRecentExpenses(snap, currency) };

  // 7. Project report.
  if (/\bproject\b/.test(t) && /\b(report|status|how|doing|progress|summary)\b/.test(t)) {
    const report = parseProjectReport(text);
    if (report) {
      return { kind: "action", tool: "project_report", params: report.project_name ? { project: report.project_name } : {} };
    }
  }

  // 8. Project milestones and transactions.
  if (/\bmilestone\b/.test(t)) {
    const ms = parseProjectMilestone(text);
    if (ms) {
      return { kind: "action", tool: ms.tool, params: { project: ms.project, title: ms.title } };
    }
  }
  if (/\bproject\b/.test(t) && /\b(income|expense)\b/.test(t)) {
    const txn = parseProjectTransaction(text);
    if (txn) {
      return { kind: "action", tool: "project_record_transaction", params: { project: txn.project, kind: txn.kind, amount: txn.amount, description: txn.description } };
    }
  }

  // 9. Create project (interview: name, type, goal; the executor asks
  // one short question per missing field). Runs before the sale step:
  // "create ... to sell food" contains "sell" and would otherwise be
  // misread as a sale.
  if (/\bproject\b/.test(t) && /\b(create|new|start|plan)\b/.test(t)) {
    const plan = parseProjectPlan(text);
    if (plan && (plan.name || plan.type || plan.goal)) {
      return { kind: "action", tool: "create_project_plan", params: { name: plan.name, type: plan.type, goal: plan.goal } };
    }
  }

  // 10. Add product. Runs before the sale step: "add product ..." contains
  // "add" and would otherwise be misread as a sale of a "product".
  if (/\b(add|new)\b/.test(t) && /\bproduct\b/.test(t)) {
    const product = parseAddProduct(text);
    if (product) {
      return { kind: "action", tool: "add_product", params: { name: product.name, price: product.price } };
    }
  }

  // 11. Sale mention (including the bare "Record a sale" chip and
  // "Record 2 Rice"). Expense intents are excluded here; step 12 owns them.
  if (SALE_VERBS.test(t) && !/\bexpense\b/.test(t)) {
    const sale = parseSaleMention(text);
    if (sale) {
      return { kind: "action", tool: "record_sale", params: sale };
    }
  }

  // 12. Expense mention (including the bare "Record an expense" chip).
  if (/\bexpense\b/.test(t) || /\bspent\b/.test(t) || /\bspend\b/.test(t)) {
    const expense = parseExpenseMention(text);
    if (expense) {
      return { kind: "action", tool: "add_expense", params: { amount: expense.amount, description: expense.description } };
    }
  }

  // 13. Reminder. A self-reminder ("remind me to ...", "set reminder ...")
  // is a task for the owner; a debtor nudge ("remind Ada to pay") was
  // already handled by the draft step above.
  if ((/\bremind\s+(me|us)\b/.test(t) || /\bset\s+reminder\b/.test(t) || /\breminder\b/.test(t)) && !/\b(done|mark|complete|finished)\b/.test(t)) {
    const reminder = parseSetReminder(text);
    if (reminder) {
      return { kind: "action", tool: "set_reminder", params: { text: reminder.text, remind_at: reminder.remind_at } };
    }
  }

  // 14. Memory.
  if (/\b(remember|note that|keep in mind)\b/.test(t)) {
    const mem = parseSaveMemory(text);
    if (mem && mem.key) {
      return { kind: "action", tool: "save_memory", params: { key: mem.key, value: mem.value } };
    }
  }

  // 15. Nothing matched: the model handles it.
  return null;
}
