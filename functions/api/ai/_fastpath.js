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
// - { kind: "clearchat_question", text } chat.js asks the one
//   confirmation question, then clears only on a bare Yes (chat.js).
// - { kind: "activitylog", scope } chat.js answers the staff log read.
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

// Amounts written as words: "five thousand", "two hundred thousand",
// "one million five hundred thousand", "five hundred". Bounded to the
// common forms, not a full grammar: ones, tens, hundred, thousand,
// million, billion, with "and" allowed inside a run ("one hundred and
// fifty thousand") and a leading "a"/"an" before a scale word ("a
// thousand"). Returns [{ value, index, length }] like findAmounts, so
// removeAmount can cut the same span out of the text.
const NUMBER_WORD_ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const NUMBER_WORD_TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD_SCALES = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };

function isNumberWord(w) {
  return w === "a" || w === "an" || w === "and"
    || Object.prototype.hasOwnProperty.call(NUMBER_WORD_ONES, w)
    || Object.prototype.hasOwnProperty.call(NUMBER_WORD_TENS, w)
    || Object.prototype.hasOwnProperty.call(NUMBER_WORD_SCALES, w);
}

function numberWordsValue(words) {
  let result = 0;
  let current = 0;
  let seenNumber = false;
  for (const w of words) {
    if (w === "and") continue;
    if (w === "a" || w === "an") { current += 1; seenNumber = true; continue; }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORD_ONES, w)) { current += NUMBER_WORD_ONES[w]; seenNumber = true; continue; }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORD_TENS, w)) { current += NUMBER_WORD_TENS[w]; seenNumber = true; continue; }
    if (w === "hundred") { current = (current || 1) * 100; seenNumber = true; continue; }
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORD_SCALES, w)) {
      result += (current || 1) * NUMBER_WORD_SCALES[w];
      current = 0;
      seenNumber = true;
    }
  }
  if (!seenNumber) return null;
  return result + current;
}

export function findWordAmounts(text) {
  const t = String(text || "");
  const out = [];
  const tokenRe = /\b[a-z]+\b/gi;
  const tokens = [];
  let m;
  while ((m = tokenRe.exec(t)) !== null) tokens.push({ word: m[0].toLowerCase(), index: m.index, length: m[0].length });
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberWord(tokens[i].word)) { i += 1; continue; }
    // A run of number words: "five thousand", "one million five hundred
    // thousand". "and" only continues a run when another number word
    // follows it; "a"/"an" only start one before a scale word.
    let j = i;
    const run = [];
    while (j < tokens.length && isNumberWord(tokens[j].word)) {
      const w = tokens[j].word;
      if (w === "and") {
        if (j + 1 >= tokens.length || !isNumberWord(tokens[j + 1].word) || tokens[j + 1].word === "and") break;
        run.push(tokens[j]);
        j += 1;
        continue;
      }
      if ((w === "a" || w === "an") && (j + 1 >= tokens.length || !Object.prototype.hasOwnProperty.call(NUMBER_WORD_SCALES, tokens[j + 1].word))) break;
      run.push(tokens[j]);
      j += 1;
    }
    if (run.length) {
      const words = run.map((x) => x.word);
      const value = numberWordsValue(words);
      if (value !== null && value > 0) {
        const first = run[0];
        const last = run[run.length - 1];
        out.push({ value, index: first.index, length: last.index + last.length - first.index });
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

// Every amount in the text, digits and words, in order of appearance.
// Digit amounts win their span; a word amount never overlaps one.
// A word amount only counts when the word after it is money-shaped
// (a currency word, "for"/"to"/"from", a time word, "cash", "and", or
// the end of the text): "paid five thousand" is money, "paid one
// laptop" is not, the "one" there is a quantity.
const WORD_AMOUNT_FOLLOW = new Set([
  ...CURRENCY_WORDS, "for", "to", "from", "today", "yesterday", "now",
  "just", "please", "kindly", "and", "cash", "transfer",
]);
export function findAllAmounts(text) {
  const t = String(text || "");
  const digits = findAmounts(t);
  const words = findWordAmounts(t).filter((a) => {
    const after = t.slice(a.index + a.length).replace(/^[\s,.;:!?]+/, "");
    if (!after) return true;
    const next = after.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    return WORD_AMOUNT_FOLLOW.has(next);
  });
  const merged = [...digits, ...words].sort((a, b) => a.index - b.index);
  const out = [];
  for (const a of merged) {
    if (out.length && a.index < out[out.length - 1].index + out[out.length - 1].length) continue;
    out.push(a);
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
const PAYMENT_FILLER = /\b(record|please|kindly|just|has|have|had|now|the|a|an|payment|paid|pay|received|receive|collected|collect|settled|settle|gave|given|from|to|for|of|me|us|it|that|this|today|yesterday|this morning|on|in full|full|fully|paid up|cleared|clear|balance|in cash|cash|transfer|pos|bank transfer|via|by)\b/g;

// Words that make a payment an expense, never a customer payment:
// "I paid rent today 70000" is rent, "I paid light 5000" is light,
// "I paid the staff 40000" is a staff salary. The payment intent fires
// only for a real customer, so these words must never become a name.
export const EXPENSE_WORDS = new Set([
  "rent", "transport", "feeding", "food", "light", "electricity",
  "fuel", "diesel", "petrol", "airtime", "data", "internet", "water",
  "salary", "salaries", "wages", "staff", "repairs", "repair",
  "maintenance", "subscription", "tax", "levy",
]);

// The expense category a word maps to. The executor only takes a
// category from params.category (it never derives one from the
// description), so the fast path sets it here; without it the expense
// lands as Uncategorised.
export const EXPENSE_CATEGORY_MAP = {
  fuel: "Fuel", diesel: "Fuel", petrol: "Fuel",
  transport: "Transport",
  rent: "Rent",
  feeding: "Feeding",
  food: "Food",
  light: "Electricity", electricity: "Electricity",
  airtime: "Airtime",
  data: "Data",
  tax: "Tax", levy: "Tax",
  salary: "Staff/Salary", salaries: "Staff/Salary",
  staff: "Staff/Salary", wages: "Staff/Salary",
  repairs: "Repairs", repair: "Repairs", maintenance: "Repairs",
  water: "Water",
  internet: "Internet",
  subscription: "Subscriptions",
};

// The category for an expense description, from the first word in it
// that maps to one, or null when no word maps.
export function expenseCategoryFor(description) {
  const words = String(description || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORY_MAP, w)) return EXPENSE_CATEGORY_MAP[w];
  }
  return null;
}

// Clean an expense description into plain words: strip the time tail
// ("today", "in the morning", "this morning"), strip a leading "I"/"we",
// and capitalise what is left. "i fuel today" becomes "Fuel", "i
// transport today" becomes "Transport", "tax collectors" becomes
// "Tax Collectors". Nothing is invented: only the words the owner used.
export function cleanExpenseDescription(raw) {
  let s = String(raw || "").toLowerCase();
  s = s.replace(/\b(this morning|this afternoon|this evening|in the morning|in the afternoon|in the evening)\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/(\s*\b(today|yesterday|tonight|now|just|morning|afternoon|evening)\b\s*)+$/, "");
  s = s.replace(/^(i|we|my|our)\s+/, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return titleCaseName(s);
}

// An expense action's params with its category attached when the
// description maps to one. The executor reads params.category.
export function withExpenseCategory(params) {
  const category = expenseCategoryFor(params && params.description);
  if (!category) return params;
  return { ...params, category };
}

export function parsePaymentMention(text) {
  const t = normalizeFastText(text);
  if (!PAYMENT_VERBS.test(t)) return null;
  const amounts = findAllAmounts(t);
  if (!amounts.length) return null;
  // The amount is the last number in the message.
  const amount = amounts[amounts.length - 1];
  if (!(amount.value > 0)) return null;
  let rest = removeAmount(t, amount);
  // A trailing "for <something>" is a purpose, not part of the name.
  rest = rest.replace(/\s+for\s+.*$/, "");
  rest = rest.replace(/\s+(towards|against)\s+.*$/, "");
  rest = rest.replace(PAYMENT_FILLER, " ").replace(/\s+/g, " ").trim();
  // "log activity" / "activity log" is the activity history, never a
  // customer: "log" must never survive as a name.
  rest = rest.replace(/\b(log activity|activity log|activity|log)\b/g, " ").replace(/\s+/g, " ").trim();
  rest = rest.replace(/^[.,;:!?]+|[.,;:!?]+$/g, "").trim();
  if (!rest) return null;
  // First person is not a customer: "I paid 2000 for fuel" is an
  // expense, not a payment from a customer called "I". The expense
  // parser owns that shape. A leading "I"/"my" is never part of a
  // name either: "I paid Favour 5000" is a payment from Favour.
  rest = rest.replace(/^(i|we|my)\s+/, "");
  if (/^(i|we)$/.test(rest)) return null;
  // An expense word is never a customer name: "I paid rent" is rent,
  // and neither is a number ("I paid the 3 staff" is a staff payment,
  // never a customer called "3 Staff").
  const restWords = rest.split(/\s+/);
  if (/\d/.test(rest)) return null;
  if (restWords.some((w) => EXPENSE_WORDS.has(w))) return null;
  // A name is one to four words; anything longer is not a name.
  const words = rest.split(/\s+/);
  if (words.length > 4) return null;
  return { customer_name: titleCaseName(rest), amount: amount.value };
}

// ---------------------------------------------------------------------------
// Shared person-like understanding: pronouns, names as they appear in the
// message, full-balance payments, debtor reminders.
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const PRONOUN_WORDS = ["he", "him", "his", "she", "her", "hers", "they", "them", "their", "theirs"];

export function isPronounWord(word) {
  return PRONOUN_WORDS.includes(String(word || "").toLowerCase());
}

// The last customer talked about, for a pronoun (he/him/she/her/they).
// Scans history newest-first for a debtor name from the snapshot (full
// name first, then first name); the most recent mention wins. Returns
// the debtor object or null. One helper, used by the payment, balance
// and remind parsers alike.
export function resolvePronounCustomer(history, snap) {
  const debtors = (snap && snap.debtors) || [];
  if (!debtors.length) return null;
  const turns = [...(history || [])].reverse();
  for (const turn of turns) {
    const content = turn && typeof turn.content === "string" ? turn.content.toLowerCase() : "";
    if (!content) continue;
    let best = null;
    let bestIdx = -1;
    for (const d of debtors) {
      const name = String(d.name || "").toLowerCase();
      if (!name) continue;
      const fullIdx = content.indexOf(name);
      if (fullIdx >= 0 && fullIdx > bestIdx) { best = d; bestIdx = fullIdx; continue; }
      const first = name.split(" ")[0];
      if (first.length > 1) {
        const m = content.match(new RegExp("\\b" + escapeRegExp(first) + "\\b"));
        if (m && m.index > bestIdx) { best = d; bestIdx = m.index; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Debtors from the snapshot whose name (or first name) appears in the
// text, in order of appearance. Names are never guessed from the words
// around them: only a name that is actually in the snapshot counts.
export function findDebtorsInText(text, snap) {
  const t = normalizeFastText(text);
  const found = [];
  for (const d of (snap && snap.debtors) || []) {
    const name = String(d.name || "").toLowerCase();
    if (!name) continue;
    const fullIdx = t.indexOf(name);
    if (fullIdx >= 0) { found.push({ debtor: d, index: fullIdx }); continue; }
    const first = name.split(" ")[0];
    if (first.length > 1) {
      const m = t.match(new RegExp("\\b" + escapeRegExp(first) + "\\b"));
      if (m) found.push({ debtor: d, index: m.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.debtor);
}

export function detectDebtorTone(text) {
  const t = normalizeFastText(text);
  if (/\b(final|last warning|last reminder)\b/.test(t)) return "final";
  if (/\b(firm|strong|serious|strict)\b/.test(t)) return "firm";
  return "polite";
}

// The customer name in a remind-a-debtor sentence, with the intent words
// stripped out. "Remind Favour how much he owes" -> "Favour";
// "Remind Zlatan how much he owes" -> "Zlatan"; "Remind him of the
// balance on WhatsApp" -> null (a pronoun, not a name).
export function extractRemindName(text) {
  const t = normalizeFastText(text);
  const rest = t
    .replace(/\b(remind|reminder|chase|follow up|whatsapp|send|message|draft|write|a|an|the|please|kindly|to|for|about|their|his|her|he|she|him|them|it|how|much|what|on|of|debt|balance|payment|pay|paying|owe|owes|owing|firm|strong|serious|strict|final|last warning|last reminder|polite|friendly)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  if (rest.split(/\s+/).length > 4) return null;
  return titleCaseName(rest);
}

// ---------------------------------------------------------------------------
// Full-balance payments: "Favour have paid the full balance he owe now",
// "Favour paid in full", "Favour cleared his balance", "Favour settled
// everything he owes", "Favour paid all he owes", "Favour don pay finish".
// The amount is the customer's outstanding balance from the snapshot:
// never asked for, never invented. An explicit amount in the same
// message wins ("paid 1m in full" is a payment of 1m, not of the whole
// balance), and a sale sentence ("I sold ... he paid in full") is never
// a debtor payment.
// ---------------------------------------------------------------------------

const FULL_BALANCE_MARKERS = /\b(full balance|complete balance|entire balance|in full|paid full|pay full|paid up|don pay finish|don clear|don settle|don pay everything)\b/;
const FULL_BALANCE_OWE = /\b(everything|all|what)\b[^.]{0,40}\bowe(s|ing)?\b/;
const FULL_BALANCE_CLEAR = /\b(clear|cleared|settle|settled)\b[^.]{0,30}\b(balance|debt|owe|owes|owing|everything|all)\b/;
const FULL_BALANCE_VERBS = /\b(paid|pay|don pay|cleared|settled)\b/;

export function isFullBalancePayment(text) {
  const t = normalizeFastText(text);
  // A sale sentence owns its own "paid in full": the buyer paid for the
  // goods, not for an old debt.
  if (/\b(sold|sell|sale)\b/.test(t)) return false;
  // An explicit amount wins: the owner stated what was paid.
  if (findAllAmounts(t).length) return false;
  if (!FULL_BALANCE_VERBS.test(t) && !/\b(clear|settle)\b/.test(t)) return false;
  return FULL_BALANCE_MARKERS.test(t) || FULL_BALANCE_OWE.test(t) || FULL_BALANCE_CLEAR.test(t);
}

// The customer name in a full-balance payment sentence, with the
// payment words stripped out. "Zlatan paid the full balance he owes"
// -> "Zlatan"; "He paid in full" -> null (a pronoun, not a name).
export function extractFullBalanceName(text) {
  const t = normalizeFastText(text);
  const rest = t
    .replace(/\b(paid|pay|have|has|had|don|clear|cleared|settle|settled|full|in|balance|complete|entire|everything|all|what|he|she|him|her|them|they|his|their|owe|owes|owing|now|today|just|please|kindly|the|a|an|for|to|of|up|finish|by|via|transfer|cash|pos|bank)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  if (rest.split(/\s+/).length > 4) return null;
  return titleCaseName(rest);
}

// Resolve a full-balance payment against the snapshot.
// Returns { customer_name, amount } (amount > 0, propose it),
// { customer_name, amount: 0 } (name cleanly extracted but no balance
// outstanding: reply the balance is already zero, never propose), or
// null (not resolvable here: pronoun with no antecedent, or several
// debtors named; the caller asks one short question instead).
export function parseFullBalanceMention(text, history, snap) {
  if (!isFullBalancePayment(text)) return null;
  const named = findDebtorsInText(text, snap);
  if (named.length === 1) {
    const d = named[0];
    return { customer_name: d.name, amount: Number(d.balance) || 0 };
  }
  if (named.length > 1) return null;
  // A clean name beats a pronoun: in "Zlatan paid the full balance he
  // owes", "he" refers to Zlatan, not to whoever was talked about
  // before. Only a bare pronoun ("He paid in full") resolves from
  // history.
  const cleanName = extractFullBalanceName(text);
  const t = normalizeFastText(text);
  if (!cleanName && PRONOUN_WORDS.some((p) => new RegExp("\\b" + p + "\\b").test(t))) {
    const debtor = resolvePronounCustomer(history, snap);
    if (debtor) return { customer_name: debtor.name, amount: Number(debtor.balance) || 0 };
    return null;
  }
  if (cleanName) return { customer_name: cleanName, amount: 0 };
  return null;
}

// ---------------------------------------------------------------------------
// Answering the assistant's own amount question: "How much did Favour
// pay?" followed by "Full debts 637,820" (or a bare "637,820"). The
// user is answering the question, not starting a new statement, so the
// reply is read as the amount and the customer comes from the question
// or the recent turns, never from a guess. A mention already recorded
// is never resurrected: only turns after the last "Done. Recorded ..."
// line count as context.
// ---------------------------------------------------------------------------

const AMOUNT_QUESTION_RES = [
  /\bhow much\b[^.?]{0,60}\bpay\b/i,
  /\bhow much\b[^.?]{0,40}\bpaid\b/i,
  /\bwhat amount\b[^.?]{0,60}\b(pay|paid)\b/i,
];

export function isAmountQuestion(text) {
  const t = normalizeFastText(text);
  return AMOUNT_QUESTION_RES.some((re) => re.test(t));
}

// Parse a reply to an amount question: a bare amount ("637,820",
// "NGN 637,820", "five thousand"), a "full debts <amount>" /
// "full debt <amount>" / "full payment <amount>" lead with an amount
// after it (the amount IS the full balance the user is confirming),
// or the lead on its own ("full debts", "full payment") with no
// amount. Returns { amount, full } (amount null when the lead stands
// alone: the caller uses the customer's snapshot balance) or null
// when the message is not an amount answer at all ("Favour paid
// 5000" is a fresh statement, not an answer, and belongs to the
// payment parser).
export function parseAmountAnswer(text) {
  const t = normalizeFastText(text);
  let rest = t;
  let full = false;
  const lead = /^(the\s+)?(full\s+)?(debts?|payment|balance|amount)\b\s*/;
  if (lead.test(rest)) {
    full = /\bfull\b/.test(rest.match(lead)[0]);
    rest = rest.replace(lead, "").trim();
  } else if (/^full\b/.test(rest)) {
    full = true;
    rest = rest.replace(/^full\b\s*/, "").trim();
  }
  if (!rest) return full ? { amount: null, full: true } : null;
  const amounts = findAllAmounts(rest);
  if (amounts.length !== 1) return null;
  // The whole remainder must be that one amount (plus an optional
  // currency word or symbol): "637,820", "ngn 637,820", "five thousand".
  const before = rest.slice(0, amounts[0].index).trim();
  const after = rest.slice(amounts[0].index + amounts[0].length).trim();
  const leftover = (before + " " + after).trim().replace(/[^a-z]/g, "");
  if (leftover && !CURRENCY_WORDS.includes(leftover)) return null;
  return { amount: amounts[0].value, full };
}

// The customer an amount answer belongs to: the name in the question
// itself ("How much did Favour pay?"), else the last debtor talked
// about in the turns since the last "Done. Recorded ..." line.
// Returns the debtor object or null.
export function resolveAmountAnswerCustomer(history, snap) {
  const hist = history || [];
  let startIdx = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string" && /Done\. Recorded (payment|sale|expense)/.test(h.content)) {
      startIdx = i + 1;
      break;
    }
  }
  const recent = hist.slice(startIdx);
  const question = [...recent].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string" && isAmountQuestion(h.content));
  if (question) {
    const named = findDebtorsInText(question.content, snap);
    if (named.length === 1) return named[0];
  }
  return resolvePronounCustomer(recent, snap);
}

// ---------------------------------------------------------------------------
// Remind-a-debtor: "Remind Favour how much he owes", "Remind him of the
// balance on WhatsApp", "Send Favour a reminder", "WhatsApp Favour about
// his balance", "Chase Favour". A self-reminder ("remind me to ...") is
// never this; the draft flow ("draft/write a message") owns its own
// verbs and is checked separately.
// ---------------------------------------------------------------------------

export function isDebtorRemindRequest(text) {
  const t = normalizeFastText(text);
  if (/\bremind\s+(me|us)\b/.test(t)) return false;
  if (/\b(draft|write)\b/.test(t)) return false;
  const strongVerb = /\b(remind|chase|follow up|whatsapp)\b/.test(t);
  const remindContext = /\b(reminder|owe|owes|owing|balance|debt|pay|payment)\b/.test(t) || /\bon\s+whatsapp\b/.test(t);
  if (!/\b(remind|chase|follow up|whatsapp|message|send)\b/.test(t)) return false;
  // "remind/chase/whatsapp <name>" with a bare name is enough;
  // "message/send" need a reminder context, or "draft a message to X"
  // would be swallowed here.
  return strongVerb || remindContext;
}

// ---------------------------------------------------------------------------
// Snapshot product matching: the product name comes from the snapshot's
// product list, never from raw words around it. Case-insensitive,
// singular/plural tolerant, word-order tolerant for multi-word names,
// plus a bounded fuzzy match for close spellings. Returns the snapshot
// product or null (no guess, no tie: two equally close products is
// ambiguous, and the executor asks which one).
// ---------------------------------------------------------------------------

function productWords(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 1) return true;
  if (a.length >= 7 && b.length >= 7 && levenshtein(a, b) <= 2) return true;
  return false;
}

export function matchSnapshotProduct(name, products) {
  const want = productWords(name);
  if (!want.length || !(products || []).length) return null;
  const wantJoined = want.join(" ");
  let best = null;
  let bestScore = -1;
  let tied = false;
  for (const p of products) {
    const have = productWords(p.name);
    const haveJoined = have.join(" ");
    let score = -1;
    if (haveJoined === wantJoined) score = 100;
    else if (have.length <= want.length && have.every((w) => want.some((x) => wordsMatch(w, x)))) score = 90;
    else if (want.length === 1 && have.some((w) => wordsMatch(w, want[0]))) score = 70;
    else if (have.length > 1 && want.length > 1) {
      const shared = have.filter((w) => want.some((x) => wordsMatch(w, x))).length;
      if (shared === have.length - 1 && shared >= 1) score = 60;
    }
    if (score > bestScore) { best = p; bestScore = score; tied = false; }
    else if (score === bestScore && score >= 0) { tied = true; }
  }
  if (!best || bestScore < 0 || tied) return null;
  return best;
}

// Partial payments: "they paid for 2", "paid for 2 remaining 1 is
// Fortune", "owe for 1". Returns { paidQty, owedQty, debtorName }
// (owedQty and debtorName may be null) or null when the message states
// no paid-for count at all. The debtor comes only from the words in
// this message ("remaining 1 is Fortune", "Fortune owes the rest"),
// never from a guess.
function qtyWordToNumber(w) {
  const lw = String(w || "").toLowerCase();
  if (/^\d+$/.test(lw)) return Number(lw);
  return NUMBER_WORD_ONES[lw] !== undefined ? NUMBER_WORD_ONES[lw] : null;
}

export function parsePartialPayment(text) {
  const t = normalizeFastText(text);
  const paidMatch = t.match(/\bpaid\s+for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!paidMatch) return null;
  const paidQty = qtyWordToNumber(paidMatch[1]);
  if (paidQty === null) return null;
  let owedQty = null;
  const remainMatch = t.match(/\bremaining\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  const oweMatch = t.match(/\b(owe|owes|owing|owed)\s+(?:for\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (remainMatch) owedQty = qtyWordToNumber(remainMatch[1]);
  else if (oweMatch) owedQty = qtyWordToNumber(oweMatch[2]);
  let debtorName = null;
  const remainName = t.match(/\bremaining\s+(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:is\s+)?([a-z]+(?:\s+[a-z]+)?)\s*[.!?]*$/);
  if (remainName) {
    const words = remainName[1].trim().split(/\s+/);
    const stopIdx = words.findIndex((w) => ["and", "or", "but", "he", "she", "they", "it", "will", "would", "pay", "paid", "tomorrow", "today", "now", "for", "to"].includes(w));
    const clean = (stopIdx >= 0 ? words.slice(0, stopIdx) : words).join(" ").trim();
    if (clean && !isPronounWord(clean.split(" ")[0])) debtorName = titleCaseName(clean);
  }
  if (!debtorName) {
    const owesName = t.match(/\b([a-z]+(?:\s+[a-z]+)?)\s+owes\b/);
    if (owesName) {
      const name = owesName[1].trim();
      if (name && !isPronounWord(name.split(" ")[0])) debtorName = titleCaseName(name);
    }
  }
  return { paidQty, owedQty, debtorName };
}

// Strip a trailing "s" from a word when the singular matches a word in
// a snapshot product name, case-insensitive: "laptops" matches Laptop,
// "fvamails" matches Fvamail. The singular is only stripped when a
// snapshot product actually carries it, so a real plural name is never
// mangled.
export function normalizePluralProduct(name, products) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  const productWordsSet = new Set();
  for (const p of products || []) {
    for (const w of String(p.name || "").toLowerCase().split(/\s+/)) productWordsSet.add(w);
  }
  return words.map((w) => {
    const lw = w.toLowerCase();
    if (lw.length > 3 && lw.endsWith("s") && !lw.endsWith("ss") && productWordsSet.has(lw.slice(0, -1))) {
      return w.slice(0, -1);
    }
    return w;
  }).join(" ");
}

// Snapshot-aware sale: quantity, product (exact snapshot name), customer,
// "paid full" / "paid half" / "paid <amount>", and a stated payment
// method, all from one sentence. Returns { kind: "action", tool, params }
// or null when the message is not a snapshot-resolvable sale (bare chip,
// product not in the snapshot: the pure parser and the executor own
// those, so a product the snapshot does not carry still gets its
// executor not-found reply with the closest real names).
export function parseSaleSnapshot(text, history, snap, currency) {
  const t = normalizeFastText(text);
  if (!SALE_VERBS.test(t) || /\bexpense\b/.test(t)) return null;
  if (!snap || !snap.products || !snap.products.length) return null;
  const parsed = parseSaleMention(text);
  if (!parsed || !parsed.items || !parsed.items.length) return null;
  const items = [];
  const unitPrices = [];
  let total = 0;
  for (const it of parsed.items) {
    const match = matchSnapshotProduct(normalizePluralProduct(it.product, snap.products), snap.products);
    if (!match) return null;
    items.push({ product: match.name, qty: it.qty });
    unitPrices.push(Number(match.price) || 0);
    total += (Number(match.price) || 0) * it.qty;
  }
  total = Math.round(total * 100) / 100;
  const params = { items };
  let customerName = parsed.customer_name || "";
  if (customerName && isPronounWord(customerName.split(" ")[0])) {
    const debtor = resolvePronounCustomer(history, snap);
    customerName = debtor ? debtor.name : "";
  }
  if (customerName) params.customer_name = customerName;
  if (parsed.amount_paid !== undefined && parsed.amount_paid !== null) {
    params.amount_paid = parsed.amount_paid;
  } else if (parsed.paid_qty !== undefined && parsed.paid_qty !== null && items.length === 1) {
    // A partial payment: "paid for 2" of 3 laptops is 2 x the unit
    // price, with the rest owed. Never the full total.
    params.amount_paid = Math.round(unitPrices[0] * parsed.paid_qty * 100) / 100;
  } else if (/\bpaid\s+half\b/.test(t)) {
    params.amount_paid = Math.round((total / 2) * 100) / 100;
  } else if (/\b(paid|pay)\s+(in\s+)?full\b/.test(t) || /\bfull\s+price\b/.test(t)) {
    params.amount_paid = total;
  } else if (/\bpaid\b/.test(t)) {
    params.amount_paid = total;
  }
  if (parsed.payment_method) params.payment_method = parsed.payment_method;
  return { kind: "action", tool: "record_sale", params };
}

// ---------------------------------------------------------------------------
// Sale mentions: "Record a sale", "Sold 2 Rice to Mama Ngozi",
// "Record 2 Rice", "I sold 3 Fuel for 5000", "New sale 1 Laptop".
// ---------------------------------------------------------------------------

const SALE_VERBS = /\b(record|new|add|sold|sell|sale|sales|bought)\b/;
// "buy" (present tense) is deliberately NOT a sale verb: "I want to buy
// fuel" is the owner buying supplies (an expense), not a sale. Only the
// past tense "bought" reports a completed purchase.
// A buyer reporting what a customer did ("someone bought 5 fvamail") is
// a sale, not a payment or an expense: the buyer is never part of a
// product or customer name, and implies a walk-in customer.
const SALE_BUYER_WORDS = /\b(someone|somebody|some person|a new customer|new customer|a customer|anybody|anyone|some)\b/g;

// Words that can only ever be part of a question, never a product name.
// Used to stop a sales-history question ("what did we sell today?")
// becoming a product called "what did we".
const QUESTION_WORDS = new Set(["what", "which", "who", "whom", "whose", "when", "where", "why", "how", "many", "much", "did", "do", "does", "is", "are", "was", "were", "can", "could", "should", "would", "have", "has", "had", "we", "i", "you", "they", "he", "she", "it", "me", "us", "them", "him", "her", "his", "their", "my", "our", "your", "this", "that", "there", "here"]);

export function isQuestionWordsOnly(product) {
  const words = String(product || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, ""))
    .filter(Boolean);
  return words.length > 0 && words.every((w) => QUESTION_WORDS.has(w));
}

// Weekday and month names, shared by the date mention parser and the
// sale guard below. Month names cover full and abbreviated forms
// (jan, sept); "may" is a month only next to a day number, so the
// patterns that use this table always require one.
const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTH_NUMBERS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};
const MONTH_PATTERN = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const WEEKDAY_PATTERN = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

// Words that only ever point at a date, never at a product: a weekday
// or month name, "on", "of", or an ordinal suffix on its own ("2nd").
// A bare number is a date word too, but it never triggers a drop on
// its own: product names like "Product 1" reduce to a bare number
// after the filler strip, and that number is the product.
const DATE_WORDS = new Set([...WEEKDAY_NAMES, ...Object.keys(MONTH_NUMBERS), "on", "of", "last", "this", "next", "month", "year", "years"]);

export function isQuestionOrDateOnly(product) {
  const words = String(product || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (!words.length) return false;
  const isDateWord = (w) => DATE_WORDS.has(w) || /^\d+(st|nd|rd|th)?$/.test(w) || /^(st|nd|rd|th)$/.test(w);
  const isTriggerWord = (w) => QUESTION_WORDS.has(w) || DATE_WORDS.has(w)
    || /^(st|nd|rd|th)$/.test(w) || /^\d+(st|nd|rd|th)$/.test(w);
  return words.every((w) => QUESTION_WORDS.has(w) || isDateWord(w)) && words.some(isTriggerWord);
}

export function isQuestionText(text) {
  const t = normalizeFastText(text);
  return /^\s*(what|which|who|whom|whose|when|where|why|how)\b/.test(t) || /\?\s*$/.test(t);
}

// Time words and filler are never part of a product or customer name:
// "laptop now" is the product Laptop plus the word "now", never a
// product called "laptop now".
const SALE_TIME_WORDS = /\b(now|today|just|yesterday|recently|tonight|this morning|this afternoon|this evening)\b/g;

// Date phrases are never part of a product or customer name either:
// "2 laptops on Friday" is 2 Laptops plus the word "Friday", never a
// product called "laptops on friday". Stripped right after the time
// words, before the customer and product are read. A leading "on"
// goes with the date, so no dangling "on" is left behind to pollute
// the name. DD/MM/YYYY is the Nigerian convention, so "2/11/2026"
// is 2 November, never 11 February.
const SALE_DATE_PATTERNS = [
  new RegExp("\\b(?:on\\s+)?(?:last|this)\\s+(?:" + WEEKDAY_PATTERN + ")\\b", "g"),
  new RegExp("\\b(?:on\\s+)?(?:" + WEEKDAY_PATTERN + ")\\b", "g"),
  new RegExp("\\b(?:on\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:" + MONTH_PATTERN + ")\\b", "g"),
  new RegExp("\\b(?:on\\s+)?(?:" + MONTH_PATTERN + ")\\s+\\d{1,2}(?:st|nd|rd|th)?\\b", "g"),
  /\b(?:on\s+)?\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:on\s+)?\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  /\b(?:on\s+)?\d{1,2}-\d{1,2}-\d{4}\b/g,
  // Month phrases are never part of a product or customer name either:
  // "what did i sold last month" keeps no product at all, and "i sold
  // 2 laptops in october" keeps 2 Laptops. A leading "in" goes with
  // the month, so no dangling "in" is left behind.
  new RegExp("\\b(?:in\\s+)?(?:last|this|next)\\s+month\\b", "g"),
  new RegExp("\\b(?:in\\s+)?(?:" + MONTH_PATTERN + ")\\s+\\d{4}\\b", "g"),
  new RegExp("\\b(?:in\\s+)?(?:" + MONTH_PATTERN + ")\\b", "g"),
  // Year phrases are never part of a product or customer name either:
  // "what did i sold last year" keeps no product at all, and "i sold
  // 2 laptops in 2025" keeps 2 Laptops. The year pattern needs the
  // word "in": a bare "2025" in a statement ("i sold a laptop for
  // 2025") is an amount, not a year, and stays for the amount parser.
  // A bare year in a question ("what did i sold 2025?") is dropped by
  // the question-or-date guard below, which treats a plain number as
  // a date word.
  new RegExp("\\b(?:in\\s+)?(?:last|this|next)\\s+years?\\b", "g"),
  new RegExp("\\bin\\s+(?:the\\s+year\\s+)?(?:19|20)\\d{2}\\b", "g"),
];

// Payment methods the owner states in words. Only set when stated;
// never invented.
const SALE_METHODS = [
  [/\bin cash\b/, "cash"],
  [/\b(by|via)\s+transfer\b/, "transfer"],
  [/\bbank transfer\b/, "transfer"],
  [/\bpos\b/, "pos"],
];

export function parseSaleMention(text) {
  const t = normalizeFastText(text);
  if (!SALE_VERBS.test(t)) return null;
  // A count question is never a sale: "how many sales we sold today?"
  // is a read, and "how many" must never become a product name.
  if (/^\s*how many\b/.test(t)) return null;
  // A partial payment ("paid for 2", "remaining 1 is Fortune") is
  // read first, before the payment tail is stripped away below.
  const partial = parsePartialPayment(text);
  // A bought-only message is a sale only when a third party bought it
  // ("someone bought 5 fvamail", "he bought a laptop"): first-person
  // "I bought fuel" is the owner buying supplies, which the expense
  // step owns.
  if (isBoughtOnly(t) && !isBuyerSale(t) && !isPronounBuyerSale(t)) return null;
  let rest = t;
  // A leading acknowledgement ("Great, now record a sale") is discourse,
  // not a product: strip it before the sale is read.
  rest = rest.replace(/^(great|thanks|thank you|ok|okay|good|nice|hello|hi|hey)[,!\s]+/, "");
  // Time words out first: they pollute product and customer names.
  rest = rest.replace(SALE_TIME_WORDS, " ").replace(/\s+/g, " ").trim();
  // Date phrases out next, for the same reason: a date can never be
  // part of a product name, so "2 laptops on Friday" keeps 2 Laptops
  // and "what did i sold on friday" keeps no product at all.
  for (const re of SALE_DATE_PATTERNS) rest = rest.replace(re, " ");
  rest = rest.replace(/\s+/g, " ").trim();
  // An unnamed buyer is a walk-in, never a name: strip the buyer words
  // before the customer and product are read, so "someone bought 5
  // fvamail" leaves the product "5 fvamail" and no customer.
  rest = rest.replace(SALE_BUYER_WORDS, " ").replace(/\s+/g, " ").trim();
  // Payment method, when stated ("in cash", "by transfer"). Removed
  // before the customer and product are read.
  let paymentMethod = null;
  for (const [re, method] of SALE_METHODS) {
    if (re.test(rest)) { paymentMethod = method; rest = rest.replace(re, " "); }
  }
  rest = rest.replace(/\s+/g, " ").trim();
  // Amount paid: "paid <amount>" (digits or words) or a trailing
  // "for <amount>". A "paid full"/"paid in full"/"paid half" tail is
  // removed here but its amount is resolved by the snapshot-aware
  // parser, which knows the total; the pure parser leaves amount_paid
  // unset for it, and the executor defaults an unset amount to the
  // full total.
  let amountPaid = null;
  const paidMatch = rest.match(/\b(paid|pay)\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?/i);
  if (paidMatch) {
    const found = findAmounts(paidMatch[0]);
    if (found.length) amountPaid = found[0].value;
    rest = rest.replace(paidMatch[0], " ");
  } else {
    const paidWordTail = rest.match(/\b(paid|pay)\s+([a-z]+(?:\s+[a-z]+){0,5})/i);
    if (paidWordTail) {
      const found = findAllAmounts(paidWordTail[1]);
      if (found.length && found[0].index === 0) {
        amountPaid = found[0].value;
        rest = rest.replace(paidWordTail[0], "paid ");
      }
    }
    if (amountPaid === null) {
      const forAmount = rest.match(/\sfor\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?\s*$/i);
      if (forAmount) {
        const found = findAmounts(forAmount[0]);
        if (found.length) amountPaid = found[0].value;
        rest = rest.replace(forAmount[0], " ");
      } else {
        const forWord = rest.match(/\sfor\s+([a-z]+(?:\s+[a-z]+){0,5})\s*$/i);
        if (forWord) {
          const found = findAllAmounts(forWord[1]);
          if (found.length && found[0].index === 0) {
            amountPaid = found[0].value;
            rest = rest.replace(forWord[0], " ");
          }
        }
      }
    }
  }
  // Payment tail without an amount ("he paid full in cash", "she paid
  // half", "they pay full price", "paid"): remove it before the
  // customer is read, or "fortune he paid full" becomes the customer
  // name.
  rest = rest.replace(/\b(?:he|she|they|it|i|we)?\s*(paid|pay)\b.*$/, " ").replace(/\s+/g, " ").trim();
  // A "record it" tail is an instruction, never part of a name:
  // "I sold a laptop to Favour record it" is a sale to Favour.
  rest = rest.replace(/\brecord\s+(it|that|this|am)\b.*$/, " ").replace(/\s+/g, " ").trim();
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
  // A name stops at conjunctions and verbs: "to some and they pay full
  // price" is no customer at all (the buyer words were already
  // stripped), and a payment phrase never becomes the name.
  if (customerName) {
    customerName = customerName.split(/\b(and|or|but|pay|paid|record|they|he|she|it|for|to)\b/)[0].trim();
  }
  // The partial-payment debtor ("remaining 1 is Fortune") is the
  // customer when no "to <name>" named one.
  if (!customerName && partial && partial.debtorName) customerName = partial.debtorName;
  // Remove the sale verbs and filler, then split into item segments.
  // "another" is filler too ("sold another laptop" is one Laptop).
  // A dangling "to"/"for" left behind when the buyer words were stripped
  // ("sold a laptop to somebody" -> "sold a laptop to") is dropped here,
  // so it never lands in a product name.
  rest = rest
    .replace(/\b(record|new|add|sold|sell|sale|sales|bought|of|the|a|an|please|kindly|just|item|items|product|i|we|another|he|she|they|him|her|them)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\s*\b(to|for|and)\b\s*)+$/, "")
    .trim();
  const items = [];
  if (rest) {
    const segments = rest.split(/\s*,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const qm = seg.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (qm) {
        items.push({ product: qm[2].trim(), qty: Number(qm[1]) });
      } else {
        // Word quantity: "one laptop", "two rice", "a laptop".
        const wqm = seg.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(.+)$/);
        if (wqm) {
          const q = wqm[1] === "a" || wqm[1] === "an" ? 1 : NUMBER_WORD_ONES[wqm[1]];
          items.push({ product: wqm[2].trim(), qty: q });
        } else if (!/^(to|for|paid)\b/.test(seg)) {
          items.push({ product: seg, qty: 1 });
        }
      }
    }
  }
  // A question is never a product: drop any item made only of question
  // words plus date words ("what did we sold today?" leaves "what did
  // we", "what did i sold on friday?" leaves "what did on"), and when a
  // question leaves nothing, return null so it never reaches the product
  // search. A bare "record a sale" is not a question, so its empty items
  // still flow to the executor's one targeted question.
  const keptItems = items.filter((it) => !isQuestionOrDateOnly(it.product));
  if (keptItems.length !== items.length) {
    if (!keptItems.length && isQuestionText(t)) return null;
    items.splice(0, items.length, ...keptItems);
  }
  // A lone payment/expense word is not a product ("record a payment" is
  // not a sale of one "payment"). Let the model ask for the details.
  if (items.length === 1 && /^(payment|paid|expense|expenses|reminder|reminders?)$/.test(items[0].product)) return null;
  // A bare "record a sale" is a real intent with no details yet: return
  // empty items so the executor asks its one targeted question.
  const params = { items };
  if (customerName) params.customer_name = titleCaseName(customerName);
  if (amountPaid !== null) params.amount_paid = amountPaid;
  if (paymentMethod) params.payment_method = paymentMethod;
  // A partial payment ("paid for 2 of 3") carries the paid count; the
  // snapshot-aware parser turns it into an amount from the price.
  if (partial && partial.paidQty !== null && partial.paidQty !== undefined) params.paid_qty = partial.paidQty;
  return params;
}

// ---------------------------------------------------------------------------
// Expense mentions: "Record an expense", "Record expense 5000 for fuel",
// "Spent 5000 on fuel", "Add expense fuel 600".
// ---------------------------------------------------------------------------

const EXPENSE_VERBS = /\b(record|add|spent|spend|expense|expenses|bought)\b/;

// "I gave <recipient> <amount> (for <purpose>)": an expense, never a
// customer payment, unless the recipient matches a snapshot debtor.
// "I gave my staff 2000 for feeding" is staff feeding; "I gave tax
// collectors 200 in the morning" is tax; "I gave the cleaner 1500
// today" is the cleaner. Money given TO the owner ("Favour gave me
// 5000") is not this: the recipient is the owner, so it stays a
// payment, and a debtor as the giver stays a payment from them.
// Names the business already knows as customers: debtors (balance > 0)
// plus anyone a recent sale was made to. The snapshot carries debtors
// only, so a zero-balance customer like Favour would otherwise look
// like a stranger. Used by the give-expense route: giving money TO a
// known customer is a payment, never an expense.
function isKnownCustomerName(name, snap) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  const debtors = (snap && snap.debtors) || [];
  if (debtors.some((d) => String(d.name || "").toLowerCase() === n)) return true;
  const recent = (snap && snap.recentSales) || [];
  if (recent.some((s) => String(s.customer || "").toLowerCase() === n)) return true;
  return false;
}

export function parseGiveExpense(text, snap) {
  const t = normalizeFastText(text);
  const giveMatch = t.match(/\b(give|gave|given)\b/);
  if (!giveMatch) return null;
  const giveIdx = giveMatch.index;
  // A debtor giving money is a payment from them, not an expense.
  const giverPart = t.slice(0, giveIdx);
  if (findDebtorsInText(giverPart, snap).length) return null;
  const amounts = findAllAmounts(t);
  if (!amounts.length) return null;
  const amount = amounts[0];
  // The recipient sits between the give verb and the amount.
  let before = t.slice(giveIdx + giveMatch[0].length, amount.index);
  let after = t.slice(amount.index + amount.length);
  let recipient = before
    .replace(/\b(to|for|the|a|an|my|our|please|kindly|i|we)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!recipient) {
    // "I gave 2000 to my staff": the recipient follows the amount.
    const toMatch = after.match(/\bto\s+([a-z][a-z' ]+?)(?:\s+for\s+.*)?$/);
    if (toMatch) recipient = toMatch[1].trim();
  }
  if (!recipient) return null;
  // "me"/"us" as the recipient is money coming TO the owner: a payment
  // received, never an expense. A known customer as the recipient is a
  // payment to them, and the payment parser owns it.
  if (/^(me|us)$/.test(recipient)) return null;
  if (isKnownCustomerName(recipient, snap)) return null;
  // The purpose follows "for"; a "record it" tail is not part of it.
  let purpose = "";
  const forMatch = after.match(/\bfor\s+(.+)$/);
  if (forMatch) {
    purpose = forMatch[1].replace(/\brecord\s+(it|that|this|am)\b.*$/, "").trim();
  }
  const description = cleanExpenseDescription((recipient + " " + purpose).trim());
  if (!description) return null;
  return { amount: amount.value, description };
}

// "I paid the 3 staff today 40k" is a staff salary: 40k EACH, so the
// total is 40,000 x 3. "I paid my staff 40000" is one lump sum.
// "I paid the staff 40k" with no count is genuinely ambiguous, so ask
// whether it is each or for all, never guess. When the count in the
// message differs from the snapshot's staff count, the proposal says so
// instead of silently correcting the number.
export function parseStaffPayment(text, snap, currency) {
  const t = normalizeFastText(text);
  if (!/\bpaid\b/.test(t) || !/\bstaff\b/.test(t)) return null;
  if (!/\b(i|we)\b/.test(t)) return null;
  const amounts = findAllAmounts(t);
  if (!amounts.length) return null;
  const staffIdx = t.indexOf("staff");
  const countMatch = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+staff\b/);
  let countValue = null;
  if (countMatch) {
    const c = countMatch[1];
    countValue = /^\d+$/.test(c) ? Number(c) : NUMBER_WORD_ONES[c];
  }
  // The money amount is the amount after the staff word (the count
  // number before "staff" is not money).
  const afterStaff = amounts.filter((a) => a.index > staffIdx);
  const money = afterStaff.length ? afterStaff[afterStaff.length - 1] : amounts[amounts.length - 1];
  if (!money || !(money.value > 0)) return null;
  const rawTok = t.slice(money.index, money.index + money.length);
  if (countValue !== null && countValue > 0) {
    const total = Math.round(money.value * countValue * 100) / 100;
    const staffCount = snap && Number.isFinite(Number(snap.staffCount)) ? Number(snap.staffCount) : null;
    const note = staffCount !== null && staffCount !== countValue
      ? `business shows ${staffCount} staff members`
      : null;
    const description = note
      ? `Staff salary for ${countValue} staff (${note})`
      : `Staff salary for ${countValue} staff`;
    return { params: { amount: total, description, category: "Staff/Salary" } };
  }
  if (/\bmy staff\b/.test(t)) {
    return { params: { amount: money.value, description: "Staff salary", category: "Staff/Salary" } };
  }
  return { question: `Is that ${rawTok} each or ${rawTok} for all?` };
}

export function parseExpenseMention(text, snap) {
  const t = normalizeFastText(text);
  // "give/gave <recipient> <amount> (for <purpose>)" is an expense
  // with no expense verb in it.
  const give = parseGiveExpense(text, snap);
  if (give) return give;
  // "I paid 2000 for fuel" is an expense, not a payment from a customer
  // called "I": first-person "paid ... for ..." counts as an expense
  // verb here. "I paid <expense-word> <amount>" ("I paid rent today
  // 70000", "I paid light 5000") is one too. Any other "paid" without
  // the word "expense" stays a payment (the guard below), so "Favour
  // paid 5000" never lands here.
  const firstPersonPaidFor = /\b(i|we)\s+paid\b/.test(t) && /\bfor\b/.test(t);
  const firstPersonPaidExpense = /\b(i|we)\s+(paid|pay)\b/.test(t)
    && t.split(/\s+/).some((w) => EXPENSE_WORDS.has(w.replace(/[^a-z]/g, "")));
  if (!EXPENSE_VERBS.test(t) && !firstPersonPaidFor && !firstPersonPaidExpense) return null;
  // Must be an expense intent, not a sale or payment. "bought" alone does
  // not block the expense parser: "I bought fuel" is an expense, while
  // "someone bought 5 fvamail" is a sale only because the bought item
  // matches a snapshot product, which the sale step (step 11, before
  // this one) already claimed. A non-bought sale verb does block it.
  if (/\b(record|new|add|sold|sell|sale|sales)\b/.test(t) && !/\bexpense\b/.test(t)) return null;
  if (PAYMENT_VERBS.test(t) && !/\bexpense\b/.test(t) && !firstPersonPaidFor && !firstPersonPaidExpense) return null;
  const amounts = findAllAmounts(t);
  let amount = null;
  let rest = t;
  if (amounts.length) {
    amount = amounts[0].value;
    rest = removeAmount(t, amounts[0]);
  }
  const strip = firstPersonPaidFor || firstPersonPaidExpense
    ? /\b(record|add|spent|spend|expense|expenses|bought|paid|pay|an|the|a|please|kindly|just|for|on|of|to|i|we|today|yesterday|now)\b/g
    : /\b(record|add|spent|spend|expense|expenses|bought|an|the|a|please|kindly|just|for|on|of|to)\b/g;
  rest = rest
    .replace(strip, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  const description = cleanExpenseDescription(rest);
  // "I bought 5 fvamail" is 5 of a product, not 5 of money: when the
  // bought thing matches a snapshot product, the amount is a quantity
  // times the snapshot price. A money amount after the product name
  // ("I bought 5 fvamail for 2500") wins over the computed one. A
  // number inside the product name itself ("Rice 5kg") is never money.
  if (snap && /\bbought\b/.test(t) && description) {
    const match = matchSnapshotProduct(description, (snap.products || []));
    if (match) {
      const firstWord = match.name.toLowerCase().split(" ")[0];
      const prodIdx = t.indexOf(firstWord);
      const nameEnd = prodIdx >= 0 ? prodIdx + match.name.length : -1;
      const moneyAmounts = amounts.filter((a) => a.index >= nameEnd);
      const qtyAmounts = amounts.filter((a) => prodIdx >= 0 && a.index + a.length <= prodIdx);
      if (moneyAmounts.length) {
        amount = moneyAmounts[moneyAmounts.length - 1].value;
      } else if (qtyAmounts.length) {
        amount = Math.round(qtyAmounts[0].value * (Number(match.price) || 0) * 100) / 100;
      }
    }
  }
  return { amount, description };
}

// First-person "paid" expenses, for the early-expense step that runs
// before the payment intent: "I paid rent today 70000", "I paid 2000
// for fuel", "I paid light 5000". Staff is owned by parseStaffPayment,
// which runs first.
export function parseFirstPersonExpense(text, snap) {
  const t = normalizeFastText(text);
  if (!/\b(i|we)\s+(paid|pay)\b/.test(t)) return null;
  if (/\bstaff\b/.test(t)) return null;
  return parseExpenseMention(text, snap);
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
    .replace(/\b(how|much|does|do|is|what|the|a|an|check|show|tell|me|for|please|kindly|anything|owe|owes|owing|balance|debt|outstanding|left|still|log|activity)\b/g, " ")
    .replace(/'s/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  if (/^(customers?|everyone|anybody|anyone|everybody)$/.test(rest)) return null;
  // A number in the remainder is never part of a customer name
  // ("Full debt 637,820" is an amount answer, not a customer called
  // "Full 637,820"): let the amount-answer and bare-confirmation
  // paths own it instead of asking the database for a nonsense name.
  if (/\d/.test(rest)) return null;
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
  if (!/\b(draft|write|message|text|remind|reminder|chase|follow up)\b/.test(t)) return null;
  if (!/\b(to|for)\b/.test(t) && !/\bremind\b/.test(t)) {
    // A bare "Message Favour" / "Text Ada" names the customer right
    // after the verb, with no "to" or "for". Anything longer than a
    // name is not one.
    const bare = t.match(/^\s*(message|text|draft|write)\s+([a-z][a-z' ]+?)\s*[.!?]*$/);
    if (!bare) return null;
    const words = bare[2].trim().split(/\s+/);
    if (words.length > 4) return null;
    // "Message me the sales" is not a draft to a customer called
    // "Me The Sales": a name never starts with a pronoun or a thing.
    if (["me", "us", "it", "that", "this", "him", "her", "them", "my", "our", "sales", "sale", "expense", "payment", "reminder"].includes(words[0])) return null;
    return { customer_name: titleCaseName(bare[2].trim()), tone: "polite" };
  }
  let tone = "polite";
  if (/\b(final|last warning|last reminder)\b/.test(t)) tone = "final";
  else if (/\b(firm|strong|serious|strict)\b/.test(t)) tone = "firm";
  let rest = t
    .replace(/\b(draft|write|message|remind|reminder|chase|follow up|a|an|the|please|kindly|to|for|about|their|his|her|he|she|him|them|it|how|much|what|on|of|whatsapp|send|debt|balance|payment|pay|paying|owe|owes|owing|firm|strong|serious|strict|final|last warning|last reminder|polite|friendly)\b/g, " ")
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
// The name is taken from the raw (original-case) text, never lowercased
// and never title-cased: "GOU project" stays "GOU project" and "gou
// project" stays "gou project". Only the type and goal detection use
// the normalized text. Name-introducing filler ("with the name",
// "name it", "named", "called", ...) is stripped FIRST, so it can
// never survive into the name the way "With Name Gou" and "Name It
// Gou" did live (round 5 code lowercased everything, then title-cased
// the leftover filler).
export function parseProjectPlan(text) {
  const raw = String(text || "").trim();
  const t = normalizeFastText(text);
  if (!/\b(create|new|start|plan)\b/.test(t) || !/\bproject\b/.test(t)) return null;
  let type = "";
  for (const pt of PROJECT_TYPES) {
    if (new RegExp("\\b" + pt + "\\b").test(t)) { type = pt; break; }
  }
  // Goal first, from the raw text with the same two shapes the old
  // normalized parse used ("... to <goal>", "... goal is <goal>"), so
  // the goal keeps the words as typed. The goal span is cut out of the
  // raw rest before the name is read.
  let rest = raw;
  let goal = "";
  const goalMatch = rest.match(/\bto\s+([a-z][a-z' ]+?)\s*$/i);
  if (goalMatch) {
    goal = goalMatch[1].trim();
    rest = rest.replace(goalMatch[0], " ");
  } else {
    const goalWord = rest.match(/\bgoal\s*(is|:)?\s*(.+)$/i);
    if (goalWord) {
      goal = goalWord[2].trim();
      rest = rest.replace(goalWord[0], " ");
    }
  }
  // Name-introducing filler, longest first, so "with the name" is gone
  // before the bare words are read. Case-insensitive; the name itself
  // keeps its original capitals.
  rest = rest
    .replace(/\bwith\s+the\s+name\b/gi, " ")
    .replace(/\bwith\s+name\b/gi, " ")
    .replace(/\bname\s+it\b/gi, " ")
    .replace(/\bname\s+is\b/gi, " ")
    .replace(/\bname\s*:/gi, " ")
    .replace(/\bnamed\b/gi, " ")
    .replace(/\bcalled\b/gi, " ")
    .replace(/\bcall\s+it\b/gi, " ")
    .replace(/\btitled\b/gi, " ");
  // The word "project" is stripped exactly ONCE: the one that named the
  // intent. Stripping it everywhere would eat it out of the name
  // itself ("GOU project" would become "GOU").
  rest = rest.replace(/\bproject\b/i, " ");
  rest = rest
    .replace(/\b(create|new|start|plan|a|an|the|please|kindly|business|event|charity|construction|custom)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  const name = rest;
  if (!name && !type && !goal) return null;
  return { name, type, goal };
}

// Project interview continuation: the executor asks one missing field
// at a time ("What type of project is "X"? Choose one: ..." then
// "What is the goal of "X"? ..."), but the fast path kept no pending
// state, so a bare "Business" answer fell to the model and failed.
// This step reads the last bot question from the recent history and
// answers it deterministically, never via the model:
// - a bare project-type word after the type question returns the
//   create action with that type, so the executor asks for the goal;
// - any message after the goal question IS the goal, with the name
//   from the question and the type from the earlier bare-type turn,
//   so the executor proceeds to the dry-run proposal.
// Confirm-first is unchanged: both steps only ever return an action,
// which the executor dry-runs into a proposal card. A message that is
// itself a new project creation is a fresh intent, not a goal answer.
const PROJECT_TYPE_QUESTION_RE = /What type of project is "([^"]+)"\? Choose one: construction, event, charity, business, custom\./;
const PROJECT_GOAL_QUESTION_RE = /What is the goal of "([^"]+)"\? Tell me what success should look like\./;

export function findProjectInterviewAnswer(text, history) {
  const hist = history || [];
  let lastAssistant = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string") {
      lastAssistant = h.content;
      break;
    }
  }
  if (!lastAssistant) return null;
  const typeQ = lastAssistant.match(PROJECT_TYPE_QUESTION_RE);
  if (typeQ) {
    const answer = normalizeFastText(text).replace(/[.!?]+$/, "").trim();
    if (!PROJECT_TYPES.includes(answer)) return null;
    return { kind: "action", tool: "create_project_plan", params: { name: typeQ[1], type: answer, goal: "" } };
  }
  const goalQ = lastAssistant.match(PROJECT_GOAL_QUESTION_RE);
  if (goalQ) {
    // A fresh creation sentence is a new project, not this one's goal.
    if (parseProjectPlan(text)) return null;
    const goal = String(text || "").trim();
    if (!goal) return null;
    // The type is the bare type word the user gave after the type
    // question. Without it the executor asks for the type again, so
    // the interview still never falls to the model.
    let type = "";
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i];
      if (h && h.role === "assistant" && typeof h.content === "string" && PROJECT_TYPE_QUESTION_RE.test(h.content)) {
        for (let j = i + 1; j < hist.length; j++) {
          const u = hist[j];
          if (u && u.role === "user" && typeof u.content === "string") {
            const w = normalizeFastText(u.content).replace(/[.!?]+$/, "").trim();
            if (PROJECT_TYPES.includes(w)) type = w;
            break;
          }
        }
        break;
      }
    }
    return { kind: "action", tool: "create_project_plan", params: { name: goalQ[1], type, goal } };
  }
  return null;
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

export const RECORD_IT_RE = /^\s*(?:(and|so|then|please|kindly|ok|okay)[,!\s]+)?(record it now|record that now|record it|record that|record am|record this|do it|go ahead and record|yes record|record the payment|record the sale|record the expense)\s*[.!?]*\s*$/i;

export function isRecordIt(text) {
  return RECORD_IT_RE.test(String(text || "").trim());
}

// Most recent unrecorded mention in the history (last 6 user turns).
// Returns { kind: "payment"|"sale"|"expense", ...parsed },
// { kind: "question", text } when the mention is genuinely ambiguous
// (the staff each-or-all question), or null.
// With a snapshot, a full-balance mention ("Favour paid in full") also
// resolves, taking its amount from the snapshot. Expense shapes run
// before the payment parse on purpose: "I gave my staff 2000 for
// feeding" and "I paid rent today 70000" are expenses, and the payment
// parser would otherwise swallow them as customers called "I My Staff"
// and "I Rent".
export function findPendingMention(history, snap, currency) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-6);
  for (let i = turns.length - 1; i >= 0; i--) {
    const content = turns[i].content;
    const payment = parsePaymentMention(content);
    const staffPay = parseStaffPayment(content, snap, currency);
    if (staffPay && staffPay.params) return { kind: "expense", ...staffPay.params };
    if (staffPay && staffPay.question) return { kind: "question", text: staffPay.question };
    // A real payment still wins over the first-person expense shape:
    // "I paid Favour 5000 for transport" pays Favour. The give shape
    // runs first: it already returns null for a known-customer
    // recipient, so "I gave the cleaner 1500" is an expense while
    // "I gave Favour 5000" still reaches the payment below.
    const giveExpense = parseGiveExpense(content, snap);
    if (giveExpense) return { kind: "expense", ...giveExpense };
    if (!payment) {
      const firstExpense = parseFirstPersonExpense(content, snap);
      if (firstExpense && (firstExpense.amount || firstExpense.description)) return { kind: "expense", ...firstExpense };
    }
    if (payment) return { kind: "payment", ...payment };
    if (snap) {
      const full = parseFullBalanceMention(content, history, snap);
      if (full && full.amount > 0) return { kind: "payment", customer_name: full.customer_name, amount: full.amount };
    }
    const sale = parseSaleMention(content);
    if (sale && sale.items && sale.items.length) return { kind: "sale", ...sale };
    const expense = parseExpenseMention(content, snap);
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
  // Day report: "Get me yesterday report" is a report for one day,
  // never the model. The day is resolved by the step, from the words.
  if (includesAny(t, ["get me yesterday report", "get me today's report", "get me todays report", "show me yesterday's report", "show me yesterday report", "give me the report for yesterday", "give me yesterday's report", "yesterday's report", "report for yesterday", "report for today", "today's report", "todays report", "get report yesterday", "get report today", "report yesterday", "report today", "yesterday report", "today report", "get yesterday report", "get today report", "show me today report", "show me today's report", "show me todays report", "get me today report", "get me yesterday's report"])) return "dayreport";
  // A month report in any word order: "Get report last month sales",
  // "Get the report for last month", "Show me last month report",
  // "Report for October", "Monthly report". The month is resolved by
  // the step, from the words.
  if (/\breport\b/.test(t) && (/\b(last|this|next)\s+month\b/.test(t) || /\bmonthly report\b/.test(t) || /\bsales report\b/.test(t)) && !/^\s*report\s+(a\s+|the\s+)?(sale|expense|payment)\b/.test(t)) return "monthreport";
  // Month report: "Get me last month report" is a report for one
  // month, same shape as the day report. The month is resolved by the
  // step, from the words.
  if (includesAny(t, ["get me last month report", "get me this month report", "get me the report for last month", "get me the report for this month", "show me last month's report", "show me last month report", "show me this month's report", "show me this month report", "give me last month's report", "give me the report for last month", "last month's report", "last month report", "this month's report", "this month report", "report for last month", "report for this month"])) return "monthreport";
  // A named-month report: "Get me October report", "Report for
  // October 2026". The month is resolved by the step.
  if (/report\s+(for\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/.test(t)) return "monthreport";
  // A week report: "Get me this week report", "Last week report",
  // "Report for last week", "Weekly report". The week is resolved by
  // the step.
  if (/\breport\b/.test(t) && (/\b(this|last)\s+week\b/.test(t) || /\bweekly report\b/.test(t)) && !/^\s*report\s+(a\s+|the\s+)?(sale|expense|payment)\b/.test(t)) return "weekreport";
  if (includesAny(t, ["this week's report", "this weeks report", "last week's report", "last weeks report"])) return "weekreport";
  // A year report: "Get me last year report", "This year report",
  // "Report for 2025", "Yearly report". The year is resolved by the
  // step.
  if (/\breport\b/.test(t) && (/\b(last|this|next)\s+year\b/.test(t) || /\bin\s+(?:the\s+year\s+)?(?:19|20)\d{2}\b/.test(t) || /\bfor\s+(?:19|20)\d{2}\b/.test(t) || /\byearly report\b/.test(t) || /\bannual report\b/.test(t)) && !/^\s*report\s+(a\s+|the\s+)?(sale|expense|payment)\b/.test(t)) return "yearreport";
  // Today's activity: a day report from the snapshot, never the model.
  // "Check today's activity", "What happened today", "What did I do
  // today". Yesterday's activity is the same report for yesterday.
  if (includesAny(t, ["check today's activity", "check todays activity", "check today activity", "today's activity", "todays activity", "today activity", "what happened today", "what did i do today", "what did we do today", "what have i done today", "what have we done today", "show today's activity", "show todays activity", "show me today's activity"])) return "todayactivity";
  if (includesAny(t, ["check yesterday's activity", "check yesterdays activity", "check yesterday activity", "yesterday's activity", "yesterdays activity", "yesterday activity", "what happened yesterday", "what did i do yesterday", "what did we do yesterday", "show yesterday's activity", "show me yesterday's activity"])) return "yesterdayactivity";
  // The plan this business is on: the snapshot tier answers it inside
  // Ask Kopa AI, never Kopa Support. Runs before the advice check on
  // purpose: "what plan am I on" contains the word "plan".
  if (/what (plan|tier|subscription) (am i|are we) on\b/.test(t) || /which (plan|tier) (am i|are we) on\b/.test(t) || /\bwhat is my (plan|tier|subscription)\b/.test(t) || /\bam i on (the )?(free|starter|solo|pro)( plan| tier)?\b/.test(t) || /\bwhich plan do i have\b/.test(t) || /\bmy current (plan|tier)\b/.test(t)) return "myplan";
  // Business advice and planning: snapshot-based, never the model and
  // never Support. "Let's plan" on its own is business planning, not a
  // project to create: when the message also names a project, the
  // project step owns it instead.
  if (!/\bproject\b/.test(t) && includesAny(t, ["advice me", "advise me", "advice", "advise", "how to improve", "improve my business", "improve our business", "improve the business", "business improvement", "let's plan", "lets plan", "let us plan", "plan for our business", "plan my business", "plan our business", "grow my business", "grow our business"])) return "advice";
  if (/\bproject\b/.test(t) && includesAny(t, ["advice me", "advise me", "how to improve", "improve my business", "improve our business", "improve the business", "business improvement", "plan for our business", "plan my business", "plan our business", "grow my business", "grow our business"])) return "advice";
  // Activity log: staff logins and logouts with exact times, from the
  // log. "log activity" / "activity log" is the history, never a
  // customer called "Log".
  if (includesAny(t, ["log activity", "activity log", "activity history", "staff login", "staff logins", "who logged in", "who log in", "who logged out", "when did my staff log", "staff logout", "staff log out", "login history", "logins today", "logged in today", "logged out"])) return "activitylog";
  // Inventory value: what everything in store is worth at selling
  // price. Runs before the stock read on purpose: "what is my stock
  // worth" contains the word "stock" and would otherwise list stock.
  // "At cost" questions are excluded here: they go to the stockcost
  // read below, which answers honestly that no cost figure exists.
  // Without the exclusion, "how much is my stock worth" would swallow
  // "how much is my stock worth at cost".
  if (!/\bat cost\b/.test(t) && includesAny(t, ["how much total does i have in products", "how much total in products", "total in products", "inventory value", "total stock value", "stock value", "how much does everything in store worth", "everything in store worth", "what is my stock worth", "how much is my stock worth", "total value of my products", "what are my products worth", "how much are my products worth", "value of my products", "products worth", "everything in the store worth", "what is everything worth"])) return "inventoryvalue";
  // Stock value at cost: there is no cost figure, so this is an honest
  // no-cost answer plus the selling-price value, never the plain
  // inventory value. Runs before the inventory value read would swallow
  // it: "worth at cost" contains "stock worth".
  if (/\bworth at cost\b/.test(t) || /\bat cost\b/.test(t) && /\bstock\b/.test(t)) return "stockcost";
  // What the owner owes suppliers: never the debtors list, which is
  // what customers owe the business, the opposite direction.
  if (includesAny(t, ["what are my debts", "what debts do i have", "what debts do we have", "how much do i owe suppliers", "how much do we owe suppliers", "how much do i owe my suppliers", "how much do i owe the suppliers", "do i owe suppliers", "my supplier debts", "supplier debts", "what do i owe suppliers"])) return "mydebts";
  // Yes/no existence questions ("Do I have staff?"): answered from
  // the snapshot counts. Runs before the debtors read on purpose:
  // "do i have any debtors" contains the word "debtors" and would
  // otherwise list them instead of answering yes or no.
  if (includesAny(t, ["do i have staff", "do we have staff", "do i have any staff", "do we have any staff", "do i have customers", "do we have customers", "do i have any customers", "do we have any customers", "do i have products", "do we have products", "do i have any products", "do we have any products", "do i have debtors", "do we have debtors", "do i have any debtors", "do we have any debtors", "do i have sales", "do we have sales", "do i have any sales", "do we have any sales", "do i have projects", "do we have projects", "do i have any projects", "do we have any projects", "do i have expenses", "do we have expenses", "do i have any expenses", "do we have any expenses"])) return "yesno";
  // Who owes the most, and the total owed: from the debtors list.
  // Runs before the debtors read on purpose: "who owes the most"
  // contains "who owes" and would otherwise list every debtor.
  if (includesAny(t, ["who owes the most", "who owes most", "who is the biggest debtor", "biggest debtor", "largest debtor", "who owes the highest", "who owes the largest amount"])) return "topdebtor";
  if (includesAny(t, ["how much am i owed in total", "how much am i owed", "how much are we owed", "how much are we owed in total", "total owed to me", "total amount owed to me", "how much do customers owe me in total", "how much do they owe me in total"])) return "totalowed";
  // Overdue: KopaBook sets no due dates, so the answer lists last
  // activity instead of inventing a due date. Runs before the debtors
  // read: "who is overdue" is about the debtors, not the whole list.
  if (includesAny(t, ["who is overdue", "who are overdue", "overdue debts", "overdue customers", "overdue payments", "who has overdue", "any overdue"])) return "overdue";
  if (includesAny(t, ["who owes", "who owe", "who dey owe", "who is owing", "who is owed", "debtors", "customers owing", "who owes me", "who owes us", "who still owes", "anyone owing", "who has not paid", "who hasn't paid", "unpaid customers"])) return "debtors";
  if (includesAny(t, ["low stock", "running low", "running out", "out of stock", "low on stock", "almost finished", "almost out", "stock alert", "stock alerts", "what needs restocking", "what should i restock", "anything running low", "what is out of stock", "need to restock", "needs restocking"])) return "lowstock";
  // Staff names: the snapshot now carries the staff list with roles.
  // Runs before the stock read: "show me my staff" contains no stock
  // word, but the names question must never fall to the model.
  if (includesAny(t, ["show me my staff", "show my staff", "show me our staff", "list my staff", "list our staff", "list the staff", "who works for me", "who works for us", "who works here", "what are my staff names", "what are the staff names", "names of my staff", "staff names", "my staff names", "who are my staff", "who are the staff", "what is the name of the staff", "what is the name of my staff", "name of the staff", "names of the staff", "name of my staff", "names of my staff"])) return "staffnames";
  // A bare names question ("What is there names", "What is the
  // name?"): the step checks the thread for what "their" or "the
  // name" refers to (the staff question just asked), so this only
  // classifies here and the step asks when there is no staff context
  // at all.
  if (/^\s*what (is|are) (their|there) names?\s*[.!?]*$/.test(t) || /^\s*what is (the|his|her) names?\s*[.!?]*$/.test(t) || /^\s*(their|there|his|her) names?\s*[.!?]*$/.test(t) || /^\s*what are the names\s*[.!?]*$/.test(t) || /^\s*who are they\s*[.!?]*$/.test(t) || /^\s*name them\s*[.!?]*$/.test(t)) return "staffnames";
  // One product's price: "How much is a laptop?" Runs before the
  // stock read: the question names one product, not the whole stock.
  if (/^\s*how much (is|are)\s+/.test(t) && !/\b(stock|plan|subscription|delivery|month|week|year|today|yesterday|sales|expenses|profit)\b/.test(t)) return "productprice";
  // One product's stock: "How many laptops do I have in stock?"
  // Runs before the stock read, so one product answers with its own
  // count instead of the whole stock list. "How many products in
  // stock" is the whole list, so it stays on the stock read.
  if (/^\s*how many\b/.test(t) && /\bin stock\b/.test(t) && !/\bproducts?\b/.test(t)) return "productstock";
  if (includesAny(t, ["stock", "inventory", "how much stock", "what do we have in stock", "check stock", "stock levels", "stock level"])) return "stock";
  // Product list: the snapshot already carries every product with price
  // and stock, so this is a read, never a model call. formatStock lists
  // them, so "show my stock" keeps answering exactly as it does today.
  // Bare "My products" only counts as a whole message: "what is the best
  // way to price my products?" is a pricing question, not a list request.
  if (includesAny(t, ["list out my products", "list out our products", "list out products", "list out the products", "list my products", "list our products", "show me my products", "show my products", "show our products", "show me our products", "show me the products", "list the products", "list products", "show products", "what products do i have", "what products have i", "what products", "product list", "products list"])) return "products";
  // Customer list: the snapshot carries only the debtors (customers with
  // a balance), so that is the list it can answer with. A full customer
  // list needs the snapshot to carry all customers; it does not yet, and
  // this must never invent customers to fill the gap.
  if (includesAny(t, ["list my customers", "show my customers", "who are my customers", "list customers", "show customers", "customer list", "customers list", "list out my customers", "list out customers", "list out the customers"])) return "customers";
  // Project list (plural "projects" + list/show/what/my). A single
  // project report ("how is the browser apk project doing") is singular
  // "project" and stays on the project_report path below. The bare
  // singular "project list" is a list, not a report: it has the word
  // "list" and no report verb, so it belongs here, never the model.
  if (includesAny(t, ["what projects are do i have", "what projects do i have", "list my projects", "show my projects", "list projects", "show projects", "what projects", "projects list", "project list", "list out my projects", "list out projects", "list out the projects"])) return "projects";
  // Bare "<thing> list" as a whole message, singular or plural, with
  // or without "my": "project list", "product list", "customer list",
  // "sales list", "expense list", "staff list". The snapshot now
  // carries staff names, so "staff list" answers with the names
  // through formatStaffList, never by inventing them. This runs before
  // the count questions below so a bare list phrase is never read as a
  // product lookup.
  const bareThingList = t.match(/^\s*(my\s+)?(projects?|products?|customers?|sales?|expenses?|staff)\s+list\s*[.!?]*$/);
  if (bareThingList) {
    const thing = bareThingList[2];
    if (/^projects?$/.test(thing)) return "projects";
    if (/^products?$/.test(thing)) return "products";
    if (/^customers?$/.test(thing)) return "customers";
    if (/^sales?$/.test(thing)) return "recentsales";
    if (/^expenses?$/.test(thing)) return "recentexpenses";
    if (/^staff$/.test(thing)) return "staffnames";
  }
  // Bare "My <things>" as a whole message: "My products", "My customers",
  // "My projects", "My sales", "My expenses". Anchored, so a longer
  // question that merely mentions the noun ("what is the best way to
  // price my products?") still falls through to the model.
  const bareList = t.match(/^\s*my (products|customers|projects|sales|expenses)\s*[.!?]*$/);
  if (bareList) {
    return { products: "products", customers: "customers", projects: "projects", sales: "recentsales", expenses: "recentexpenses" }[bareList[1]];
  }
  // What one customer bought: "What did Favour buy?", "Show me
  // Favour's sales", "How much has Favour bought". The name is
  // extracted by the step; the owner's own buying ("what did we buy")
  // is an expense, never this.
  if ((/^\s*what did\s+(?!i\b|we\b)/.test(t) || /^\s*what has\s+(?!i\b|we\b)/.test(t) || /^\s*how much has\s+/.test(t) || /^\s*(show me|list|tell me|what are)\s+/.test(t))
    && (/\bbuy\b/.test(t) || /\bbought\b/.test(t) || /'?s\s+(sales|purchases|orders)\b/.test(t))) return "customersales";
  // What one project has cost: "How much have we spent on the browser
  // apk project?", "How much did the browser apk project cost". The
  // project report step below owns status questions; this owns spend.
  if (/\bproject\b/.test(t) && (/\b(spent|spend|spending)\b/.test(t) || /\bcost\b/.test(t))) return "projectspend";
  // The business's own name and type, from the snapshot.
  if (includesAny(t, ["what is my business called", "what is my business name", "what is the name of my business", "what type of business do i have", "what type of business is this", "what kind of business is this", "what is my business type", "what is our business called", "what is our business name"])) return "mybusiness";
  // Count questions: "how many" is a count read, never a sale or a
  // product lookup. Each count comes from its own snapshot list, and a
  // sales count uses the window asked for, never today's count.
  if (/^\s*how many\b/.test(t)) {
    if (/\bprojects?\b/.test(t)) return "countprojects";
    if (/\bstaffs?\b/.test(t) || /\bco[- ]?owners?\b/.test(t)) return "countstaff";
    if (/\bcustomers?\b/.test(t)) return "countcustomers";
    if (/\bsales?\b/.test(t)) {
      if (/\bthis month\b/.test(t)) return "countsalesmonth";
      if (/\blast month\b/.test(t)) return "countsaleslastmonth";
      if (/\blast week\b/.test(t)) return "countsaleslastweek";
      if (/\bthis week\b/.test(t)) return "countsalesweek";
      if (/\blast year\b/.test(t)) return "countsaleslastyear";
      if (/\bthis year\b/.test(t)) return "countsalesyear";
      return "countsalestoday";
    }
    if (/\bproducts?\b/.test(t)) return "countproducts";
  }
  // Best seller by revenue: this week, last week, this month, last
  // month, or the last 31 days when no window is named. Runs before
  // the month read: "what sold best this month" contains "sold" and
  // "this month" and would otherwise answer as the month sales list.
  if (includesAny(t, ["what sold best this month", "what sold best last month", "what sold best this week", "what sold best last week", "what sold best this year", "what sold best last year", "best seller this year", "best seller last year", "what is my best seller", "what is our best seller", "what is the best seller", "best selling product", "best-selling product", "what sells best", "what sold best", "what is my best selling product", "which product sells best", "which product sold best"])) return "bestseller";
  // Month sales: "What did I sold last month?", "What did we sell in
  // October?" The month is resolved by the step, from the words, and
  // the question never reaches the sale parser as a product name.
  // Question form only: a statement ("I sold 2 laptops in May") is a
  // sale to record, never a read, and the bare phrase "Sales this
  // month" keeps its total-only answer below.
  if (/\b(sell|sold|sale|sales)\b/.test(t) && (/\blast month\b/.test(t) || /\bthis month\b/.test(t) || /\bnext month\b/.test(t) || new RegExp("\\b(in\\s+)?(" + MONTH_PATTERN + ")(\\s+\\d{4})?\\b").test(t))
    && (/^\s*(what|how|show|list|tell)\b/.test(t) || /\?\s*$/.test(t))) return "monthsales";
  if (includesAny(t, ["sales today", "today's sales", "todays sales", "sales so far today", "how much did we sell today", "how much we sell today", "wetin we sell today", "what did we sell today", "what did i sell today", "what have i sold today", "what have we sold today", "today sales", "sales for today", "what did we sold today", "what did i sold today", "what have we sold today", "what have i sold today", "what sold today", "what we sold today", "how much have we made today", "how much did we make today", "how much have i made today", "how much did i make today", "how much we made today"])) return "today";
  // Yesterday: the snapshot now carries salesYesterday in the business
  // timezone. A snapshot without that field is answered by falling
  // through (the read step returns null for it), never by guessing.
  // "sold" wordings are listed too: "What did I sold yesterday" is a
  // read, never a sale to record.
  if (includesAny(t, ["what did we sell yesterday", "what have we sold yesterday", "what did i sell yesterday", "what have i sold yesterday", "yesterday's sales", "yesterdays sales", "yesterday sales", "sales yesterday", "how much did we sell yesterday", "how much did i sell yesterday", "what sold yesterday", "what did i sold yesterday", "what did we sold yesterday", "what have i sold yesterday", "what have we sold yesterday", "how much did we sold yesterday", "how much did i sold yesterday", "what did we sold yesterday"])) return "yesterday";
  // This week and last week: relative-date sales reads, answered from
  // the per-day map with the window totals as fallback.
  if (includesAny(t, ["what did we sell this week", "what did i sell this week", "what have we sold this week", "what have i sold this week", "what did i sold this week", "what did we sold this week", "how much did we sell this week", "how much did i sell this week", "sales this week", "this week sales", "what sold this week", "what did we sell last week", "what did i sell last week", "what have we sold last week", "what did i sold last week", "what did we sold last week", "how much did we sell last week", "how much did i sell last week", "sales last week", "last week sales", "what sold last week"])) return /\blast week\b/.test(t) ? "lastweek" : "thisweek";
  // This year: the snapshot carries the year window.
  if (includesAny(t, ["how much did we sell this year", "how much did i sell this year", "what did we sell this year", "what did i sell this year", "sales this year", "this year sales", "how much have we made this year", "how much did we make this year"])) return "year";
  // Last year and named years: "What did I sold last year?", "What
  // did we sell in 2025?", "Sales in 2025", "What did I sold this
  // year" in the owner's "sold" wording. The year is resolved by the
  // step, from the words, and the question never reaches the sale
  // parser as a product name. A statement ("I sold 2 laptops in
  // 2025") is a sale to record, never a read: both rules below need
  // a question form.
  if (/\b(sell|sold|sale|sales)\b/.test(t) && (/\blast year\b/.test(t) || /\bin\s+(?:the\s+year\s+)?(?:19|20)\d{2}\b/.test(t) || /\bfor\s+(?:19|20)\d{2}\b/.test(t) || /\b(?:19|20)\d{2}\b/.test(t))
    && ((/^\s*(what|how|show|list|tell)\b/.test(t) || /\?\s*$/.test(t)) || /^\s*sales?\s+in\s+(?:19|20)\d{2}\s*[.!?]*$/.test(t) || /^\s*sales?\s+(?:19|20)\d{2}\s*[.!?]*$/.test(t))) return "lastyearsales";
  if (includesAny(t, ["what did i sold this year", "what did we sold this year", "what have i sold this year", "what have we sold this year", "what did i sold last year", "what did we sold last year", "what have i sold last year", "what have we sold last year", "how much did i sold last year", "how much did we sold last year", "how much did i sell last year", "how much did we sell last year", "sales last year", "last year sales", "what sold last year"])) return "lastyearsales";
  // Sales each day this week, and the best day this week: from the
  // per-day map. Runs before the week read: "sales each day this week"
  // contains "sales this week".
  if (includesAny(t, ["sales each day this week", "sales by day this week", "sales for each day this week", "each day this week", "daily sales this week"])) return "weekseries";
  if (includesAny(t, ["which day sold most this week", "which day did we sell most this week", "which day sold the most this week", "best day this week", "what day sold most this week", "which day was best this week"])) return "bestdayweek";
  // Bare "what did we sold" / "what have we sold" (no "today") as a whole
  // message still means today: a substring match would also catch "...
  // yesterday", which is a different day and has its own read above.
  // Anchored, so "what did we sell yesterday" never lands here.
  if (/^\s*what (did|have) (we|i) (sold|sell)\s*[.!?]*$/.test(t)) return "today";
  if (includesAny(t, ["sales this month", "sales for the month", "this month sales", "how much did we sell this month", "monthly sales", "sales month"])) return "month";
  // Expenses by description word in any month: "What did I spend on
  // transport this month?", "What did I spend on transport last
  // month?", "How much did we spend on fuel in October?" The month
  // is resolved by the step. With no month named, the spend question
  // stays on the recent-expenses read below.
  if (/^\s*(what did (i|we) spend on|how much did (i|we) spend on)\s+(.+?)\s*[.!?]*$/.test(t)
    && (/\b(last|this|next)\s+month\b/.test(t) || new RegExp("\\b(" + MONTH_PATTERN + ")(\\s+\\d{4})?\\b").test(t))) return "monthexpenseword";
  if (includesAny(t, ["how much did i spend this month", "how much did we spend this month", "what did i spend this month", "my spending this month", "spending this month", "expenses this month", "expenses for the month"])) return "monthexpenses";
  // Last month and named months: "How much did I spend last month?",
  // "Expenses in October". The month is resolved by the step.
  if (includesAny(t, ["how much did i spend last month", "how much did we spend last month", "what did i spend last month", "what did we spend last month", "expenses last month", "spending last month", "last month expenses"])) return "lastmonthexpenses";
  if (/\b(expenses?|spending|spend|spent)\b/.test(t) && new RegExp("\\b(in\\s+)?(" + MONTH_PATTERN + ")(\\s+\\d{4})?\\b").test(t) && ((/^\s*(what|how|show|list|tell)\b/.test(t) || /\?\s*$/.test(t)) || /^\s*expenses?\s+in\b/.test(t))) return "lastmonthexpenses";
  // Yesterday: "How much did I spend yesterday?"
  if (includesAny(t, ["how much did i spend yesterday", "how much did we spend yesterday", "what did i spend yesterday", "what did we spend yesterday", "expenses yesterday", "spending yesterday"])) return "yesterdayexpenses";
  // Expenses by window: today, this week, this year.
  if (includesAny(t, ["how much did i spend today", "how much did we spend today", "what did i spend today", "what did we spend today", "expenses today", "spending today"])) return "todayexpenses";
  if (includesAny(t, ["how much did i spend this week", "how much did we spend this week", "what did i spend this week", "what did we spend this week", "expenses this week", "spending this week"])) return "weekexpenses";
  if (includesAny(t, ["how much did i spend this year", "how much did we spend this year", "what did i spend this year", "what did we spend this year", "expenses this year", "spending this year"])) return "yearexpenses";
  // Last year and named years: "How much did I spend last year?",
  // "Expenses in 2025". The year is resolved by the step.
  if (includesAny(t, ["how much did i spend last year", "how much did we spend last year", "what did i spend last year", "what did we spend last year", "expenses last year", "spending last year", "last year expenses"])) return "lastyearexpenses";
  if (/\b(spend|spent|expenses?|spending)\b/.test(t) && /\bin\s+(?:the\s+year\s+)?(?:19|20)\d{2}\b/.test(t) && ((/^\s*(what|how|show|list|tell)\b/.test(t) || /\?\s*$/.test(t)) || /^\s*expenses?\s+in\s+(?:19|20)\d{2}\s*[.!?]*$/.test(t) || /^\s*spending\s+in\s+(?:19|20)\d{2}\s*[.!?]*$/.test(t))) return "lastyearexpenses";
  // Gross profit: no cost figures exist, so this is an honest answer
  // plus the profit-after-expenses figure. Runs before the profit read:
  // "gross profit" contains the word "profit".
  if (includesAny(t, ["gross profit", "gross margin", "what is my gross profit", "what is our gross profit", "how much gross profit"])) return "grossprofit";
  // Profit: sales minus expenses, per window. There is no cost_price in
  // the snapshot, so a gross margin from cost is not computable and is
  // never invented; the formatter says plainly when a window is missing.
  if (includesAny(t, ["how much profit", "profit today", "profit this week", "profit this month", "profit this year", "profit we made", "what profit", "my profit", "our profit", "profit made"])) return "profit";
  if (includesAny(t, ["recent sales", "last sales", "latest sales", "sales history", "show sales", "last few sales", "recent transactions", "list my sales", "show my sales", "list sales", "sales list", "sale list", "list out my sales", "list out sales", "list out the sales"])) return "recentsales";
  if (includesAny(t, ["recent expenses", "last expenses", "latest expenses", "show expenses", "what did we spend", "what have we spent", "list my expenses", "show my expenses", "list expenses", "expenses list", "expense list", "list out my expenses", "list out expenses", "list out the expenses"])) return "recentexpenses";
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

// A product unit that reads as English in a reply. The stock unit
// "other" is a form default, not a word a person would say ("10 other
// left", "NGN 2,356,754 per other"), so it displays as nothing after
// a count ("10 left"). Any other unit stands as it is.
export function displayUnit(unit) {
  const u = String(unit || "").trim();
  if (u.toLowerCase() === "other" || u.toLowerCase() === "others") return "";
  return u || "units";
}

// "10 piece left" or "10 left" when the unit is "other".
export function qtyLeftText(qty, unit) {
  const u = displayUnit(unit);
  return u ? `${Number(qty) || 0} ${u} left` : `${Number(qty) || 0} left`;
}

export function formatStock(snap, currency) {
  if (!snap.products || !snap.products.length) return "No products added yet.";
  const lines = snap.products.slice(0, 20).map((p) => `- ${p.name}: ${qtyLeftText(p.stock, p.unit)} at ${formatMoney(p.price, currency)} each`);
  return `Stock:\n${lines.join("\n")}`;
}

export function formatLowStock(snap, currency) {
  if (!snap.lowStock || !snap.lowStock.length) return "Nothing is running low.";
  const lines = snap.lowStock.map((p) => `- ${p.name}: ${qtyLeftText(p.qty, p.unit)}`);
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

export function formatMonthExpenses(snap, currency) {
  const total = (snap.expensesMonth && snap.expensesMonth.total) || 0;
  const count = (snap.expensesMonth && snap.expensesMonth.count) || 0;
  if (!count) return "No expenses yet this month.";
  return `Expenses this month: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
}

// Expenses total for one named month, from the per-month map.
// Returns null when the map has no entry for the month.
export function formatMonthExpensesFor(snap, currency, month) {
  const expByMonth = snap && snap.expensesByMonth;
  if (!expByMonth || typeof expByMonth !== "object" || !expByMonth[month.key]) return null;
  const e = expByMonth[month.key];
  const total = Number(e.total) || 0;
  const count = Number(e.count) || 0;
  const label = month.kind === "last" ? "last month" : month.kind === "this" ? "this month" : month.label;
  if (!count) return `No expenses ${label}.`;
  return `Expenses ${label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
}

export function formatProjects(snap, currency) {
  if (!snap.projects || !snap.projects.length) return "No projects yet.";
  const lines = snap.projects.map((p) => {
    const t = p.totals || {};
    const balance = t.balance !== undefined && t.balance !== null
      ? Number(t.balance)
      : (Number(t.totalIncome || 0) - Number(t.totalExpense || 0));
    // Income and expenses are shown when the project has any: the
    // project list must carry the full figures, not just the budget
    // and the balance. Zero-activity projects show budget and balance
    // only, exactly as before.
    const income = Number(t.totalIncome || 0);
    const expenses = Number(t.totalExpense || 0);
    const extra = (income > 0 || expenses > 0)
      ? `, income ${formatMoney(income, currency)}, expenses ${formatMoney(expenses, currency)}`
      : "";
    return `- #${p.id} ${p.name}: ${p.status}, budget ${formatMoney(p.budget, currency)}, balance ${formatMoney(balance, currency)}${extra}`;
  });
  return `Projects (${snap.projects.length}):\n${lines.join("\n")}`;
}

// Yesterday's sales, from the snapshot's business-timezone window.
// Returns null when the snapshot does not carry the window: the caller
// falls through instead of guessing. A day with no sales names the
// date, so "What did I sold yesterday" never answers with a bare line.
export function formatYesterdaySales(snap, currency) {
  const y = snap && snap.salesYesterday;
  if (!y || typeof y !== "object") return null;
  const total = Number(y.total) || 0;
  const count = Number(y.count) || 0;
  if (!count) {
    const date = snap && snap.businessDate ? addDaysISO(snap.businessDate, -1) : null;
    return date ? `No sales yesterday (${dayLabel(date)}).` : "No sales yesterday.";
  }
  return `Sales yesterday: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
}

// ---------------------------------------------------------------------------
// Dates: "on Friday", "on 02 of November", "last Friday", "Nov 2".
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;

// A real calendar date, or null when the day does not exist ("30
// February"). Returns YYYY-MM-DD.
function isoDateFromParts(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function addDaysISO(dateStr, n) {
  const ms = Date.parse(String(dateStr || "").slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + n * DAY_MS).toISOString().slice(0, 10);
}

// "Friday, 6 November 2026": the label every date answer shows.
export function dayLabel(dateStr) {
  const ms = Date.parse(String(dateStr || "").slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(ms)) return String(dateStr || "");
  const dt = new Date(ms);
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${weekdays[dt.getUTCDay()]}, ${dt.getUTCDate()} ${months[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

// The date a message asks about, resolved against the business date
// (today in the business timezone, YYYY-MM-DD). Returns
// { date, label, future, relative } or null when the message names no
// date. Relative is "today" or "yesterday" only when those exact words
// were used, so a weekday that happens to fall on today is not one.
// "last <weekday>" is the most recent one strictly before today;
// "this <weekday>" is that weekday of the current Monday to Sunday
// week; a bare weekday is the most recent one, today included. An
// explicit date with no year takes the business date's year, and
// DD/MM/YYYY follows the Nigerian convention (2/11/2026 is 2 November).
export function parseDateMention(text, businessDate) {
  const t = normalizeFastText(text);
  const base = String(businessDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const [by, bm, bd] = base.split("-").map(Number);
  const baseMs = Date.UTC(by, bm - 1, bd);
  const baseIdx = (new Date(baseMs).getUTCDay() + 6) % 7;
  const make = (date, relative) => {
    if (!date) return null;
    return { date, label: dayLabel(date), future: date > base, relative: relative || null };
  };
  if (/\btoday\b/.test(t)) return make(base, "today");
  if (/\byesterday\b/.test(t)) return make(addDaysISO(base, -1), "yesterday");
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return make(isoDateFromParts(Number(m[1]), Number(m[2]), Number(m[3])), null);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return make(isoDateFromParts(Number(m[3]), Number(m[2]), Number(m[1])), null);
  m = t.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (m) return make(isoDateFromParts(Number(m[3]), Number(m[2]), Number(m[1])), null);
  m = t.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(" + MONTH_PATTERN + ")\\b"));
  if (m) return make(isoDateFromParts(by, MONTH_NUMBERS[m[2]], Number(m[1])), null);
  m = t.match(new RegExp("\\b(" + MONTH_PATTERN + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b"));
  if (m) return make(isoDateFromParts(by, MONTH_NUMBERS[m[1]], Number(m[2])), null);
  m = t.match(new RegExp("\\b(?:(last|this)\\s+)?(" + WEEKDAY_PATTERN + ")\\b"));
  if (m) {
    const wdIdx = WEEKDAY_NAMES.indexOf(m[2]);
    if (m[1] === "last") {
      const offset = ((baseIdx - wdIdx + 6) % 7) + 1;
      return make(new Date(baseMs - offset * DAY_MS).toISOString().slice(0, 10), null);
    }
    if (m[1] === "this") {
      const mondayMs = baseMs - baseIdx * DAY_MS;
      return make(new Date(mondayMs + wdIdx * DAY_MS).toISOString().slice(0, 10), null);
    }
    const offset = (baseIdx - wdIdx + 7) % 7;
    return make(new Date(baseMs - offset * DAY_MS).toISOString().slice(0, 10), null);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Months: "last month", "this month", "in October", "October 2026".
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The month a message asks about, resolved against the business date.
// Returns { key, label, start, end, future, kind } or null when the
// message names no month. key is YYYY-MM, label is "October 2026",
// start/end are YYYY-MM-DD bounds, kind is "last", "this", "next" or
// "named". A named month with no year takes the business year; a named
// month after the business month in that year is in the future.
export function parseMonthMention(text, businessDate) {
  const t = normalizeFastText(text);
  const base = String(businessDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const [by, bm] = base.split("-").map(Number);
  const make = (year, month, kind) => {
    if (month < 1 || month > 12) return null;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const start = `${key}-01`;
    const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    const future = key > `${by}-${String(bm).padStart(2, "0")}`;
    return { key, label: `${MONTH_NAMES[month - 1]} ${year}`, start, end, future, kind };
  };
  if (/\blast month\b/.test(t)) {
    const month = bm === 1 ? 12 : bm - 1;
    const year = bm === 1 ? by - 1 : by;
    return make(year, month, "last");
  }
  if (/\bthis month\b/.test(t)) return make(by, bm, "this");
  if (/\bnext month\b/.test(t)) {
    const month = bm === 12 ? 1 : bm + 1;
    const year = bm === 12 ? by + 1 : by;
    return make(year, month, "next");
  }
  let m = t.match(new RegExp("\\b(" + MONTH_PATTERN + ")\\s+(\\d{4})\\b"));
  if (m) return make(Number(m[2]), MONTH_NUMBERS[m[1]], "named");
  m = t.match(new RegExp("\\b(?:in\\s+)?(" + MONTH_PATTERN + ")\\b"));
  if (m) return make(by, MONTH_NUMBERS[m[1]], "named");
  return null;
}

// The seven dates of a week (Monday to Sunday), from the business
// date: "this" is the current week, "last" is the previous week.
// Returns an array of YYYY-MM-DD strings, or null without a valid
// business date.
export function weekDayRange(businessDate, which) {
  const base = String(businessDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const [by, bm, bd] = base.split("-").map(Number);
  const baseMs = Date.UTC(by, bm - 1, bd);
  const baseIdx = (new Date(baseMs).getUTCDay() + 6) % 7;
  const mondayMs = baseMs - baseIdx * DAY_MS - (which === "last" ? 7 * DAY_MS : 0);
  const out = [];
  for (let i = 0; i < 7; i++) out.push(new Date(mondayMs + i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

// Sum the per-day map over a list of dates: { total, count, items,
// changeGiven, unlistedTotal, unlistedCount } with items aggregated
// by product name, amount-desc. Returns null when the map is absent.
// The unlisted figures travel with the sum, so a week that contains
// a sale with no product line still lists it, never silently drops it.
export function sumSalesByDayRange(snap, dates) {
  const byDay = snap && snap.salesByDay;
  if (!byDay || typeof byDay !== "object") return null;
  let total = 0;
  let count = 0;
  let changeGiven = 0;
  let unlistedTotal = 0;
  let unlistedCount = 0;
  const agg = {};
  for (const d of dates || []) {
    const entry = byDay[d];
    if (!entry) continue;
    total = Math.round((total + (Number(entry.total) || 0)) * 100) / 100;
    count += Number(entry.count) || 0;
    changeGiven = Math.round((changeGiven + (Number(entry.changeGiven) || 0)) * 100) / 100;
    unlistedTotal = Math.round((unlistedTotal + (Number(entry.unlistedTotal) || 0)) * 100) / 100;
    unlistedCount += Number(entry.unlistedCount) || 0;
    for (const it of entry.items || []) {
      const a = agg[it.product] || (agg[it.product] = { product: it.product, qty: 0, amount: 0 });
      a.qty += Number(it.qty) || 0;
      a.amount = Math.round((a.amount + (Number(it.amount) || 0)) * 100) / 100;
    }
  }
  const items = Object.values(agg).sort((a, b) => b.amount - a.amount);
  return { total, count, items, changeGiven, unlistedTotal, unlistedCount };
}

// Sales in one named month, from the per-month map. Returns null when
// the map is absent, so the caller falls through instead of guessing.
// A future month and a month older than the 3-month map each get their
// own plain line; a month with no sales says so plainly.
export function formatMonthSalesDetail(snap, currency, month) {
  const byMonth = snap && snap.salesByMonth;
  if (!byMonth || typeof byMonth !== "object") return null;
  if (month.future) return `${month.label} has not happened yet. Ask about this month or an earlier month.`;
  const entry = byMonth[month.key] || null;
  if (!entry) {
    return `I can only look back 3 months, so I do not have sales for ${month.label}. Ask about a more recent month.`;
  }
  const total = Number(entry.total) || 0;
  const count = Number(entry.count) || 0;
  if (!count) return `No sales in ${month.label}.`;
  const items = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 20);
  const lines = items.map((it) => `- ${Number(it.qty) || 0} ${pluraliseProductName(it.product, it.qty)}: ${formatMoney(it.amount, currency)}`);
  lines.push(...otherSalesLines(entry, currency, items));
  lines.push(`Total: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`);
  return `Sales in ${month.label}:\n${lines.join("\n")}`;
}

// One month's report, same shape as the day report: sales, expenses,
// profit after expenses, change given, best sellers, new debts.
// Returns null when the per-month maps are absent. Out-of-range
// months get a plain look-back line, never a guessed figure.
export function formatMonthReport(snap, currency, month) {
  const byMonth = snap && snap.salesByMonth;
  if (!byMonth || typeof byMonth !== "object") return null;
  if (month.future) return `${month.label} has not happened yet. Ask about this month or an earlier month.`;
  const entry = byMonth[month.key] || null;
  if (!entry) {
    return `I can only look back 3 months, so I do not have a report for ${month.label}. Ask about a more recent month.`;
  }
  const expByMonth = snap && snap.expensesByMonth;
  const expenses = expByMonth && expByMonth[month.key];
  const salesTotal = Number(entry.total) || 0;
  const salesCount = Number(entry.count) || 0;
  const title = month.kind === "last" ? `Last month's report, ${month.label}:`
    : month.kind === "this" ? `This month's report, ${month.label}:`
    : `Report for ${month.label}:`;
  const lines = [title];
  lines.push(salesCount
    ? `Sales: ${formatMoney(salesTotal, currency)} across ${salesCount} ${salesCount === 1 ? "sale" : "sales"}.`
    : "Sales: no sales this month.");
  if (expenses && typeof expenses.total === "number") {
    const eTotal = Number(expenses.total) || 0;
    const eCount = Number(expenses.count) || 0;
    lines.push(eCount
      ? `Expenses: ${formatMoney(eTotal, currency)} across ${eCount} ${eCount === 1 ? "expense" : "expenses"}.`
      : "Expenses: no expenses this month.");
    lines.push(`Profit after expenses: ${formatMoney(Math.round((salesTotal - eTotal) * 100) / 100, currency)} (sales minus expenses).`);
  } else {
    lines.push("Expenses: I do not have that figure for this month.");
    lines.push("Profit after expenses: I do not have the expenses figure, so I cannot work out the profit.");
  }
  lines.push(`Change given: ${formatMoney(Number(entry.changeGiven) || 0, currency)}.`);
  const best = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3);
  lines.push(best.length
    ? `Best sellers: ${best.map((it) => `${pluraliseProductName(it.product, it.qty)} (${Number(it.qty) || 0} sold)`).join(", ")}.`
    : "Best sellers: none yet.");
  const debts = entry.debts || [];
  lines.push(debts.length
    ? `New debts: ${debts.map((d) => `${d.customer} owes ${formatMoney(d.amount, currency)}`).join("; ")}.`
    : "New debts: none.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Years: "last year", "this year", "in 2025", "2025".
// ---------------------------------------------------------------------------

// The year a message asks about, resolved against the business date.
// Returns { key, label, start, end, future, kind } or null when the
// message names no year. key is "2025", label is "2025", kind is
// "last", "this", "next" or "named". A bare four-digit year counts
// here, but this only ever runs on a read the classifier already
// recognised as a year question, never on a sale statement, so an
// amount like "for 2025" is never mistaken for a year.
export function parseYearMention(text, businessDate) {
  const t = normalizeFastText(text);
  const base = String(businessDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const by = Number(base.split("-")[0]);
  const make = (year, kind) => {
    const key = String(year);
    return { key, label: key, start: `${key}-01-01`, end: `${year + 1}-01-01`, future: year > by, kind };
  };
  if (/\blast year\b/.test(t)) return make(by - 1, "last");
  if (/\bthis year\b/.test(t)) return make(by, "this");
  if (/\bnext year\b/.test(t)) return make(by + 1, "next");
  const m = t.match(/\b(?:in\s+)?(?:the\s+year\s+)?((?:19|20)\d{2})\b/);
  if (m) return make(Number(m[1]), "named");
  return null;
}

// Sales with no product line, and any other amount the item list does
// not account for, stated plainly so the list and the total always
// agree. A sale counts in the total the moment its row is seen, but
// its item line only exists when the sale has a product line: a sale
// recorded with no items, or whose product was deleted, used to vanish
// from the list while staying in the total. The snapshot now carries
// that gap as unlistedTotal/unlistedCount, and the residual line below
// catches anything else (for example items cut by the 20-item cap),
// so no window can ever list less than its total again.
export function otherSalesLines(entry, currency, items) {
  const lines = [];
  const unlistedTotal = Number((entry && entry.unlistedTotal) || 0);
  const unlistedCount = Number((entry && entry.unlistedCount) || 0);
  if (unlistedCount > 0 && unlistedTotal > 0) {
    lines.push(`- Other sales with no product listed: ${formatMoney(unlistedTotal, currency)} (${unlistedCount} ${unlistedCount === 1 ? "sale" : "sales"}).`);
  } else if (unlistedCount > 0) {
    lines.push(`- ${unlistedCount} ${unlistedCount === 1 ? "sale has" : "sales have"} no product listed.`);
  }
  const total = Number((entry && entry.total) || 0);
  const listed = (items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const residual = Math.round((total - listed - unlistedTotal) * 100) / 100;
  if (residual > 0) {
    lines.push(`- Other sales: ${formatMoney(residual, currency)}.`);
  }
  return lines;
}

// Sales in one named year, from the per-year map, with the year
// windows as fallback when the map is absent. Returns null when
// neither is available, so the caller falls through instead of
// guessing. A future year and a year older than the 2-year map each
// get their own plain line; a year with no sales says so plainly.
export function formatYearSalesDetail(snap, currency, year) {
  if (year.future) return `${year.label} has not happened yet. Ask about this year or an earlier year.`;
  const byYear = snap && snap.salesByYear;
  if (!byYear || typeof byYear !== "object") {
    const w = year.kind === "last" ? snap.salesLastYear : year.kind === "this" ? snap.salesYear : null;
    if (!w || typeof w.total !== "number") return null;
    const count = Number(w.count) || 0;
    const total = Number(w.total) || 0;
    if (!count) return `No sales in ${year.label}.`;
    return `Sales in ${year.label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
  }
  const entry = byYear[year.key] || null;
  if (!entry) {
    return `I can only look back 2 years, so I do not have sales for ${year.label}. Ask about a more recent year.`;
  }
  const total = Number(entry.total) || 0;
  const count = Number(entry.count) || 0;
  if (!count) return `No sales in ${year.label}.`;
  const items = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 20);
  const lines = items.map((it) => `- ${Number(it.qty) || 0} ${pluraliseProductName(it.product, it.qty)}: ${formatMoney(it.amount, currency)}`);
  lines.push(...otherSalesLines(entry, currency, items));
  lines.push(`Total: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`);
  return `Sales in ${year.label}:\n${lines.join("\n")}`;
}

// One year's report, same shape as the month report: sales, expenses,
// profit after expenses, change given, best sellers, new debts.
// Returns null when neither the per-year maps nor the year windows
// are available. Out-of-range years get a plain look-back line, never
// a guessed figure.
export function formatYearReport(snap, currency, year) {
  if (year.future) return `${year.label} has not happened yet. Ask about this year or an earlier year.`;
  const byYear = snap && snap.salesByYear;
  const expByYear = snap && snap.expensesByYear;
  const title = year.kind === "last" ? `Last year's report, ${year.label}:`
    : year.kind === "this" ? `This year's report, ${year.label}:`
    : `Report for ${year.label}:`;
  if (!byYear || typeof byYear !== "object" || !byYear[year.key]) {
    const s = year.kind === "last" ? snap.salesLastYear : year.kind === "this" ? snap.salesYear : null;
    const e = year.kind === "last" ? snap.expensesLastYear : year.kind === "this" ? snap.expensesYear : null;
    if (!s || typeof s.total !== "number") {
      return year.kind === "named"
        ? `I can only look back 2 years, so I do not have a report for ${year.label}. Ask about a more recent year.`
        : null;
    }
    const salesTotal = Number(s.total) || 0;
    const salesCount = Number(s.count) || 0;
    const lines = [title];
    lines.push(salesCount
      ? `Sales: ${formatMoney(salesTotal, currency)} across ${salesCount} ${salesCount === 1 ? "sale" : "sales"}.`
      : "Sales: no sales this year.");
    if (e && typeof e.total === "number") {
      const eTotal = Number(e.total) || 0;
      const eCount = Number(e.count) || 0;
      lines.push(eCount
        ? `Expenses: ${formatMoney(eTotal, currency)} across ${eCount} ${eCount === 1 ? "expense" : "expenses"}.`
        : "Expenses: no expenses this year.");
      lines.push(`Profit after expenses: ${formatMoney(Math.round((salesTotal - eTotal) * 100) / 100, currency)} (sales minus expenses).`);
    } else {
      lines.push("Expenses: I do not have that figure for this year.");
      lines.push("Profit after expenses: I do not have the expenses figure, so I cannot work out the profit.");
    }
    lines.push(`Change given: ${formatMoney(Number(s.changeGiven) || 0, currency)}.`);
    lines.push("Best sellers: I do not have the item breakdown for this year.");
    lines.push("New debts: I do not have that figure for this year.");
    return lines.join("\n");
  }
  const entry = byYear[year.key];
  const expenses = expByYear && expByYear[year.key];
  const salesTotal = Number(entry.total) || 0;
  const salesCount = Number(entry.count) || 0;
  const lines = [title];
  lines.push(salesCount
    ? `Sales: ${formatMoney(salesTotal, currency)} across ${salesCount} ${salesCount === 1 ? "sale" : "sales"}.`
    : "Sales: no sales this year.");
  if (expenses && typeof expenses.total === "number") {
    const eTotal = Number(expenses.total) || 0;
    const eCount = Number(expenses.count) || 0;
    lines.push(eCount
      ? `Expenses: ${formatMoney(eTotal, currency)} across ${eCount} ${eCount === 1 ? "expense" : "expenses"}.`
      : "Expenses: no expenses this year.");
    lines.push(`Profit after expenses: ${formatMoney(Math.round((salesTotal - eTotal) * 100) / 100, currency)} (sales minus expenses).`);
  } else {
    lines.push("Expenses: I do not have that figure for this year.");
    lines.push("Profit after expenses: I do not have the expenses figure, so I cannot work out the profit.");
  }
  lines.push(`Change given: ${formatMoney(Number(entry.changeGiven) || 0, currency)}.`);
  const best = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3);
  lines.push(best.length
    ? `Best sellers: ${best.map((it) => `${pluraliseProductName(it.product, it.qty)} (${Number(it.qty) || 0} sold)`).join(", ")}.`
    : "Best sellers: none yet.");
  const debts = entry.debts || [];
  lines.push(debts.length
    ? `New debts: ${debts.map((d) => `${d.customer} owes ${formatMoney(d.amount, currency)}`).join("; ")}.`
    : "New debts: none.");
  return lines.join("\n");
}

// One week's report, same shape as the day report: sales from the
// per-day map, expenses from the week windows, profit after expenses,
// change given, best sellers, new debts. Last week's expenses come
// from their own window; when the snapshot does not carry them the
// report says so instead of guessing.
export function formatWeekReport(snap, currency, which) {
  const dates = weekDayRange(snap && snap.businessDate, which);
  if (!dates) return null;
  const label = which === "last" ? "last week" : "this week";
  const rangeLabel = `${dayLabel(dates[0])} to ${dayLabel(dates[6])}`;
  const summed = sumSalesByDayRange(snap, dates);
  if (!summed) return null;
  const expenses = which === "last" ? snap.expensesLastWeek : snap.expensesWeek;
  const title = which === "last" ? `Last week's report (${rangeLabel}):` : `This week's report (${rangeLabel}):`;
  const lines = [title];
  lines.push(summed.count
    ? `Sales: ${formatMoney(summed.total, currency)} across ${summed.count} ${summed.count === 1 ? "sale" : "sales"}.`
    : `Sales: no sales ${label}.`);
  if (expenses && typeof expenses.total === "number") {
    const eTotal = Number(expenses.total) || 0;
    const eCount = Number(expenses.count) || 0;
    lines.push(eCount
      ? `Expenses: ${formatMoney(eTotal, currency)} across ${eCount} ${eCount === 1 ? "expense" : "expenses"}.`
      : `Expenses: no expenses ${label}.`);
    lines.push(`Profit after expenses: ${formatMoney(Math.round((summed.total - eTotal) * 100) / 100, currency)} (sales minus expenses).`);
  } else {
    lines.push(`Expenses: I do not have that figure for ${label}.`);
    lines.push("Profit after expenses: I do not have the expenses figure, so I cannot work out the profit.");
  }
  lines.push(`Change given: ${formatMoney(Number(summed.changeGiven) || 0, currency)}.`);
  const best = summed.items.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3);
  lines.push(best.length
    ? `Best sellers: ${best.map((it) => `${pluraliseProductName(it.product, it.qty)} (${Number(it.qty) || 0} sold)`).join(", ")}.`
    : "Best sellers: none yet.");
  const debts = [];
  const byDay = snap && snap.salesByDay;
  if (byDay && typeof byDay === "object") {
    for (const d of dates) {
      for (const debt of ((byDay[d] || {}).debts || [])) debts.push(debt);
    }
  }
  lines.push(debts.length
    ? `New debts: ${debts.map((d) => `${d.customer} owes ${formatMoney(d.amount, currency)}`).join("; ")}.`
    : "New debts: none.");
  return lines.join("\n");
}

// Expenses in one named year, from the per-year map, with the year
// windows as fallback when the map is absent.
export function formatYearExpenses(snap, currency, year) {
  const label = year.kind === "last" ? "last year" : year.kind === "this" ? "this year" : year.label;
  const expByYear = snap && snap.expensesByYear;
  if (expByYear && typeof expByYear === "object" && expByYear[year.key]) {
    const e = expByYear[year.key];
    const count = Number(e.count) || 0;
    const total = Number(e.total) || 0;
    if (!count) return `No expenses ${label}.`;
    return `Expenses ${label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
  }
  const w = year.kind === "last" ? snap.expensesLastYear : year.kind === "this" ? snap.expensesYear : null;
  if (!w || typeof w.total !== "number") return null;
  const count = Number(w.count) || 0;
  const total = Number(w.total) || 0;
  if (!count) return `No expenses ${label}.`;
  return `Expenses ${label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
}

// Sales in one named week, from the per-day map
// with the window totals as the fallback when the map is absent.
// A week with no sales names its dates.
export function formatWeekSales(snap, currency, which) {
  const dates = weekDayRange(snap && snap.businessDate, which);
  if (!dates) return null;
  const label = which === "last" ? "last week" : "this week";
  const rangeLabel = `${dayLabel(dates[0])} to ${dayLabel(dates[6])}`;
  const summed = sumSalesByDayRange(snap, dates);
  if (summed) {
    if (!summed.count) return `No sales ${label} (${rangeLabel}).`;
    const items = summed.items.slice(0, 20);
    const lines = items.map((it) => `- ${Number(it.qty) || 0} ${pluraliseProductName(it.product, it.qty)}: ${formatMoney(it.amount, currency)}`);
    lines.push(...otherSalesLines(summed, currency, items));
    lines.push(`Total: ${formatMoney(summed.total, currency)} across ${summed.count} ${summed.count === 1 ? "sale" : "sales"}.`);
    return `Sales ${label} (${rangeLabel}):\n${lines.join("\n")}`;
  }
  const w = which === "last" ? null : snap.salesWeek;
  if (!w || typeof w.total !== "number") return null;
  if (!Number(w.count)) return `No sales ${label} (${rangeLabel}).`;
  return `Sales ${label}: ${formatMoney(Number(w.total) || 0, currency)} across ${Number(w.count) || 0} ${Number(w.count) === 1 ? "sale" : "sales"}.`;
}

// Sales each day of this week, one line per day from the per-day map,
// including days with no sales. Returns null when the map is absent.
export function formatWeekSeries(snap, currency) {
  const dates = weekDayRange(snap && snap.businessDate, "this");
  if (!dates) return null;
  const byDay = snap && snap.salesByDay;
  if (!byDay || typeof byDay !== "object") return null;
  const lines = dates.map((d) => {
    const entry = byDay[d];
    const total = entry ? Number(entry.total) || 0 : 0;
    const count = entry ? Number(entry.count) || 0 : 0;
    const short = dayLabel(d).split(", ")[0];
    return count
      ? `- ${short}, ${Number(d.slice(8, 10))} ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}`
      : `- ${short}, ${Number(d.slice(8, 10))} ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}: no sales`;
  });
  return `Sales each day this week:\n${lines.join("\n")}`;
}

// The day that sold most this week, from the per-day map. Returns
// null when the map is absent or nothing sold this week.
export function formatBestDayWeek(snap, currency) {
  const dates = weekDayRange(snap && snap.businessDate, "this");
  if (!dates) return null;
  const byDay = snap && snap.salesByDay;
  if (!byDay || typeof byDay !== "object") return null;
  let best = null;
  let bestTotal = 0;
  for (const d of dates) {
    const total = Number((byDay[d] || {}).total) || 0;
    if (total > bestTotal) { best = d; bestTotal = total; }
  }
  if (!best) return "Nothing sold this week yet, so there is no best day.";
  const count = Number((byDay[best] || {}).count) || 0;
  return `${dayLabel(best)} sold most this week: ${formatMoney(bestTotal, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
}

// Best seller by revenue: this week, last week, this month, last
// month, or the last 31 days when no window is named. Returns null
// when the maps are absent.
export function formatBestSeller(snap, currency, window) {
  let items = null;
  let label = "";
  let salesCount = 0;
  if (window === "week") {
    const dates = weekDayRange(snap && snap.businessDate, "this");
    const summed = dates ? sumSalesByDayRange(snap, dates) : null;
    if (!summed) return null;
    items = summed.items;
    salesCount = summed.count;
    label = "this week";
  } else if (window === "lastweek") {
    const dates = weekDayRange(snap && snap.businessDate, "last");
    const summed = dates ? sumSalesByDayRange(snap, dates) : null;
    if (!summed) return null;
    items = summed.items;
    salesCount = summed.count;
    label = "last week";
  } else if (window === "month") {
    const m = parseMonthMention("this month", snap && snap.businessDate);
    const byMonth = snap && snap.salesByMonth;
    if (!m || !byMonth || typeof byMonth !== "object" || !byMonth[m.key]) return null;
    items = (byMonth[m.key].items || []).slice();
    salesCount = Number(byMonth[m.key].count) || 0;
    label = "this month";
  } else if (window === "lastmonth") {
    const m = parseMonthMention("last month", snap && snap.businessDate);
    const byMonth = snap && snap.salesByMonth;
    if (!m || !byMonth || typeof byMonth !== "object" || !byMonth[m.key]) return null;
    items = (byMonth[m.key].items || []).slice();
    salesCount = Number(byMonth[m.key].count) || 0;
    label = "last month";
  } else if (window === "year" || window === "lastyear") {
    const y = parseYearMention(window === "lastyear" ? "last year" : "this year", snap && snap.businessDate);
    const byYear = snap && snap.salesByYear;
    if (!y) return null;
    if (byYear && typeof byYear === "object" && byYear[y.key]) {
      items = (byYear[y.key].items || []).slice();
      salesCount = Number(byYear[y.key].count) || 0;
    } else {
      // No per-year map entry: the year windows still carry the
      // totals, so the count is known even though no product lines
      // are. The empty-items guard below then says plainly that no
      // best seller can be named, instead of claiming nothing sold.
      const w = window === "lastyear" ? snap.salesLastYear : snap.salesYear;
      if (!w || typeof w.total !== "number") return null;
      items = [];
      salesCount = Number(w.count) || 0;
    }
    label = window === "lastyear" ? "last year" : "this year";
  } else {
    const byDay = snap && snap.salesByDay;
    if (!byDay || typeof byDay !== "object") return null;
    const agg = {};
    for (const entry of Object.values(byDay)) {
      salesCount += Number(entry.count) || 0;
      for (const it of entry.items || []) {
        const a = agg[it.product] || (agg[it.product] = { product: it.product, qty: 0, amount: 0 });
        a.qty += Number(it.qty) || 0;
        a.amount = Math.round((a.amount + (Number(it.amount) || 0)) * 100) / 100;
      }
    }
    items = Object.values(agg).sort((a, b) => b.amount - a.amount);
    label = "in the last 31 days";
  }
  if (!items || !items.length) {
    if (salesCount > 0) return `Sales exist ${label}, but none list a product, so I cannot name a best seller.`;
    return `Nothing sold ${label} yet, so there is no best seller.`;
  }
  const best = items.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  return `Best seller ${label}: ${pluraliseProductName(best.product, best.qty)} (${Number(best.qty) || 0} sold) for ${formatMoney(best.amount, currency)}.`;
}

// Expenses in one month whose description contains one word, summed
// from the per-month expense items. The answer says plainly that the
// match is by the description word, never by a category. The month
// defaults to this month; last month and named months read from their
// own map entries.
export function formatMonthExpenseWord(snap, currency, word, month) {
  const m = month || parseMonthMention("this month", snap && snap.businessDate);
  const expByMonth = snap && snap.expensesByMonth;
  if (!m || !expByMonth || typeof expByMonth !== "object" || !expByMonth[m.key]) return null;
  const w = String(word || "").toLowerCase();
  const items = (expByMonth[m.key].items || []).filter((it) => String(it.description || "").toLowerCase().includes(w));
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const label = m.kind === "this" ? "this month" : m.kind === "last" ? "last month" : "in " + m.label;
  if (!items.length) return `No expenses for ${w} ${label}.`;
  return `You spent ${formatMoney(Math.round(total * 100) / 100, currency)} on ${w} ${label}, across ${items.length} ${items.length === 1 ? "expense" : "expenses"} (matched by the description word "${w}").`;
}

// Pluralise a product name for a quantity over 1, conservatively:
// only the last token, only when it is a plain word. Numeric tokens
// ("Product 1", "Rice 5kg", "Sugar 1kg") never change, short tokens
// ("Live SIM card uk") never change, and words already ending in s
// never change. "Laptop" becomes "Laptops", "Fvamail" becomes
// "Fvamails". Used only in date and month report item lines and best
// seller lines, never in sale proposals or executor summaries.
export function pluraliseProductName(name, qty) {
  if (!(Number(qty) > 1)) return String(name || "");
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return String(name || "");
  const last = parts[parts.length - 1];
  if (last.length < 3) return String(name || "");
  if (/\d/.test(last)) return String(name || "");
  if (last.toLowerCase().endsWith("s")) return String(name || "");
  parts[parts.length - 1] = last + "s";
  return parts.join(" ");
}

// Sales on one named day, from the snapshot's per-day map. Returns
// null when the map is absent, so the caller falls through instead of
// guessing. A day with no sales says so plainly; a future day and a
// day older than the 31-day map each get their own plain line.
export function formatSalesOnDate(snap, currency, date, label) {
  const byDay = snap && snap.salesByDay;
  if (!byDay || typeof byDay !== "object") return null;
  const niceLabel = label || (date ? dayLabel(date) : String(date || ""));
  const businessDate = snap && snap.businessDate;
  if (businessDate && date > businessDate) {
    return `${niceLabel} has not happened yet. Ask about today or an earlier day.`;
  }
  if (businessDate) {
    const earliest = addDaysISO(businessDate, -30);
    if (earliest && date < earliest) {
      return `I can only look back 31 days, so I do not have sales for ${niceLabel}. Ask about a more recent day.`;
    }
  }
  const entry = byDay[date] || null;
  const total = entry ? Number(entry.total) || 0 : 0;
  const count = entry ? Number(entry.count) || 0 : 0;
  if (!count) return `No sales on ${niceLabel}.`;
  const items = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 20);
  const lines = items.map((it) => `- ${Number(it.qty) || 0} ${pluraliseProductName(it.product, it.qty)}: ${formatMoney(it.amount, currency)}`);
  lines.push(...otherSalesLines(entry, currency, items));
  lines.push(`Total: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`);
  return `Sales on ${niceLabel}:\n${lines.join("\n")}`;
}

// One day's report: sales, expenses, profit, change given, best
// sellers and new debts. Returns null when the per-day map is absent,
// so the caller falls through instead of guessing. A figure the
// snapshot does not carry is stated plainly, never invented.
export function formatDayReport(snap, currency, day) {
  const byDay = snap && snap.salesByDay;
  if (!byDay || typeof byDay !== "object") return null;
  const businessDate = snap && snap.businessDate;
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return null;
  const isYesterday = day === "yesterday";
  const date = isYesterday ? addDaysISO(businessDate, -1) : businessDate;
  const entry = byDay[date] || { total: 0, count: 0, changeGiven: 0, items: [], debts: [] };
  const expenses = isYesterday ? snap.expensesYesterday : snap.expensesToday;
  const salesTotal = Number(entry.total) || 0;
  const salesCount = Number(entry.count) || 0;
  const dayWord = isYesterday ? "yesterday" : "today";
  const lines = [];
  lines.push(`${isYesterday ? "Yesterday" : "Today"}'s report, ${dayLabel(date)}:`);
  lines.push(salesCount
    ? `Sales: ${formatMoney(salesTotal, currency)} across ${salesCount} ${salesCount === 1 ? "sale" : "sales"}.`
    : `Sales: no sales ${dayWord}.`);
  if (expenses && typeof expenses.total === "number") {
    const eTotal = Number(expenses.total) || 0;
    const eCount = Number(expenses.count) || 0;
    lines.push(eCount
      ? `Expenses: ${formatMoney(eTotal, currency)} across ${eCount} ${eCount === 1 ? "expense" : "expenses"}.`
      : `Expenses: no expenses ${dayWord}.`);
    lines.push(`Profit after expenses: ${formatMoney(Math.round((salesTotal - eTotal) * 100) / 100, currency)} (sales minus expenses).`);
  } else {
    lines.push(`Expenses: I do not have that figure for ${dayWord}.`);
    lines.push("Profit after expenses: I do not have the expenses figure, so I cannot work out the profit.");
  }
  lines.push(`Change given: ${formatMoney(Number(entry.changeGiven) || 0, currency)}.`);
  const best = (entry.items || []).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3);
  lines.push(best.length
    ? `Best sellers: ${best.map((it) => `${pluraliseProductName(it.product, it.qty)} (${Number(it.qty) || 0} sold)`).join(", ")}.`
    : "Best sellers: none yet.");
  const debts = entry.debts || [];
  lines.push(debts.length
    ? `New debts: ${debts.map((d) => `${d.customer} owes ${formatMoney(d.amount, currency)}`).join("; ")}.`
    : "New debts: none.");
  return lines.join("\n");
}

// A staff count the owner stated in the recent chat, as a number, or
// null when none was stated. Digits and the words one to ten both
// count; the most recent user turn wins.
export function findMentionedStaffCount(history) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string");
  for (let i = turns.length - 1; i >= 0; i--) {
    const m = normalizeFastText(turns[i].content).match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+staff\b/);
    if (m) {
      const c = m[1];
      return /^\d+$/.test(c) ? Number(c) : NUMBER_WORD_ONES[c];
    }
  }
  return null;
}

// Yes/no existence questions ("Do I have staff?"), answered from the
// snapshot counts and stating the count, never just yes or no. For
// staff only, a count the owner stated in the recent chat that differs
// from the records is surfaced instead of guessed. Returns null when
// the snapshot does not carry the count, so the caller falls through.
export function formatYesNoCount(text, history, snap) {
  const t = normalizeFastText(text);
  let thing = null;
  if (/\bstaff\b/.test(t)) thing = "staff";
  else if (/\bcustomers?\b/.test(t)) thing = "customers";
  else if (/\bproducts?\b/.test(t)) thing = "products";
  else if (/\bdebtors?\b/.test(t)) thing = "debtors";
  else if (/\bsales?\b/.test(t)) thing = "sales";
  else if (/\bprojects?\b/.test(t)) thing = "projects";
  else if (/\bexpenses?\b/.test(t)) thing = "expenses";
  if (!thing) return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const counts = {
    staff: num(snap && snap.staffCount),
    customers: num(snap && snap.customerCount),
    products: Array.isArray(snap && snap.products) ? snap.products.length : null,
    debtors: Array.isArray(snap && snap.debtors) ? snap.debtors.length : null,
    sales: num(snap && snap.salesYear && snap.salesYear.count),
    projects: Array.isArray(snap && snap.projects) ? snap.projects.length : null,
    expenses: num(snap && snap.expensesYear && snap.expensesYear.count),
  };
  const n = counts[thing];
  if (n === null || n === undefined) return null;
  const singular = { staff: "staff member", customers: "customer", products: "product", debtors: "debtor", sales: "sale", projects: "project", expenses: "expense" }[thing];
  const plural = { staff: "staff members", customers: "customers", products: "products", debtors: "debtors", sales: "sales", projects: "projects", expenses: "expenses" }[thing];
  let out = n === 0
    ? `No, you have no ${plural}.`
    : `Yes, you have ${n} ${n === 1 ? singular : plural}.`;
  if (thing === "staff") {
    const mentioned = findMentionedStaffCount(history);
    if (mentioned !== null && mentioned !== n) {
      out += ` The records show ${n}, but you mentioned ${mentioned}. Which is right?`;
    }
  }
  return out;
}

export function formatCountProjects(snap) {
  const projects = (snap && snap.projects) || [];
  if (!projects.length) return "You have no projects.";
  const lines = projects.map((p) => `- #${p.id} ${p.name} (${p.status || "active"})`);
  return `You have ${projects.length} ${projects.length === 1 ? "project" : "projects"}:\n${lines.join("\n")}`;
}

export function formatCountStaff(snap) {
  const n = snap && Number.isFinite(Number(snap.staffCount)) ? Number(snap.staffCount) : null;
  if (n === null) return "I do not have a staff count for this business.";
  if (n === 0) return "You have no staff members on this business.";
  return `You have ${n} staff ${n === 1 ? "member" : "members"} on this business.`;
}

export function formatCountCustomers(snap) {
  const n = snap && Number.isFinite(Number(snap.customerCount)) ? Number(snap.customerCount) : null;
  if (n !== null) return `You have ${n} ${n === 1 ? "customer" : "customers"}.`;
  // The snapshot carries debtors, not all customers: answer the debtor
  // count and say so plainly, never guess a total.
  const debtors = (snap && snap.debtors) || [];
  return `${debtors.length} ${debtors.length === 1 ? "customer owes" : "customers owe"} money right now. I do not have your total customer count, so I cannot give the full total.`;
}

export function formatCountSalesToday(snap, currency) {
  const st = (snap && snap.salesToday) || {};
  const count = Number(st.count) || 0;
  const total = Number(st.total) || 0;
  if (!count) return "No sales yet today.";
  return `You made ${count} ${count === 1 ? "sale" : "sales"} today, totalling ${formatMoney(total, currency)}.`;
}

// A sales count for one window (today, this week, this month, this
// year, last week, last month, last year), from that window's own
// count, never today's count. Last week is summed from the per-day
// map, last month and last year from their maps, and each returns null
// without its map, so the caller falls through instead of guessing.
export function formatCountSalesWindow(snap, currency, window) {
  const pick = (w) => (snap && snap[w]) || null;
  const countLine = (st, label, zero) => {
    if (!st || typeof st.count !== "number") return null;
    const count = Number(st.count) || 0;
    const total = Number(st.total) || 0;
    if (!count) return zero;
    return `You made ${count} ${count === 1 ? "sale" : "sales"} ${label}, totalling ${formatMoney(total, currency)}.`;
  };
  let st = null;
  let label = "";
  if (window === "today") { st = pick("salesToday"); label = "today"; }
  else if (window === "week") { st = pick("salesWeek"); label = "this week"; }
  else if (window === "month") { st = pick("salesMonth"); label = "this month"; }
  else if (window === "year") { st = pick("salesYear"); label = "this year"; }
  else if (window === "lastweek") {
    const dates = weekDayRange(snap && snap.businessDate, "last");
    const summed = dates ? sumSalesByDayRange(snap, dates) : null;
    if (!summed) return null;
    if (!summed.count) return "No sales last week.";
    return `You made ${summed.count} ${summed.count === 1 ? "sale" : "sales"} last week, totalling ${formatMoney(summed.total, currency)}.`;
  }
  else if (window === "lastmonth") {
    const m = parseMonthMention("last month", snap && snap.businessDate);
    const byMonth = snap && snap.salesByMonth;
    if (!m || !byMonth || typeof byMonth !== "object" || !byMonth[m.key]) return null;
    return countLine(byMonth[m.key], "last month", "No sales last month.");
  }
  else if (window === "lastyear") {
    const y = parseYearMention("last year", snap && snap.businessDate);
    const byYear = snap && snap.salesByYear;
    if (y && byYear && typeof byYear === "object" && byYear[y.key]) {
      return countLine(byYear[y.key], "last year", "No sales last year.");
    }
    return countLine(pick("salesLastYear"), "last year", "No sales last year.");
  }
  if (!st || typeof st.count !== "number") return null;
  const count = Number(st.count) || 0;
  const total = Number(st.total) || 0;
  if (!count) return `No sales yet ${label}.`;
  return `You made ${count} ${count === 1 ? "sale" : "sales"} ${label}, totalling ${formatMoney(total, currency)}.`;
}

// Sales total for one window (this week, this year), from that
// window's own figures.
export function formatWindowSales(snap, currency, window) {
  const w = window === "week" ? snap.salesWeek : window === "year" ? snap.salesYear : null;
  if (!w || typeof w.total !== "number") return null;
  const label = window === "week" ? "this week" : "this year";
  const count = Number(w.count) || 0;
  const total = Number(w.total) || 0;
  if (!count) return `No sales yet ${label}.`;
  return `Sales ${label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"}.`;
}

// Expenses total for one window (today, yesterday, this week, this
// year, last year), from that window's own figures.
export function formatWindowExpenses(snap, currency, window) {
  const w = window === "today" ? snap.expensesToday : window === "yesterday" ? snap.expensesYesterday : window === "week" ? snap.expensesWeek : window === "year" ? snap.expensesYear : window === "lastyear" ? snap.expensesLastYear : null;
  if (!w || typeof w.total !== "number") return null;
  const label = window === "today" ? "today" : window === "yesterday" ? "yesterday" : window === "week" ? "this week" : window === "year" ? "this year" : "last year";
  const count = Number(w.count) || 0;
  const total = Number(w.total) || 0;
  // "Yet" fits an open window (today, this week, this year); a closed
  // one (yesterday, last year) simply had none.
  if (!count) return window === "yesterday" || window === "lastyear" ? `No expenses ${label}.` : `No expenses yet ${label}.`;
  return `Expenses ${label}: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
}

// Staff names, from the snapshot's staff list (members joined to
// users, with their business role). When the list is absent the count
// answers instead, and the gap is stated plainly, never filled with
// invented names. When the list is present but a role is missing, the
// name stands on its own.
export function formatStaffList(snap) {
  const staff = (snap && snap.staff) || null;
  const n = snap && Number.isFinite(Number(snap.staffCount)) ? Number(snap.staffCount) : null;
  if (!Array.isArray(staff)) {
    if (n === null) return "I do not have your staff list for this business.";
    if (n === 0) return "You have no staff members on this business.";
    return `You have ${n} staff ${n === 1 ? "member" : "members"} on this business. I do not have their names in this snapshot, so I cannot list them.`;
  }
  if (!staff.length) return "You have no staff members on this business.";
  const lines = staff.map((s) => `- ${s.name}${s.role ? ` (${s.role})` : ""}`);
  return `Your staff (${staff.length}):\n${lines.join("\n")}`;
}

// The customer who owes the most, from the debtors list.
export function formatTopDebtor(snap, currency) {
  const debtors = (snap && snap.debtors) || [];
  if (!debtors.length) return "Nobody owes money right now.";
  const top = debtors.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))[0];
  return `${top.name} owes the most: ${formatMoney(top.balance, currency)}.`;
}

// Total owed to the business, from the debtors list.
export function formatTotalOwed(snap, currency) {
  const debtors = (snap && snap.debtors) || [];
  const total = debtors.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  if (!debtors.length) return "Nobody owes money right now, so you are owed nothing.";
  return `You are owed ${formatMoney(Math.round(total * 100) / 100, currency)} in total, from ${debtors.length} ${debtors.length === 1 ? "customer" : "customers"}.`;
}

// Overdue debts, honestly: KopaBook sets no due dates, so no debtor
// can be called overdue from a date. The snapshot carries each
// debtor's last ledger activity, so the answer lists who owes, oldest
// activity first, and says plainly that there is no due date to judge
// against. Returns null when the debtors carry no activity dates.
export function formatOverdue(snap, currency) {
  const debtors = (snap && snap.debtors) || [];
  if (!debtors.length) return "Nobody owes money right now, so nobody is overdue.";
  const withActivity = debtors.filter((d) => d.lastActivity);
  if (!withActivity.length) return null;
  const sorted = withActivity.slice().sort((a, b) => String(a.lastActivity) < String(b.lastActivity) ? -1 : 1);
  const lines = sorted.map((d) => `- ${d.name}: ${formatMoney(d.balance, currency)}, last activity ${d.lastActivity}`);
  const missing = debtors.filter((d) => !d.lastActivity);
  for (const d of missing) lines.push(`- ${d.name}: ${formatMoney(d.balance, currency)}, last activity not recorded`);
  return `KopaBook does not set due dates, so I cannot say who is overdue. Last activity for each person owing, oldest first:\n${lines.join("\n")}`;
}

// The plan this business is on, from the snapshot tier. The tier is
// the owner's own subscription, never a guess. Returns null when the
// snapshot carries no tier, so the caller falls through.
export function formatMyPlan(snap) {
  const tier = snap && typeof snap.tier === "string" ? snap.tier.trim() : "";
  if (!tier) return null;
  const name = tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  return `You are on the ${name} plan.`;
}

// What one customer bought, from the per-day customer map (the last
// 31 days) and the last sales list. The window is stated plainly:
// the snapshot carries no all-time per-customer totals, so a wider
// figure is never invented. Returns null when no customer name was
// given.
export function formatCustomerSales(snap, currency, name) {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  const lower = wanted.toLowerCase();
  const names = new Set();
  const byDay = snap && snap.salesByDay;
  if (byDay && typeof byDay === "object") {
    for (const entry of Object.values(byDay)) {
      for (const cName of Object.keys(entry.customers || {})) names.add(cName);
    }
  }
  for (const s of (snap && snap.recentSales) || []) names.add(String(s.customer || ""));
  for (const d of (snap && snap.debtors) || []) names.add(String(d.name || ""));
  names.delete("");
  const canonical = [...names].find((n) => n.toLowerCase() === lower)
    || [...names].filter((n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))[0]
    || null;
  if (!canonical) {
    return `I do not have any sales for ${titleCaseName(wanted)} in the last 31 days.`;
  }
  let total = 0;
  let count = 0;
  let hasMap = false;
  if (byDay && typeof byDay === "object") {
    for (const entry of Object.values(byDay)) {
      if (entry.customers && typeof entry.customers === "object") {
        hasMap = true;
        const agg = entry.customers[canonical];
        if (agg) {
          total = Math.round((total + (Number(agg.total) || 0)) * 100) / 100;
          count += Number(agg.count) || 0;
        }
      }
    }
  }
  const recent = ((snap && snap.recentSales) || []).filter((s) => String(s.customer || "").toLowerCase() === canonical.toLowerCase());
  if (!hasMap) {
    if (!recent.length) return `I do not have any sales for ${canonical} in the last sales I can see.`;
    const rTotal = recent.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const lines = recent.map((r) => `- ${r.ref || ""} ${formatMoney(r.total, currency)}`.trim());
    return `${canonical} bought ${formatMoney(Math.round(rTotal * 100) / 100, currency)} across ${recent.length} ${recent.length === 1 ? "sale" : "sales"} in the last sales I can see:\n${lines.join("\n")}`;
  }
  if (!count) {
    return `${canonical} has not bought anything in the last 31 days.`;
  }
  const out = [`${canonical} bought ${formatMoney(total, currency)} across ${count} ${count === 1 ? "sale" : "sales"} in the last 31 days.`];
  if (recent.length) {
    out.push(`Last sales: ${recent.map((r) => `${r.ref || ""} ${formatMoney(r.total, currency)}`.trim()).join("; ")}.`);
  }
  return out.join("\n");
}

// The name in a per-customer sales question: "What did Favour buy?",
// "Show me Favour's sales", "How much has Favour bought". Returns
// null when the remainder is a generic word, not a name.
export function extractCustomerSalesName(text) {
  let t = normalizeFastText(text);
  t = t.replace(/^\s*(what did|what has|how much has|how much did|show me|list|tell me|what are)\s+/, "");
  t = t.replace(/'?s\s+(sales|purchases|orders)\b.*$/, "");
  t = t.replace(/\s+(buy|bought|purchase|purchases|purchased|sales|orders?)\b.*$/, "");
  t = t.replace(/[.!?]+$/, "").trim();
  if (!t || /^(customer|customers|they|he|she|it|we|i|someone|somebody|anyone|everyone|the customer|my customer)$/.test(t)) return null;
  if (t.split(/\s+/).length > 4) return null;
  return titleCaseName(t);
}

// What one project has spent, earned and kept, from the snapshot
// project totals. Returns null when no project name was given.
export function formatProjectSpend(snap, currency, name) {
  const projects = (snap && snap.projects) || [];
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  if (!projects.length) return "You have no projects yet.";
  const matches = projects.filter((p) => String(p.name || "").toLowerCase().includes(wanted) || wanted.includes(String(p.name || "").toLowerCase()));
  if (matches.length > 1) return `More than one project could be meant: ${matches.map((p) => p.name).join(", ")}. Which one?`;
  if (!matches.length) {
    const names = projects.map((p) => p.name).join(", ");
    return `I do not have a project called "${titleCaseName(name)}". Your projects are: ${names}.`;
  }
  const p = matches[0];
  const t = p.totals || {};
  const spent = Number(t.totalExpense || 0);
  const income = Number(t.totalIncome || 0);
  const balance = t.balance !== undefined && t.balance !== null ? Number(t.balance) : income - spent;
  return `The ${p.name} project: spent ${formatMoney(Math.round(spent * 100) / 100, currency)}, income ${formatMoney(Math.round(income * 100) / 100, currency)}, balance ${formatMoney(Math.round(balance * 100) / 100, currency)}, budget ${formatMoney(Number(p.budget || 0), currency)}.`;
}

// The project name in a spend question: "How much have we spent on
// the browser apk project?", "How much did the browser apk project
// cost". Returns null when no project name remains.
export function extractProjectSpendName(text) {
  let t = normalizeFastText(text);
  t = t.replace(/^\s*how much\b[^.]*?\b(spent|spend)\b\s+(on|for)\s+/, "");
  t = t.replace(/\b(cost|costs|spent|spend)\b.*$/, "");
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/^\s*(how|much|did|do|have|has|we|i|the|a|an|is|so|far)\s+/, "");
  }
  t = t.replace(/\s+project\s*$/, "").replace(/\s+so far\s*$/, "").trim();
  t = t.replace(/[.!?]+$/, "").trim();
  t = t.replace(/\s+project\s*$/, "").trim();
  if (!t || /^(project|projects|it|that|this)$/.test(t)) return null;
  return t;
}

// The business's own name and type, from the snapshot. The type is
// left out when it is the "general" default, which says nothing.
export function formatMyBusiness(snap) {
  const name = snap && snap.businessName ? String(snap.businessName).trim() : "";
  if (!name) return null;
  const type = snap && snap.businessType ? String(snap.businessType).trim() : "";
  const typePart = type && type.toLowerCase() !== "general" ? ` It is a ${type} business.` : "";
  return `Your business is called ${name}.${typePart}`;
}

// What the owner owes suppliers: KopaBook does not track supplier
// debts yet. This answer must never be the debtors list: the debtors
// are what customers owe the business, the opposite direction.
export const MY_DEBTS_ANSWER = "I do not track what you owe suppliers yet. KopaBook only records what customers owe you, so I cannot give a supplier debt figure.";

// Stock value at cost, honestly: there is no cost figure in the
// snapshot, so the cost value is not computable. The answer says so
// and gives the selling-price value instead.
export function formatStockCost(snap, currency) {
  const products = (snap && snap.products) || [];
  if (!products.length) return "No products added yet, so there is no stock value to work out.";
  const total = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.stock) || 0), 0);
  return `I do not have a cost figure for your stock, so I cannot give the value at cost. At selling price, your stock is worth ${formatMoney(Math.round(total * 100) / 100, currency)}.`;
}

// One product's price or stock, matched against the snapshot list.
// The question words are stripped first; the remainder must match a
// real product, or the answer lists the closest real names. Returns
// null when the message names no product at all.
export function formatProductQuestion(text, snap, currency, which) {
  const products = (snap && snap.products) || [];
  if (!products.length) return null;
  let rest = normalizeFastText(text)
    .replace(/\b(how|much|many|is|are|does|do|did|what|the|a|an|one|i|we|you|have|in|stock|left|remaining|for|of|it|its|this|per|each|price|cost|buy|sell|worth)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
  if (!rest) return null;
  const match = matchSnapshotProduct(normalizePluralProduct(rest, products), products);
  if (!match) {
    const names = products.slice(0, 5).map((p) => p.name).join(", ");
    return `I do not have a product called "${titleCaseName(rest)}". Your products are: ${names}.`;
  }
  if (which === "price") {
    return `${match.name} costs ${formatMoney(match.price, currency)} each.`;
  }
  return `You have ${Number(match.stock) || 0} ${pluraliseProductName(match.name, match.stock)} in stock.`;
}

export function formatCountProducts(snap, currency) {
  const products = (snap && snap.products) || [];
  if (!products.length) return "You have no products.";
  const lines = products.map((p) => `- ${p.name} (${Number(p.stock) || 0} in stock)`);
  return `You have ${products.length} ${products.length === 1 ? "product" : "products"}:\n${lines.join("\n")}`;
}

// Profit per window, as sales minus expenses. An explicit profit field
// wins when the snapshot carries one; otherwise the window's sales and
// expenses are subtracted. A window the snapshot does not carry gets a
// plain "I do not have that figure" line with the reason, never a
// guessed figure.
export function formatProfit(snap, currency) {
  const windows = [
    ["today", "Today", "today's", snap.profitToday, snap.salesToday, snap.expensesToday],
    ["week", "This week", "this week's", snap.profitWeek, snap.salesWeek, snap.expensesWeek],
    ["month", "This month", "this month's", snap.profitMonth, snap.salesMonth, snap.expensesMonth],
    ["year", "This year", "this year's", snap.profitYear, snap.salesYear, snap.expensesYear],
  ];
  const lines = windows.map(([, label, possessive, profit, sales, expenses]) => {
    if (typeof profit === "number" && Number.isFinite(profit)) return `${label}: ${formatMoney(profit, currency)}`;
    const s = sales && typeof sales.total === "number" ? sales.total : null;
    const e = expenses && typeof expenses.total === "number" ? expenses.total : null;
    if (s !== null && e !== null) return `${label}: ${formatMoney(Math.round((s - e) * 100) / 100, currency)}`;
    return `${label}: I do not have that figure. The snapshot does not carry ${possessive} sales and expenses, so I cannot work out the profit.`;
  });
  return `Profit after expenses (sales minus expenses):\n${lines.join("\n")}`;
}

// One window's profit only, as sales minus expenses, labelled plainly.
// "How much profit did I make last month?" answers last month, not all
// four windows. The month windows come from the per-month maps; the
// other windows come from the snapshot windows. Returns null when the
// window asked for is not in the snapshot, so the caller falls through
// instead of guessing.
export function formatSingleProfit(snap, currency, window) {
  const monthAgg = (key) => {
    const byMonth = snap && snap.salesByMonth;
    const expByMonth = snap && snap.expensesByMonth;
    if (!byMonth || typeof byMonth !== "object" || !byMonth[key]) return null;
    const s = byMonth[key];
    const e = expByMonth && expByMonth[key];
    if (!e || typeof e.total !== "number") return { sales: Number(s.total) || 0, expenses: null };
    return { sales: Number(s.total) || 0, expenses: Number(e.total) || 0 };
  };
  const fromWindows = (sales, expenses) => {
    if (!sales || typeof sales.total !== "number") return null;
    if (!expenses || typeof expenses.total !== "number") return { sales: Number(sales.total) || 0, expenses: null };
    return { sales: Number(sales.total) || 0, expenses: Number(expenses.total) || 0 };
  };
  // A year's figures come from the per-year maps when they are there,
  // and from the year windows when they are not.
  const yearAgg = (key, salesWindow, expensesWindow) => {
    const byYear = snap && snap.salesByYear;
    const expByYear = snap && snap.expensesByYear;
    if (byYear && typeof byYear === "object" && byYear[key]) {
      const s = byYear[key];
      const e = expByYear && expByYear[key];
      if (!e || typeof e.total !== "number") return { sales: Number(s.total) || 0, expenses: null };
      return { sales: Number(s.total) || 0, expenses: Number(e.total) || 0 };
    }
    return fromWindows(salesWindow, expensesWindow);
  };
  let label = "";
  let agg = null;
  if (window === "today") { label = "today"; agg = fromWindows(snap.salesToday, snap.expensesToday); }
  else if (window === "week") { label = "this week"; agg = fromWindows(snap.salesWeek, snap.expensesWeek); }
  else if (window === "month") { label = "this month"; agg = fromWindows(snap.salesMonth, snap.expensesMonth); }
  else if (window === "year") { label = "this year"; agg = fromWindows(snap.salesYear, snap.expensesYear); }
  else if (window === "lastyear") {
    const y = parseYearMention("last year", snap && snap.businessDate);
    if (!y) return null;
    label = y.label;
    agg = yearAgg(y.key, snap.salesLastYear, snap.expensesLastYear);
  }
  else if (window === "lastmonth") {
    const m = parseMonthMention("last month", snap && snap.businessDate);
    if (!m) return null;
    label = m.label;
    agg = monthAgg(m.key);
  } else if (window === "lastweek") {
    label = "last week";
    agg = null;
  }
  if (window === "lastweek") {
    const days = weekDayRange(snap && snap.businessDate, "last");
    if (!days) return null;
    const byDay = snap && snap.salesByDay;
    if (!byDay || typeof byDay !== "object") return null;
    let sales = 0;
    for (const d of days) sales += Number((byDay[d] || {}).total) || 0;
    return `Profit after expenses last week: I do not have last week's expenses broken out, so I cannot work out the profit. Sales last week were ${formatMoney(Math.round(sales * 100) / 100, currency)}.`;
  }
  if (!agg) return null;
  if (agg.expenses === null) return `Profit after expenses ${label}: I do not have the expenses figure for ${label}, so I cannot work out the profit.`;
  return `Profit after expenses ${label}: ${formatMoney(Math.round((agg.sales - agg.expenses) * 100) / 100, currency)} (sales minus expenses).`;
}

// Gross profit, honestly: there is no cost figure in the snapshot, so
// gross profit from cost is not computable and is never invented. The
// answer says so plainly and gives the profit-after-expenses figure
// for this month instead.
export function formatGrossProfit(snap, currency) {
  const s = snap && snap.salesMonth;
  const e = snap && snap.expensesMonth;
  const profit = (s && typeof s.total === "number" && e && typeof e.total === "number")
    ? formatMoney(Math.round((Number(s.total) - Number(e.total)) * 100) / 100, currency)
    : null;
  if (profit) {
    return `I do not have cost figures for your products, so I cannot work out gross profit. Profit after expenses this month is ${profit} (sales minus expenses).`;
  }
  return "I do not have cost figures for your products, so I cannot work out gross profit, and I do not have this month's sales and expenses either, so I cannot give the profit after expenses.";
}

// Snapshot-based business advice: best seller, low stock, debtors,
// sales and expenses this month. Short plain lines, no invented
// figures. The best seller is the product with the most sold in the
// last 30 days; the snapshot lists products in that order, so the
// first product stands when no sold counts are carried.
export function formatBusinessAdvice(snap, currency) {
  const lines = ["Here is what your books say:"];
  const products = (snap && snap.products) || [];
  let best = null;
  const withSold = products.filter((p) => Number.isFinite(Number(p.sold_30d)));
  if (withSold.length) {
    const sorted = [...withSold].sort((a, b) => Number(b.sold_30d) - Number(a.sold_30d));
    if (Number(sorted[0].sold_30d) > 0) best = sorted[0];
  } else if (products.length) {
    best = products[0];
  }
  if (best) {
    const sold = Number(best.sold_30d);
    lines.push(Number.isFinite(sold) && sold > 0
      ? `Best seller: ${best.name} (${sold} sold in the last 30 days).`
      : `Best seller: ${best.name}.`);
  } else {
    lines.push("Best seller: nothing sold in the last 30 days.");
  }
  const low = (snap && snap.lowStock) || [];
  if (low.length) {
    lines.push(`Running low: ${low.map((p) => `${p.name} (${qtyLeftText(p.qty, p.unit)})`).join(", ")}. Restock these first.`);
  } else {
    lines.push("Running low: nothing is running low.");
  }
  const debtors = (snap && snap.debtors) || [];
  const owed = debtors.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  if (debtors.length) {
    lines.push(`Owed to you: ${formatMoney(owed, currency)} from ${debtors.length} ${debtors.length === 1 ? "customer" : "customers"} (${debtors.map((d) => d.name).join(", ")}). Chase these first.`);
  } else {
    lines.push("Owed to you: nobody owes money right now.");
  }
  const sm = (snap && snap.salesMonth) || {};
  const em = (snap && snap.expensesMonth) || {};
  lines.push(`Sales this month: ${formatMoney(sm.total || 0, currency)} across ${sm.count || 0} ${(sm.count || 0) === 1 ? "sale" : "sales"}.`);
  lines.push(`Expenses this month: ${formatMoney(em.total || 0, currency)} across ${em.count || 0} ${(em.count || 0) === 1 ? "expense" : "expenses"}.`);
  return lines.join("\n");
}

// Inventory value at selling price: price x stock for every product,
// with a per-product breakdown and the total. This is the
// selling-price value, never the cost value: there is no cost data in
// the snapshot. When the product list is at the snapshot cap, the
// answer says it covers the products listed, not the whole business.
export function formatInventoryValue(snap, currency) {
  const products = (snap && snap.products) || [];
  if (!products.length) return "No products added yet.";
  const lines = products.map((p) => {
    const value = Math.round((Number(p.price) || 0) * (Number(p.stock) || 0) * 100) / 100;
    return `- ${p.name}: ${Number(p.stock) || 0} × ${formatMoney(p.price, currency)} = ${formatMoney(value, currency)}`;
  });
  const total = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.stock) || 0), 0);
  const out = [
    "Value of your products (at selling price):",
    ...lines,
    `Total: ${formatMoney(Math.round(total * 100) / 100, currency)}`,
    "This is the selling-price value, not the cost value.",
  ];
  if (products.length >= 50) out.push("This covers the 50 products listed; there may be more.");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Sale-payment question: a sale reported from the buyer's side with no
// payment stated ("someone bought 5 fvamail now"). The payment is
// genuinely unknown, so the fast path asks one short question instead of
// assuming full payment, and the answer completes the sale.
// ---------------------------------------------------------------------------

// A third-party buyer is named ("someone", "somebody", "a customer",
// "a new customer", "some person", "anybody", "anyone", "some"): the purchase
// is a sale to a walk-in, not the owner buying supplies.
export function isBuyerSale(text) {
  const t = normalizeFastText(text);
  return /\b(someone|somebody|some person|a new customer|new customer|a customer|anybody|anyone|some)\b/.test(t);
}

// A third-person pronoun bought it ("he bought a laptop", "they bought
// 2 laptops"): a sale to a walk-in, not an expense. First-person "I
// bought" stays an expense.
export function isPronounBuyerSale(text) {
  const t = normalizeFastText(text);
  return /\b(he|she|they)\s+bought\b/.test(t);
}

// "bought" on its own, with no seller-side sale verb: the buyer is
// reporting what a customer did, not the owner recording their own sale.
export function isBoughtOnly(text) {
  const t = normalizeFastText(text);
  return /\bbought\b/.test(t) && !/\b(record|new|add|sold|sell|sale|sales)\b/.test(t);
}

// Total of snapshot-matched sale items, from the snapshot prices.
// Matching is plural- and case-tolerant, so "laptops" prices as Laptop.
export function saleTotalFromSnapshot(items, snap) {
  const products = (snap && snap.products) || [];
  return (items || []).reduce((s, it) => {
    const p = matchSnapshotProduct(normalizePluralProduct(it.product, products), products);
    return s + (Number(p && p.price) || 0) * (Number(it.qty) || 0);
  }, 0);
}

function saleMethodFromText(t) {
  for (const [re, method] of SALE_METHODS) {
    if (re.test(t)) return method;
  }
  // A bare method word as a payment answer ("cash", "transfer") means
  // the full total by that method. Only in an answer: the sale parser
  // itself still needs "in cash" / "by transfer" so a product or a
  // customer called Cash is never read as a method.
  if (/\bcash\b/.test(t)) return "cash";
  if (/\btransfer\b/.test(t)) return "transfer";
  return null;
}

// A sale reported with no payment stated: state the sale that will be
// recorded, then ask one short question about the payment.
export function formatSalePaymentQuestion(items, total, currency, customerName) {
  const parts = (items || []).map((it) => `${it.qty} × ${it.product}`);
  const who = customerName ? `for ${customerName}` : "for a walk-in customer";
  return `${parts.join(", ")}, total ${formatMoney(total, currency)}, ${who}. How much did they pay?`;
}

// The sale a payment question belongs to: the last assistant turn asked
// "How much did they pay?" (the question above), and a user turn since
// the last "Done. Recorded ..." line parses as a sale against the
// snapshot. Returns { params, total, question } or null.
export function findPendingSalePayment(history, snap, currency) {
  const hist = history || [];
  let lastAssistantIdx = -1;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string") { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx < 0) return null;
  if (!/how much did they pay\?/i.test(hist[lastAssistantIdx].content)) return null;
  let startIdx = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string" && /Done\. Recorded (payment|sale|expense)/.test(h.content)) {
      startIdx = i + 1;
      break;
    }
  }
  const recent = hist.slice(startIdx);
  for (let i = recent.length - 1; i >= 0; i--) {
    const h = recent[i];
    if (!h || h.role !== "user" || typeof h.content !== "string") continue;
    const sale = parseSaleSnapshot(h.content, hist, snap, currency);
    if (sale) {
      const params = sale.params;
      const total = saleTotalFromSnapshot(params.items, snap);
      const question = formatSalePaymentQuestion(params.items, total, currency, params.customer_name || "");
      return { params, total, question };
    }
  }
  return null;
}

// Resolve an answer to a sale-payment question ("How much did they pay?"):
// a bare amount, "paid <amount>" / "he paid <amount>", "paid in full"
// (the full total), "paid half" (half the total), or a payment method on
// its own ("cash", "by transfer": full total by that method). Returns
// { amount, method } (method may be null) or null when the answer does
// not resolve. A real name before "paid" ("Favour paid 5000") is a fresh
// customer payment, not an answer, so it stays with the payment parser.
export function parseSalePaymentAnswer(text, total) {
  const t = normalizeFastText(text);
  const answer = parseAmountAnswer(text);
  if (answer && answer.amount > 0) return { amount: answer.amount, method: saleMethodFromText(t) };
  // A bare "full" or "half" answers the pending payment question too.
  if (/^\s*(full|in full)\s*$/.test(t)) return { amount: total, method: saleMethodFromText(t) };
  if (/^\s*half\s*$/.test(t)) {
    if (!(total > 0)) return null;
    return { amount: Math.round((total / 2) * 100) / 100, method: saleMethodFromText(t) };
  }
  if (/\bpaid\s+half\b/.test(t)) {
    // "paid half" with no computable total is not an answer: the caller
    // asks "How much is half?" instead of defaulting to full.
    if (!(total > 0)) return null;
    return { amount: Math.round((total / 2) * 100) / 100, method: saleMethodFromText(t) };
  }
  if (/\b(paid\s+(in\s+)?full|in\s+full|fully\s+paid|full\s+payment)\b/.test(t)) {
    return { amount: total, method: saleMethodFromText(t) };
  }
  const paidAmount = t.match(/^(?:(he|she|they|it|i|we)\s+)?paid\s+(.+)$/);
  if (paidAmount) {
    const amounts = findAllAmounts(paidAmount[2]);
    if (amounts.length === 1) return { amount: amounts[0].value, method: saleMethodFromText(t) };
  }
  const method = saleMethodFromText(t);
  if (method) return { amount: total, method };
  return null;
}

// ---------------------------------------------------------------------------
// Bare acknowledgements and greetings: "Great", "Thanks", "Thank you",
// "OK", "Good", "Nice", "Hello", "Hi". One short friendly line, never the
// model, never the failure line. Whole-message anchored, so a longer
// sentence that merely starts with one of these words is unaffected.
// Returns the reply text or null.
// ---------------------------------------------------------------------------
export function acknowledgementReply(text) {
  const t = normalizeFastText(text).replace(/[.!?]+$/, "").trim();
  if (/^(thanks|thank you|thank you very much|thanks a lot|thanks so much)$/.test(t)) {
    return "You are welcome. Anything else?";
  }
  // Multi-word thanks: "Thanks, that is all", "Great, thanks", "Thanks
  // for now". Every word is an acknowledgement or a closing phrase, so
  // the whole message is a sign-off, never a new request.
  if (/^(thanks|thank you|great|good|nice|ok|okay)[, ]+(that is all|that is it|that will be all|thats all|that is everything|for now)$/.test(t)) {
    return "You are welcome. Anything else?";
  }
  const ackWords = t.split(/[\s,]+/).filter(Boolean);
  if (ackWords.length > 1 && ackWords.every((w) => ["thanks", "thank", "you", "great", "good", "nice", "ok", "okay", "awesome", "perfect", "lovely"].includes(w))) {
    return "You are welcome. Anything else?";
  }
  if (/^(hello|hi|hey|good morning|good afternoon|good evening)$/.test(t)) {
    return "Hello. How can I help today?";
  }
  if (/^(great|good|nice|ok|okay|awesome|perfect|lovely|brilliant|great job|well done)$/.test(t)) {
    return "Great. Anything else I can help with?";
  }
  return null;
}

// The one short question for a partial payment with no debtor named:
// "Who owes for the remaining laptop?" (one) / "Who owes for the
// remaining 2 laptops?" (more).
export function partialDebtorQuestion(items, partial) {
  const owed = partial.owedQty !== null && partial.owedQty !== undefined
    ? partial.owedQty
    : ((items || []).reduce((n, it) => n + (it.qty || 0), 0) - (partial.paidQty || 0));
  const name = (items && items.length === 1) ? items[0].product : "items";
  const plural = name.endsWith("s") ? name : name + "s";
  if (owed === 1) return `Who owes for the remaining ${name.toLowerCase()}?`;
  return `Who owes for the remaining ${owed} ${plural.toLowerCase()}?`;
}

// ---------------------------------------------------------------------------
// Supplier orders: "I order laptops from supplier 50 and I paid him
// full", "I ordered 30 fvamail". A stock purchase, proposed Confirm-first
// as an expense for the amount paid: the executor has no stock-in or
// purchase action, so the proposal states plainly that stock is not
// updated by the draft. The amount is quantity x snapshot price. When
// payment was not stated, or the product has no snapshot price, ask one
// short question for the missing piece instead of guessing.
// Returns { params } (propose), { question } (ask), or null.
// ---------------------------------------------------------------------------

export function parseSupplierOrder(text, snap, currency) {
  const t = normalizeFastText(text);
  if (!/\b(order|ordered|ordering)\b/.test(t)) return null;
  // A customer ordering goods is a sale, not a supplier order.
  if (isBuyerSale(t)) return null;
  const trimmed = t.replace(/^(please|kindly)\s+/, "");
  if (!/^(i|we|order|ordered|ordering)\b/.test(trimmed)) return null;
  // Payment stated in the message itself, before any stripping.
  const paidFull = /\b(paid|pay)\b[^.]{0,20}\bfull\b/.test(t);
  const paidAmountMatch = t.match(/\bpaid\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?/i);
  const paidAmount = paidAmountMatch ? (findAmounts(paidAmountMatch[0])[0] || {}).value : null;
  // The supplier's name, when given ("from Ada Stores"); "supplier" on
  // its own stays "supplier".
  let supplier = "supplier";
  const fromMatch = t.match(/\bfrom\s+([a-z][a-z' ]+?)(?=\s+\d|\s+and\b|\s*$)/);
  if (fromMatch && fromMatch[1].trim() && !/^(supplier|suppliers)$/.test(fromMatch[1].trim())) {
    supplier = titleCaseName(fromMatch[1].trim());
  }
  let rest = t;
  rest = rest.replace(/\b(this morning|this afternoon|this evening|in the morning|in the afternoon|in the evening|now|today|just|yesterday)\b/g, " ");
  rest = rest.replace(/\bfrom\s+[a-z][a-z' ]+?(?=\s+\d|\s+and\b|\s*$)/, " ");
  rest = rest.replace(/\b(?:and\s+)?(?:i\s+|we\s+)?paid\b.*$/, " ");
  rest = rest.replace(/\b(order|ordered|ordering|from|supplier|suppliers|a|an|the|please|kindly|i|we|him|her|them|my|our|and)\b/g, " ");
  rest = rest.replace(/\s+/g, " ").trim();
  const qtyMatch = rest.match(/(\d+(?:\.\d+)?)/);
  const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
  const productRaw = rest.replace(/\d+(?:\.\d+)?/g, " ").replace(/\s+/g, " ").trim();
  if (!productRaw) return null;
  const match = (snap && snap.products) ? matchSnapshotProduct(normalizePluralProduct(productRaw, snap.products), snap.products) : null;
  const total = match ? Math.round((Number(match.price) || 0) * qty * 100) / 100 : null;
  if (match && (paidFull || paidAmount !== null)) {
    const amount = paidAmount !== null && paidAmount !== undefined ? paidAmount : total;
    return { params: { amount, description: `Stock purchase: ${qty} × ${match.name} from ${supplier} (stock not updated by this draft)`, category: "Stock purchase" } };
  }
  if (match) {
    // The total is computable, but nothing was paid yet: state the
    // total and ask the one missing piece.
    return { question: `${qty} × ${match.name} comes to ${formatMoney(total, currency)}. Who is the supplier, and how much did you pay?` };
  }
  // No snapshot price: the total cannot be computed, so ask for it.
  return { question: `How much did you pay for the ${qty} ${productRaw}? I do not have a price for ${productRaw}, so I cannot work out the total.` };
}

// ---------------------------------------------------------------------------
// Conversation memory: the thread, not just the latest message.
// ---------------------------------------------------------------------------

// Words that can never be a bare-name answer ("Fortune" is a name;
// "Cancelled", "Yes", "Cash" and "Record it" are not).
const BARE_NAME_STOP = new Set([
  "yes", "no", "ok", "okay", "thanks", "thank", "hello", "hi", "hey",
  "great", "good", "nice", "cash", "transfer", "pos", "full", "half",
  "paid", "pay", "record", "sale", "sales", "expense", "expenses",
  "payment", "please", "kindly", "cancel", "cancelled", "cancelling",
  "confirm", "confirmed", "done", "really", "lol", "haha", "hehe",
  "wow", "cool", "do", "it", "that", "this", "am", "and", "or", "but",
  "sold", "bought", "gave", "give", "order", "ordered", "staff",
  "rent", "fuel", "tax", "all", "each", "both", "them", "they", "he",
  "she", "we", "i", "you", "me", "us", "him", "her", "his", "their",
]);

// A bare name ("Fortune"): one to three words, letters only, not a
// stop word, not a product name, not a number. Used to recognise a
// name answer to the AI's own question.
export function isBareName(text, snap) {
  const t = String(text || "").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  if (!t) return false;
  if (/[^a-z' ]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  if (words.some((w) => BARE_NAME_STOP.has(w))) return false;
  if (snap && snap.products && matchSnapshotProduct(t, snap.products)) return false;
  return true;
}

// The last sale in the thread: the most recent user turn that parses as
// a sale, combined with a restatement turn ("They paid for 2 and owe
// for 1") and a bare-name answer ("Fortune") when they follow it.
// Returns { items, total, amountPaid, paidQty, customerName } or null.
// The customer name comes only from the sale turn itself, a restatement
// that names the debtor, or a bare-name answer in the thread.
export function findLastSaleContext(history, snap, currency) {
  const hist = history || [];
  let startIdx = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string" && /Done\. Recorded (payment|sale|expense)/.test(h.content)) {
      startIdx = i + 1;
      break;
    }
  }
  const recent = hist.slice(startIdx);
  let sale = null;
  let restatement = null;
  let bareName = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const h = recent[i];
    if (!h || h.role !== "user" || typeof h.content !== "string") continue;
    if (!sale) {
      const s = parseSaleSnapshot(h.content, recent, snap, currency);
      if (s) sale = s;
    }
    if (!restatement) {
      const r = parsePartialPayment(h.content);
      if (r && !SALE_VERBS.test(normalizeFastText(h.content))) restatement = r;
    }
    if (!bareName && isBareName(h.content, snap)) bareName = titleCaseName(h.content.trim().replace(/[.!?]+$/, ""));
    if (sale && restatement && bareName) break;
  }
  if (!sale) return null;
  const items = sale.params.items || [];
  const total = saleTotalFromSnapshot(items, snap);
  let paidQty = null;
  if (restatement && restatement.paidQty !== null && restatement.paidQty !== undefined && items.length === 1 && items[0].qty > 0) {
    paidQty = restatement.paidQty;
  } else if (sale.params.amount_paid !== undefined && sale.params.amount_paid !== null && items.length === 1 && items[0].qty > 0) {
    const unit = total / items[0].qty;
    if (unit > 0) paidQty = Math.round(sale.params.amount_paid / unit);
  }
  const unit = items.length === 1 && items[0].qty > 0 ? total / items[0].qty : null;
  const amountPaid = paidQty !== null && unit !== null
    ? Math.round(unit * paidQty * 100) / 100
    : (sale.params.amount_paid !== undefined && sale.params.amount_paid !== null ? sale.params.amount_paid : null);
  const customerName = sale.params.customer_name || bareName || (restatement && restatement.debtorName) || null;
  return { items, total, amountPaid, paidQty, customerName };
}

// The last sale in the thread, even one already recorded: a bare
// follow-up ("And 2 sold today") names no product, so the product
// comes from the most recent sale the owner reported. Unlike
// findLastSaleContext, this looks past "Done. Recorded ..." lines:
// the sale being followed up on is already recorded.
export function findLastThreadSale(history, snap, currency) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-10);
  for (let i = turns.length - 1; i >= 0; i--) {
    const sale = parseSaleSnapshot(turns[i].content, history, snap, currency);
    if (sale && sale.params && sale.params.items && sale.params.items.length) return sale;
  }
  return null;
}

// A bare follow-up sale: "And 2 sold today", "And 1 more", "And sold
// 2 today", "And 2 sold today to Favour". The message names a
// quantity and nothing else, so the product comes from the last sale
// in the thread, never from the words "and 2" as a product name.
// Returns a record_sale action, a one-question reply when the last
// sale named several products or there is no sale to follow up on,
// or null when the message is not a bare follow-up at all (a named
// product, "and 2 laptops", parses as an ordinary sale instead).
export function parseFollowUpSale(text, history, snap, currency) {
  const t = normalizeFastText(text);
  // A trailing customer ("to Favour") belongs to the follow-up, not
  // to the product: strip it first, then read the bare quantity.
  let customerName = "";
  let core = t;
  const tail = t.match(/\s+(?:to|for)\s+([a-z][a-z' ]+?)\s*[.!?]*$/);
  if (tail) {
    customerName = tail[1].trim();
    core = t.slice(0, tail.index).trim();
  }
  let qty = null;
  let m = core.match(/^\s*and\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?(?:sold|sell|sale)?\s*(today|now|yesterday|just)?\s*[.!?]*$/);
  if (m) qty = /^\d+$/.test(m[1]) ? Number(m[1]) : qtyWordToNumber(m[1]);
  if (qty === null) {
    m = core.match(/^\s*and\s+(?:sold|sell)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:more)?\s*(today|now|yesterday|just)?\s*[.!?]*$/);
    if (m) qty = /^\d+$/.test(m[1]) ? Number(m[1]) : qtyWordToNumber(m[1]);
  }
  if (qty === null) {
    m = core.match(/^\s*and\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+more\s*[.!?]*$/);
    if (m) qty = /^\d+$/.test(m[1]) ? Number(m[1]) : qtyWordToNumber(m[1]);
  }
  if (qty === null || !(qty > 0)) return null;
  const last = findLastThreadSale(history, snap, currency);
  if (!last) {
    return { kind: "question", text: "Which product sold? Tell me the product and how many, and I will draft it for your Confirm tap." };
  }
  const items = last.params.items || [];
  if (items.length !== 1) {
    return { kind: "question", text: `Which product: ${items.map((it) => it.product).join(" or ")}?` };
  }
  const params = { items: [{ product: items[0].product, qty }] };
  if (customerName) params.customer_name = titleCaseName(customerName);
  else if (last.params.customer_name) params.customer_name = last.params.customer_name;
  if (last.params.payment_method) params.payment_method = last.params.payment_method;
  return { kind: "action", tool: "record_sale", params };
}

// A quantity correction in the thread: "actually make it 2 laptops",
// "make it 2 laptops", "actually 2 laptops". Returns { qty, product }
// or null. The correction must name a quantity; a bare "make it 2"
// with no product is not one.
export function parseCorrection(text) {
  const t = normalizeFastText(text);
  const m = t.match(/^\s*(?:(actually|no wait|correction)\s+)?(?:(make it|change it to|change it)\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)\s*[.!?]*$/);
  if (!m) return null;
  if (!m[1] && !m[2]) return null;
  const qty = qtyWordToNumber(m[3]);
  const product = (m[4] || "").trim();
  if (qty === null || !product || isQuestionWordsOnly(product)) return null;
  return { qty, product };
}

// A corrected pending sale: a correction turn ("actually make it 2
// laptops") applied to the sale it follows. Returns the corrected sale
// action or null (no correction, no sale, or a different product: the
// normal pending path owns those).
export function findCorrectedPendingSale(history, snap, currency) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-6);
  let correction = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const content = turns[i].content;
    if (!correction) {
      const c = parseCorrection(content);
      if (c) { correction = c; continue; }
    }
    const snapSale = snap ? parseSaleSnapshot(content, turns, snap, currency) : null;
    if (!snapSale) continue;
    // A sale newer than any correction cannot be the corrected one:
    // corrections always follow the sale they correct.
    if (!correction) return null;
    const items = snapSale.params.items || [];
    if (items.length !== 1) return null;
    const matched = matchSnapshotProduct(normalizePluralProduct(correction.product, (snap.products || [])), (snap.products || []));
    if (!matched || matched.name !== items[0].product) return null;
    const unit = saleTotalFromSnapshot(items, snap) / items[0].qty;
    if (!(unit > 0)) return null;
    const newQty = correction.qty;
    const paidQty = snapSale.params.amount_paid !== undefined && snapSale.params.amount_paid !== null
      ? Math.min(Math.round(snapSale.params.amount_paid / unit), newQty)
      : null;
    const params = { items: [{ product: matched.name, qty: newQty }] };
    if (snapSale.params.customer_name) params.customer_name = snapSale.params.customer_name;
    if (paidQty !== null) params.amount_paid = Math.round(unit * paidQty * 100) / 100;
    else if (snapSale.params.amount_paid !== undefined) params.amount_paid = Math.min(snapSale.params.amount_paid, Math.round(unit * newQty * 100) / 100);
    if (snapSale.params.payment_method) params.payment_method = snapSale.params.payment_method;
    return { kind: "action", tool: "record_sale", params };
  }
  return null;
}

// Re-parse a pending sale from the history turn it came from, with the
// snapshot: plural names ("laptops") resolve to the real product
// ("Laptop"), which the pure re-parse cannot do. Returns the
// snapshot-resolved sale action or null.
export function reparsePendingSale(history, pending, snap, currency) {
  if (!pending || pending.kind !== "sale") return null;
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-6);
  for (let i = turns.length - 1; i >= 0; i--) {
    const sale = parseSaleMention(turns[i].content);
    if (!sale || !sale.items || !sale.items.length) continue;
    const sameItems = JSON.stringify(sale.items) === JSON.stringify(pending.items);
    const sameCustomer = (sale.customer_name || "") === (pending.customer_name || "");
    if (!sameItems || !sameCustomer) continue;
    if (snap) {
      const snapSale = parseSaleSnapshot(turns[i].content, history, snap, currency);
      if (snapSale) return snapSale;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Challenge follow-ups: "Really?", "Are you sure?", "That can't be
// right". Re-check the last assistant answer against the current
// snapshot and either correct it or confirm it with the figure, never
// the failure line. When there is no previous figure answer to check
// against, say so plainly.
// ---------------------------------------------------------------------------

const CHALLENGE_RES = [
  /^\s*really\s*[.!?]*$/,
  /^\s*are you (sure|certain)\s*[.!?]*$/,
  /^\s*that (can't|cant|can not) be right\s*[.!?]*$/,
  /^\s*that (is|'s) not right\s*[.!?]*$/,
  /^\s*that (is|'s) wrong\s*[.!?]*$/,
  /^\s*is that (right|correct)\s*[.!?]*$/,
];

export function isChallenge(text) {
  const t = normalizeFastText(text);
  return CHALLENGE_RES.some((re) => re.test(t));
}

// Re-run the read a previous assistant answer came from, against the
// current snapshot. Returns the fresh answer text, or null when the
// previous answer is not a recognisable snapshot read.
export function recheckReadFromAnswer(answer, snap, currency) {
  const a = String(answer || "").trim();
  if (/^No sales yet today\./.test(a) || /^Sales today so far:/.test(a)) return formatTodaySales(snap, currency);
  if (/^No sales yesterday/.test(a) || /^Sales yesterday:/.test(a)) return formatYesterdaySales(snap, currency);
  if (/^No sales yet this month\./.test(a) || /^Sales this month:/.test(a)) return formatMonthSales(snap, currency);
  if (/^No expenses yet this month\./.test(a) || /^Expenses this month:/.test(a)) return formatMonthExpenses(snap, currency);
  if (/^Nobody owes money right now\./.test(a) || /^Customers owing/.test(a)) return formatDebtors(snap, currency);
  if (/^Nothing is running low\./.test(a) || /^Running low:/.test(a)) return formatLowStock(snap, currency);
  if (/^No products added yet\./.test(a) || /^Stock:/.test(a)) return formatStock(snap, currency);
  if (/^No projects yet\./.test(a) || /^Projects \(\d+\)/.test(a)) return formatProjects(snap, currency);
  if (/^No sales recorded yet\./.test(a) || /^Last sales:/.test(a)) return formatRecentSales(snap, currency);
  if (/^No expenses recorded yet\./.test(a) || /^Last expenses:/.test(a)) return formatRecentExpenses(snap, currency);
  return null;
}

export function challengeReply(text, history, snap, currency) {
  const hist = history || [];
  const lastAssistant = [...hist].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string");
  if (!lastAssistant) {
    return { kind: "reply", text: "I do not have that figure. Tell me what to check and I will look it up in your books." };
  }
  const prev = lastAssistant.content.trim();
  const rechecked = recheckReadFromAnswer(prev, snap, currency);
  if (rechecked !== null) {
    if (rechecked === prev) return { kind: "reply", text: `I checked again: ${rechecked}` };
    return { kind: "reply", text: `Yes, let me check again. ${rechecked}` };
  }
  // A proposal is figures too: re-check the sale in the thread from the
  // snapshot and confirm with the fresh figures.
  if (/record sale of/i.test(prev)) {
    const ctx = findLastSaleContext(hist, snap, currency);
    if (ctx) {
      const paid = ctx.amountPaid !== null && ctx.amountPaid !== undefined ? ctx.amountPaid : ctx.total;
      const balance = Math.round((ctx.total - paid) * 100) / 100;
      const itemsDesc = ctx.items.map((it) => `${it.qty} × ${it.product}`).join(", ");
      const who = ctx.customerName || "Walk-in";
      const tail = balance > 0 ? `, with ${formatMoney(balance, currency)} owed by ${who}` : ", nothing owed";
      return { kind: "reply", text: `Yes, I checked the books again: ${itemsDesc}, total ${formatMoney(ctx.total, currency)}, paid ${formatMoney(paid, currency)}${tail}.` };
    }
  }
  return { kind: "reply", text: "I do not have that figure. Tell me what to check and I will look it up in your books." };
}

// ---------------------------------------------------------------------------
// Casual replies: greetings, small talk, reactions, emoji-only messages,
// jokes. Short, warm, in plain words, never a business figure, never a
// claim to be human or to have feelings. One emoji at most, and only
// where it fits. Runs after every business intent, so a business
// message that happens to contain an emoji is never misread as casual.
// ---------------------------------------------------------------------------

export function firstEmoji(text) {
  const m = String(text || "").match(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
  return m ? m[0] : null;
}

export function isEmojiOnly(text) {
  const t = String(text || "").trim();
  if (!t || !(firstEmoji(t) || /[0-9#*]\uFE0F?\u20E3/u.test(t))) return false;
  // Keycap sequences first ("1" + VS16 + U+20E3): a bare digit is not
  // an emoji, but a digit that forms a keycap is. Regional indicators
  // are flags ("NG" is two of them), not pictographs, so they count
  // too. Anything else left over means the message is not emoji-only.
  let stripped = t.replace(/[0-9#*]\uFE0F?\u20E3/gu, "");
  stripped = stripped.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\s.,!?:;]/gu, "");
  return stripped.length === 0;
}

const EMOJI_REPLIES = {
  "🔥": "🔥 Right with you.",
  "👍": "👍 Got it.",
  "😂": "😂 Good one.",
  "🤣": "🤣 Good one.",
  "❤️": "❤️ Right back at you.",
  "🙏": "🙏 Anytime.",
  "🎉": "🎉 Love to see it.",
  "👏": "👏 Thank you.",
  "✅": "✅ Got it.",
  "👋": "👋 Hello.",
  "😀": "😀 Right with you.",
  "😄": "😄 Right with you.",
  "😁": "😁 Right with you.",
  "😎": "😎 Nice.",
  "💪": "💪 Right with you.",
  "🙌": "🙌 Right with you.",
};

export function emojiReply(text) {
  const t = String(text || "").trim();
  if (!t || !(firstEmoji(t) || /[0-9#*]\uFE0F?\u20E3/u.test(t))) return null;
  // One known emoji on its own gets its own line. Anything else
  // (a flag, a keycap, a skin-tone variant, several emojis) is echoed
  // back whole, so a flag never comes back as half a flag.
  const bare = t.replace(/\uFE0F/g, "");
  if (Object.prototype.hasOwnProperty.call(EMOJI_REPLIES, t)) return EMOJI_REPLIES[t];
  if (Object.prototype.hasOwnProperty.call(EMOJI_REPLIES, bare)) return EMOJI_REPLIES[bare];
  return `${t} Right with you.`;
}

export function casualReply(text) {
  if (isEmojiOnly(text)) return emojiReply(text);
  const t = normalizeFastText(text).replace(/[.!?]+$/, "").trim();
  if (/^(lol|lmao|haha|hehe|hahaha|hehehe)$/.test(t)) return "Ha, good one. 😄";
  if (/^(wow|woah|whoa)$/.test(t)) return "I know, right? 😄";
  if (/^(cool|dope|lit)$/.test(t)) return "Cool. 😎";
  if (/^good night$/.test(t)) return "Good night. Talk tomorrow.";
  if (/^(bye|goodbye|good bye|see you|see ya|later)$/.test(t)) return "Goodbye. Talk soon.";
  if (/^(how are you|how are u|how are you doing|how is it going|how are things|how's it going|hows it going)$/.test(t)) return "I am here and ready to help. What do you need for the business today?";
  if (/\btell me a joke\b/.test(t) || /\bmake me laugh\b/.test(t) || /\banother joke\b/.test(t)) return "Why did the ledger break up with the calculator? It could not count on it. 😄";
  if (/^(you are funny|youre funny|you are hilarious|youre hilarious|you are so funny)$/.test(t)) return "Thank you. I do my best. 😄";
  return null;
}

// ---------------------------------------------------------------------------
// Clear chat: "clear old chat", "clearly old chat" (the typo variant:
// "clearly" means "clear" here), "clear chat", "delete old chat".
// Deterministic fast-path intent, never the model. Asking to clear is
// NOT clearing: resolveFastPath only returns the one confirmation
// question, and chat.js clears only on a bare Yes after it. The match
// is anchored to the whole message and to a chat noun, so "clear
// Favour's balance" (a payment) and "clearly I paid ..." never match.
// ---------------------------------------------------------------------------

export const CLEAR_CHAT_QUESTION = "Clear the old chat? Reply Yes and I will clear it.";
export const CLEAR_CHAT_DECLINED = "Understood. I left the chat as it is. Nothing was cleared.";
export const CLEAR_CHAT_DONE = "Done, I have cleared this chat. We are starting fresh.";

const CLEAR_CHAT_RES = [
  /^\s*(please\s+)?(clear|delete|wipe|erase|remove)\s+(the\s+|this\s+|my\s+|our\s+|all\s+)?(old\s+)?(chat|conversation|history|messages?)\s*(please\s*)?[.!?]*$/,
  /^\s*(start fresh|start over|fresh start|new chat)\s*[.!?]*$/,
];

export function isClearChatRequest(text) {
  // "Clearly old chat" is the "clear old chat" typo: "clearly" maps to
  // "clear" as a whole word, nowhere else in the message.
  const t = normalizeFastText(text).replace(/\bclearly\b/g, "clear");
  return CLEAR_CHAT_RES.some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// Answering the assistant's own expense-amount question: "I bought
// fuel" -> "How much was the expense? I need an amount greater than
// zero." -> "5000". The user answered the AI's own question, so the
// amount completes the pending expense from the thread (description
// Fuel, NGN 5,000, proposal for Confirm), never the model and never
// the failure line. The question wording itself lives in chat.js; this
// only recognises it.
// ---------------------------------------------------------------------------

export function isExpenseAmountQuestion(text) {
  return /\bhow much was the expense\b/i.test(String(text || ""))
    || /\bhow much is the expense\b/i.test(String(text || ""));
}

// Parse an answer to the expense-amount question. Reuses the strict
// amount answer ("5000", "5000 naira", "5k") and also allows a "for
// <description>" tail ("5000 for fuel"): the tail names the expense
// when the user repeats it. Returns { amount, description } with
// description "" when the answer carries no tail, or null when the
// message is not an amount answer at all.
export function parseExpenseAmountAnswer(text) {
  const plain = parseAmountAnswer(text);
  if (plain && plain.amount > 0) return { amount: plain.amount, description: "" };
  const t = normalizeFastText(text);
  const amounts = findAllAmounts(t);
  if (amounts.length !== 1) return null;
  const a = amounts[0];
  const before = t.slice(0, a.index).trim();
  const after = t.slice(a.index + a.length).trim();
  // Nothing before the amount, and after it only a currency word, a
  // "for <description>" tail, or a currency word then the tail
  // ("5000 naira for fuel"). Anything else is a fresh statement, not
  // an answer to the question.
  if (before) return null;
  if (!after) return { amount: a.value, description: "" };
  let tail = after;
  const firstWord = tail.split(/\s+/)[0].replace(/[^a-z]/g, "");
  if (CURRENCY_WORDS.includes(firstWord)) tail = tail.slice(tail.indexOf(" ") + 1).trim();
  if (!tail) return { amount: a.value, description: "" };
  const forTail = tail.match(/^for\s+(.+)$/);
  if (forTail) {
    const description = cleanExpenseDescription(forTail[1]);
    if (!description) return null;
    return { amount: a.value, description };
  }
  const leftover = tail.replace(/[^a-z]/g, "");
  if (leftover && CURRENCY_WORDS.includes(leftover)) return { amount: a.value, description: "" };
  return null;
}

// The expense awaiting an amount: re-parse the user turns since the
// last "Done. Recorded ..." line with the expense parser and return
// the most recent one that has a description but no amount (the "I
// bought fuel" turn). Returns null when no such turn exists.
export function resolvePendingExpense(history, snap) {
  const hist = history || [];
  let startIdx = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.role === "assistant" && typeof h.content === "string" && /Done\. Recorded (payment|sale|expense)/.test(h.content)) {
      startIdx = i + 1;
      break;
    }
  }
  const recent = hist.slice(startIdx);
  for (let i = recent.length - 1; i >= 0; i--) {
    const h = recent[i];
    if (!h || h.role !== "user" || typeof h.content !== "string") continue;
    const e = parseExpenseMention(h.content, snap);
    if (e && e.description && !(e.amount > 0)) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator: message + history + snapshot -> fast-path result or null.
// ---------------------------------------------------------------------------

export function resolveFastPath(message, history, snap, currency) {
  const text = String(message || "").trim();
  if (!text) return null;
  const t = normalizeFastText(text);

  // 0. Clear chat: ask the one confirmation question, never clear on
  // the words alone and never fall to the model. chat.js owns the
  // question store and the Yes-after-question execution.
  if (isClearChatRequest(text)) {
    return { kind: "clearchat_question", text: CLEAR_CHAT_QUESTION };
  }

  // 1. "Record it" (and its variations): resolve the pending mention from
  // the recent turns. No mention -> one short line, not a dump.
  if (isRecordIt(text)) {
    const corrected = findCorrectedPendingSale(history, snap, currency);
    if (corrected) return corrected;
    const pending = findPendingMention(history, snap, currency);
    if (!pending) {
      return { kind: "reply", text: "I do not have anything to record yet. Tell me what happened, for example 'Favour paid 1000000'." };
    }
    if (pending.kind === "question") {
      return { kind: "reply", text: pending.text };
    }
    if (pending.kind === "payment") {
      // A pronoun in the mention ("He paid 5000") resolves to the last
      // customer talked about; with no antecedent, ask instead of
      // recording against a customer called "He".
      if (pending.customer_name && isPronounWord(pending.customer_name.split(" ")[0])) {
        const debtor = resolvePronounCustomer(history, snap);
        if (!debtor) {
          return { kind: "reply", text: "Who paid? Tell me the customer's name and the amount, and I will draft it for your Confirm tap." };
        }
        return { kind: "action", tool: "record_customer_payment", params: { customer_name: debtor.name, amount: pending.amount } };
      }
      return { kind: "action", tool: "record_customer_payment", params: { customer_name: pending.customer_name, amount: pending.amount } };
    }
    if (pending.kind === "sale") {
      const resolved = reparsePendingSale(history, pending, snap, currency);
      if (resolved) return resolved;
      return { kind: "action", tool: "record_sale", params: pending };
    }
    return { kind: "action", tool: "add_expense", params: withExpenseCategory({ amount: pending.amount, description: pending.description }) };
  }

  // 1b. Project interview continuation: answer the executor's own
  // type or goal question from the recent history, deterministically.
  // A bare type word after the type question, or any message after
  // the goal question, continues the interview instead of falling
  // to the model.
  const interview = findProjectInterviewAnswer(text, history);
  if (interview) return interview;

  // 1c. Sales on a named day: "What did I sell on Friday?", "What did
  // I sell on 2 November?" A date question must never reach the
  // payment or sale parsers: they would read the date as a product
  // name. Today and yesterday, named by those exact words, stay on
  // step 6, which already owns those phrasings; a weekday that happens
  // to fall on today or yesterday still answers here, because step 6
  // only owns the words "today" and "yesterday". When the per-day map
  // is absent the formatter returns null and the message falls through,
  // never a guessed figure.
  const dateMention = parseDateMention(text, snap && snap.businessDate);
  if (dateMention && !dateMention.relative) {
    const isDateQuestion = /^\s*(what|how|show|list|tell)\b/.test(t) || /\?\s*$/.test(t);
    if (isDateQuestion && /\b(sell|sold|sale|sales)\b/.test(t)) {
      const dated = formatSalesOnDate(snap, currency, dateMention.date, dateMention.label);
      if (dated !== null) return { kind: "reply", text: dated };
    }
  }

  // 2. Full-balance payment: "Favour have paid the full balance he owe
  // now", "Favour paid in full", "Favour cleared his balance". The
  // amount is the snapshot balance, never asked for, never invented.
  // A sale-payment answer first: "paid in full" to "How much did they
  // pay?" completes the pending sale, it is not a customer full-balance
  // payment. Only when the last assistant turn asked the sale question
  // and this message resolves as its answer.
  const pendingSaleFull = findPendingSalePayment(history, snap, currency);
  if (pendingSaleFull) {
    // "Paid half" with no computable total: ask what half is, never
    // default to full. A total the snapshot cannot price is a missing
    // piece, not a guess.
    if (/\bpaid\s+half\b/.test(t) && !(pendingSaleFull.total > 0)) {
      return { kind: "reply", text: "How much is half? I do not have that item's price, so I cannot work it out." };
    }
    const salePaymentFull = parseSalePaymentAnswer(text, pendingSaleFull.total);
    if (salePaymentFull) {
      return { kind: "action", tool: "record_sale", params: { ...pendingSaleFull.params, amount_paid: salePaymentFull.amount, ...(salePaymentFull.method ? { payment_method: salePaymentFull.method } : {}) } };
    }
  }
  if (isFullBalancePayment(text)) {
    const full = parseFullBalanceMention(text, history, snap);
    if (full && full.amount > 0) {
      return { kind: "action", tool: "record_customer_payment", params: { customer_name: full.customer_name, amount: full.amount } };
    }
    if (full) {
      return { kind: "reply", text: `${full.customer_name} has no outstanding balance, so there is nothing to record.` };
    }
    const named = findDebtorsInText(text, snap);
    if (named.length > 1) {
      return { kind: "reply", text: `More than one customer could be meant: ${named.map((d) => d.name).join(", ")}. Which one paid in full?` };
    }
    return { kind: "reply", text: "Who paid in full? Tell me the customer's name and I will draft it for your Confirm tap." };
  }

  // 2a. Answer to the assistant's own amount question: the previous
  // assistant turn asked "How much did Favour pay?" (or similar) and
  // this message answers it, with a bare amount ("637,820") or with
  // "full debts 637,820" (the amount IS the full balance being
  // confirmed). The customer comes from the question or the recent
  // turns, never from a guess. The question must be the most recent
  // assistant turn, so no "Done. Recorded ..." line can sit after it
  // and a recorded mention is never resurrected.
  let lastAssistantIdx = -1;
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.role === "assistant" && typeof h.content === "string") { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx >= 0 && isAmountQuestion(history[lastAssistantIdx].content)) {
    // A sale-payment question first: the last assistant turn asked "How
    // much did they pay?" about a sale the user reported, so the answer
    // completes that sale, never a customer payment. A fresh statement
    // (a named payment, a new sale, a read) is not an answer: it falls
    // through to its own step instead of re-asking the question.
    const pendingSale = findPendingSalePayment(history, snap, currency);
    if (pendingSale) {
      if (/\bpaid\s+half\b/.test(t) && !(pendingSale.total > 0)) {
        return { kind: "reply", text: "How much is half? I do not have that item's price, so I cannot work it out." };
      }
      const salePayment = parseSalePaymentAnswer(text, pendingSale.total);
      if (salePayment) {
        return { kind: "action", tool: "record_sale", params: { ...pendingSale.params, amount_paid: salePayment.amount, ...(salePayment.method ? { payment_method: salePayment.method } : {}) } };
      }
      const fresh = parsePaymentMention(text) || SALE_VERBS.test(t) || classifyReadIntent(text) || isFullBalancePayment(text) || parsePartialPayment(text);
      if (!fresh) return { kind: "reply", text: pendingSale.question };
    }
    const answer = parseAmountAnswer(text);
    if (answer) {
      const debtor = resolveAmountAnswerCustomer(history, snap);
      if (!debtor) {
        return { kind: "reply", text: "Who did that payment come from? Tell me the customer's name and I will draft it for your Confirm tap." };
      }
      const amount = answer.amount !== null && answer.amount !== undefined ? answer.amount : Number(debtor.balance) || 0;
      if (!(amount > 0)) {
        return { kind: "reply", text: `${debtor.name} has no outstanding balance, so there is nothing to record.` };
      }
      return { kind: "action", tool: "record_customer_payment", params: { customer_name: debtor.name, amount } };
    }
  }

  // 2a-expense. Answer to the assistant's own expense-amount
  // question ("How much was the expense?"): a bare amount ("5000"),
  // "5000 naira", "5k", or "5000 for fuel" completes the pending
  // expense from the thread, never the model. When the message is not
  // an amount answer, re-ask the same question instead of failing:
  // the user is mid-answer to the AI's own question.
  if (lastAssistantIdx >= 0 && isExpenseAmountQuestion(history[lastAssistantIdx].content)) {
    const expenseAnswer = parseExpenseAmountAnswer(text);
    if (expenseAnswer && expenseAnswer.amount > 0) {
      const pending = resolvePendingExpense(history, snap);
      const description = expenseAnswer.description || (pending && pending.description) || "";
      if (!description) {
        return { kind: "reply", text: "What was the expense for? Tell me what it was for and I will draft it for your Confirm tap." };
      }
      return { kind: "action", tool: "add_expense", params: withExpenseCategory({ amount: expenseAnswer.amount, description }) };
    }
    // A zero amount, or a bare amount-like reply that could not be
    // read as money, gets the same question again, never the failure
    // line. Anything else (a new question, a cancel, a fresh
    // statement) falls through to its own step.
    if (expenseAnswer || /^\s*[\d,.]+(\s*(k|m|thousand|million|naira|ngn))?\s*[.!?]*$/.test(t)) {
      return { kind: "reply", text: "How much was the expense? I need an amount greater than zero." };
    }
  }

  // 2a2. The thread, not just the latest message.
  // A partial-payment restatement ("They paid for 2 and owe for 1")
  // resolves its amount from the last sale in the thread and asks only
  // for what is genuinely missing: the customer name. Never the amount:
  // the last sale already fixes paid 2 of 3. A restatement with no sale
  // behind it asks which sale it was.
  const partialRest = parsePartialPayment(text);
  if (partialRest && !SALE_VERBS.test(t) && /^\s*(they|he|she|it|paid)\b/.test(t)) {
    const ctx = findLastSaleContext(history, snap, currency);
    if (!ctx) {
      return { kind: "reply", text: "Which sale was that? Tell me the product and how many they paid for." };
    }
    const name = partialRest.debtorName
      || (findDebtorsInText(text, snap)[0] || {}).name
      || null;
    if (name) {
      const params = { items: ctx.items, customer_name: name };
      if (ctx.amountPaid !== null && ctx.amountPaid !== undefined) params.amount_paid = ctx.amountPaid;
      return { kind: "action", tool: "record_sale", params };
    }
    return { kind: "reply", text: "Who paid?" };
  }
  // A bare name answering the AI's own name question ("Who paid?",
  // "Who owes for the remaining laptop?"): apply the name to the
  // pending partial sale in the thread. Bare "Yes"/"No"/"Confirm" are
  // deliberately not names: they return null here and reach the
  // Confirm handler in chat.js.
  const lastAssistantForName = [...(history || [])].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string");
  if (lastAssistantForName && /who paid\?|who owes for the remaining/i.test(lastAssistantForName.content) && isBareName(text, snap)) {
    const ctx = findLastSaleContext(history, snap, currency);
    if (ctx && ctx.items && ctx.items.length) {
      const params = { items: ctx.items, customer_name: titleCaseName(text.trim().replace(/[.!?]+$/, "")) };
      if (ctx.amountPaid !== null && ctx.amountPaid !== undefined) params.amount_paid = ctx.amountPaid;
      return { kind: "action", tool: "record_sale", params };
    }
  }
  // A quantity correction ("actually make it 2 laptops") corrects the
  // last sale in the thread instead of starting a fresh sale.
  const correction = parseCorrection(text);
  if (correction) {
    const ctx = findLastSaleContext(history, snap, currency);
    if (ctx && ctx.items && ctx.items.length === 1) {
      const matched = matchSnapshotProduct(normalizePluralProduct(correction.product, (snap && snap.products) || []), (snap && snap.products) || []);
      if (matched && matched.name === ctx.items[0].product) {
        const unit = ctx.total / ctx.items[0].qty;
        if (unit > 0) {
          const paidQty = ctx.paidQty !== null && ctx.paidQty !== undefined ? Math.min(ctx.paidQty, correction.qty) : null;
          const params = { items: [{ product: matched.name, qty: correction.qty }] };
          if (ctx.customerName) params.customer_name = ctx.customerName;
          if (paidQty !== null) params.amount_paid = Math.round(unit * paidQty * 100) / 100;
          else if (ctx.amountPaid !== null && ctx.amountPaid !== undefined) params.amount_paid = Math.min(ctx.amountPaid, Math.round(unit * correction.qty * 100) / 100);
          return { kind: "action", tool: "record_sale", params };
        }
      }
    }
  }

  // 2a3. Early expense routing, before the payment intent: shapes the
  // payment parser would swallow as a customer name ("I My Staff",
  // "I Rent", "I 3 Staff"). A staff salary, a give-to-someone expense,
  // a first-person paid expense and a supplier order all live here. A
  // real payment still wins: "I paid Favour 5000 for transport" pays
  // Favour, so the give/first-person shapes only run when the payment
  // parser finds no payment.
  const staffPay = parseStaffPayment(text, snap, currency);
  if (staffPay) {
    if (staffPay.question) return { kind: "reply", text: staffPay.question };
    return { kind: "action", tool: "add_expense", params: staffPay.params };
  }
  // The give shape ("I gave the cleaner 1500") is an expense unless the
  // recipient is a known customer: parseGiveExpense already returns null
  // for one, so it runs before the payment parser instead of behind it.
  const giveExpense = parseGiveExpense(text, snap);
  if (giveExpense) {
    return { kind: "action", tool: "add_expense", params: withExpenseCategory(giveExpense) };
  }
  if (!parsePaymentMention(text)) {
    const firstExpense = parseFirstPersonExpense(text, snap);
    if (firstExpense && (firstExpense.amount || firstExpense.description)) {
      return { kind: "action", tool: "add_expense", params: withExpenseCategory(firstExpense) };
    }
  }
  const supplierOrder = parseSupplierOrder(text, snap, currency);
  if (supplierOrder) {
    if (supplierOrder.question) return { kind: "reply", text: supplierOrder.question };
    return { kind: "action", tool: "add_expense", params: supplierOrder.params };
  }

  // 2b. Direct payment mention: "Favour paid 1000000" -> propose it now.
  // A pronoun ("He paid 5000") resolves to the last customer talked
  // about; with no antecedent, one short question instead of a guess.
  // A payment with a name but no amount and no full-balance marker
  // ("Favour paid") asks how much, instead of falling to the model.
  // A message that parses as a sale against the snapshot is a sale, not
  // a payment: "Someone bought 5 fvamail now and paid in full" has a
  // quantity (5) that the payment parser would read as the amount and
  // the rest as a customer name. Step 11 owns it. The same holds when
  // the product is outside the snapshot's list: "I sold 3 widgets now
  // they paid half" is a sale whose total is unknown, not a payment
  // from a customer called "Sold Widgets".
  const salePaymentShape = SALE_VERBS.test(t) && (/\b(paid|pay)\b[^.]{0,25}\b(full|half)\b/.test(t) || /\bpaid\s+for\s+\d/.test(t));
  const payment = (parseSaleSnapshot(text, history, snap, currency) || salePaymentShape) ? null : parsePaymentMention(text);
  if (payment) {
    if (isPronounWord(payment.customer_name.split(" ")[0])) {
      const debtor = resolvePronounCustomer(history, snap);
      if (!debtor) {
        return { kind: "reply", text: "Who paid? Tell me the customer's name and the amount, and I will draft it for your Confirm tap." };
      }
      return { kind: "action", tool: "record_customer_payment", params: { customer_name: debtor.name, amount: payment.amount } };
    }
    return { kind: "action", tool: "record_customer_payment", params: { customer_name: payment.customer_name, amount: payment.amount } };
  }
  // A question starting with "who" ("Who has not paid") is a read about
  // who owes, never a payment statement: the debtors read owns it.
  // A sale sentence ("I sold another laptop to somebody he paid in
  // full") never lands here: the "he" pronoun has no debtor antecedent
  // and would ask "Who paid, and how much?" instead of proposing the
  // sale. The sale step (step 11) owns any message with a sale verb.
  if (PAYMENT_VERBS.test(t) && !SALE_VERBS.test(t) && !findAllAmounts(t).length && !isDebtorRemindRequest(text) && !/^\s*who\b/.test(t)) {
    const named = findDebtorsInText(text, snap);
    if (named.length === 1) {
      return { kind: "reply", text: `How much did ${named[0].name} pay?` };
    }
    if (PRONOUN_WORDS.some((p) => new RegExp("\\b" + p + "\\b").test(t))) {
      const debtor = resolvePronounCustomer(history, snap);
      if (debtor) {
        return { kind: "reply", text: `How much did ${debtor.name} pay?` };
      }
      return { kind: "reply", text: "Who paid, and how much?" };
    }
    // A name the snapshot has no balance for ("Zlatan paid"): still a
    // payment question, never the model, never an invented amount.
    const nameOnly = t
      .replace(PAYMENT_FILLER, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
      .trim();
    if (nameOnly && !/^(i|we)$/.test(nameOnly) && nameOnly.split(/\s+/).length <= 4) {
      return { kind: "reply", text: `How much did ${titleCaseName(nameOnly)} pay?` };
    }
  }

  // 3. Send the approved debtor draft.
  if (/\bsend\b/.test(t)) {
    const send = parseSendDebtor(text, history);
    if (send) {
      return { kind: "action", tool: "send_debtor_message", params: { customer_name: send.customer_name, message: send.message } };
    }
    // A remind request ("Send Favour a reminder") is not a send-it: the
    // debtor-remind step below owns it, so it must not get this reply.
    if (/\b(it|that|this|message|reminder)\b/.test(t) && !isDebtorRemindRequest(text)) {
      return { kind: "reply", text: "I do not have a message to send yet. Tell me who to remind and I will draft it first." };
    }
  }

  // 4a. Remind-a-debtor: "Remind Favour how much he owes", "Remind him
  // of the balance on WhatsApp", "Send Favour a reminder", "WhatsApp
  // Favour about his balance", "Chase Favour". Runs before the balance
  // step on purpose: the balance parser would otherwise read the whole
  // sentence as a customer name ("Remind Favour It"). One remind
  // request produces exactly one proposal card showing the draft.
  if (isDebtorRemindRequest(text)) {
    const tone = detectDebtorTone(text);
    const named = findDebtorsInText(text, snap);
    if (named.length > 1) {
      return { kind: "reply", text: `More than one customer could be meant: ${named.map((d) => d.name).join(", ")}. Who should I remind?` };
    }
    if (named.length === 1) {
      const debtor = named[0];
      if (!(Number(debtor.balance) > 0)) {
        return { kind: "reply", text: `${debtor.name} has no outstanding balance, so there is no reminder to write.` };
      }
      const draft = buildDebtorDraft(debtor.name, debtor.balance, currency, snap.businessName, tone);
      return {
        kind: "action",
        tool: "send_debtor_message",
        params: { customer_name: debtor.name, message: draft, _fastpathDraft: true },
      };
    }
    // No debtor name in the text. A clean name beats a pronoun: in
    // "Remind Zlatan how much he owes", "he" refers to Zlatan, not to
    // whoever was talked about before. Only a bare pronoun ("Remind him
    // of the balance") resolves from history.
    const cleanName = extractRemindName(text);
    if (!cleanName && PRONOUN_WORDS.some((p) => new RegExp("\\b" + p + "\\b").test(t))) {
      const debtor = resolvePronounCustomer(history, snap) || ((snap.debtors || []).length === 1 ? snap.debtors[0] : null);
      if (!debtor) {
        const owing = (snap.debtors || []).map((d) => d.name);
        return { kind: "reply", text: owing.length > 1
          ? `Who should I remind: ${owing.join(", ")}?`
          : "Who should I remind? Tell me the customer's name." };
      }
      if (!(Number(debtor.balance) > 0)) {
        return { kind: "reply", text: `${debtor.name} has no outstanding balance, so there is no reminder to write.` };
      }
      const draft = buildDebtorDraft(debtor.name, debtor.balance, currency, snap.businessName, tone);
      return {
        kind: "action",
        tool: "send_debtor_message",
        params: { customer_name: debtor.name, message: draft, _fastpathDraft: true },
      };
    }
    // No debtor in the snapshot, but a clean name: let the executor do
    // the real database lookup, which returns the proper one-line
    // not-found reply. The name here is the cleaned extraction only,
    // never the raw sentence, so the model never invents a name like
    // "Remind Favour It".
    if (cleanName) {
      return { kind: "action", tool: "draft_debtor_message", params: { customer_name: cleanName, tone } };
    }
    const owing = (snap.debtors || []).map((d) => d.name);
    return { kind: "reply", text: owing.length > 1
      ? `Who should I remind: ${owing.join(", ")}?`
      : "Who should I remind? Tell me the customer's name." };
  }

  // 3b. What the owner owes suppliers: never a balance lookup for a
  // customer called "Suppliers". Runs before the balance step on
  // purpose: parseBalanceQuery would read "suppliers" as a name.
  if (classifyReadIntent(text) === "mydebts") {
    return { kind: "reply", text: MY_DEBTS_ANSWER };
  }

  // 4. Balance question for one customer (including pronouns: "how much
  // does he owe", "what is his balance").
  const balance = parseBalanceQuery(text);
  if (balance) {
    if (isPronounWord(balance.customer_name.split(" ")[0])) {
      const debtor = resolvePronounCustomer(history, snap);
      if (!debtor) {
        return { kind: "reply", text: "Who do you mean? Tell me the customer's name and I will check their balance." };
      }
      return { kind: "action", tool: "get_customer_balance", params: { customer_name: debtor.name } };
    }
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
        // Not in the snapshot's debtor list: route the same way the
        // debtor draft does, so the executor does the real database
        // lookup and returns its one-line no-balance reply for a
        // customer who owes nothing, or its not-found reply for a
        // stranger. Never the model, never an invented balance.
        return { kind: "action", tool: "draft_debtor_message", params: { customer_name: draftReq.customer_name, tone: draftReq.tone } };
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
  if (read === "yesterday") {
    const y = formatYesterdaySales(snap, currency);
    if (y !== null) return { kind: "reply", text: y };
  }
  if (read === "thisweek") {
    const w = formatWeekSales(snap, currency, "this");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "lastweek") {
    const w = formatWeekSales(snap, currency, "last");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "year") {
    const w = formatWindowSales(snap, currency, "year");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "weekseries") {
    const s = formatWeekSeries(snap, currency);
    if (s !== null) return { kind: "reply", text: s };
  }
  if (read === "bestdayweek") {
    const s = formatBestDayWeek(snap, currency);
    if (s !== null) return { kind: "reply", text: s };
  }
  if (read === "bestseller") {
    const window = /\blast week\b/.test(t) ? "lastweek"
      : /\blast month\b/.test(t) ? "lastmonth"
      : /\blast year\b/.test(t) ? "lastyear"
      : /\bthis year\b/.test(t) ? "year"
      : /\bthis week\b/.test(t) ? "week"
      : /\bthis month\b/.test(t) ? "month"
      : "all";
    const s = formatBestSeller(snap, currency, window);
    if (s !== null) return { kind: "reply", text: s };
    // A recognised best-seller question never falls through to the
    // sale step: without this, the sale parser would read the question
    // words ("what best ?") as a product name. Say plainly that the
    // breakdown is missing instead.
    return { kind: "reply", text: "I cannot name a best seller from the figures I have. Your sales totals are there, but no product breakdown for that window." };
  }
  if (read === "monthsales") {
    const m = parseMonthMention(text, snap && snap.businessDate);
    if (m) {
      const s = formatMonthSalesDetail(snap, currency, m);
      if (s !== null) return { kind: "reply", text: s };
    }
  }
  if (read === "monthreport") {
    const m = parseMonthMention(text, snap && snap.businessDate) || parseMonthMention("this month", snap && snap.businessDate);
    if (m) {
      const report = formatMonthReport(snap, currency, m);
      if (report !== null) return { kind: "reply", text: report };
    }
  }
  if (read === "weekreport") {
    const w = formatWeekReport(snap, currency, /\blast week\b/.test(t) ? "last" : "this");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "yearreport") {
    const y = parseYearMention(text, snap && snap.businessDate) || parseYearMention("this year", snap && snap.businessDate);
    if (y) {
      const report = formatYearReport(snap, currency, y);
      if (report !== null) return { kind: "reply", text: report };
    }
  }
  if (read === "lastyearsales") {
    const y = parseYearMention(text, snap && snap.businessDate);
    if (y) {
      const s = formatYearSalesDetail(snap, currency, y);
      if (s !== null) return { kind: "reply", text: s };
    }
  }
  if (read === "todayactivity") {
    const report = formatDayReport(snap, currency, "today");
    if (report !== null) return { kind: "reply", text: report };
  }
  if (read === "yesterdayactivity") {
    const report = formatDayReport(snap, currency, "yesterday");
    if (report !== null) return { kind: "reply", text: report };
  }
  if (read === "lastyearexpenses") {
    const y = parseYearMention(text, snap && snap.businessDate);
    if (y) {
      const w = formatYearExpenses(snap, currency, y);
      if (w !== null) return { kind: "reply", text: w };
    }
  }
  if (read === "lastmonthexpenses") {
    const m = parseMonthMention(text, snap && snap.businessDate);
    if (m) {
      const w = formatMonthExpensesFor(snap, currency, m);
      if (w !== null) return { kind: "reply", text: w };
    }
  }
  if (read === "yesterdayexpenses") {
    const w = formatWindowExpenses(snap, currency, "yesterday");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "customersales") {
    const name = extractCustomerSalesName(text);
    if (name) {
      const s = formatCustomerSales(snap, currency, name);
      if (s !== null) return { kind: "reply", text: s };
    }
  }
  if (read === "projectspend") {
    const name = extractProjectSpendName(text);
    if (!name) {
      const projects = (snap && snap.projects) || [];
      return { kind: "reply", text: projects.length ? `Which project? ${projects.map((p) => p.name).join(", ")}.` : "You have no projects yet." };
    }
    const s = formatProjectSpend(snap, currency, name);
    if (s !== null) return { kind: "reply", text: s };
  }
  if (read === "mybusiness") {
    const b = formatMyBusiness(snap);
    if (b !== null) return { kind: "reply", text: b };
  }
  if (read === "dayreport") {
    const day = /\byesterday\b/.test(t) ? "yesterday" : "today";
    const report = formatDayReport(snap, currency, day);
    if (report !== null) return { kind: "reply", text: report };
  }
  if (read === "yesno") {
    const answer = formatYesNoCount(text, history, snap);
    if (answer !== null) return { kind: "reply", text: answer };
  }
  if (read === "myplan") {
    const plan = formatMyPlan(snap);
    if (plan !== null) return { kind: "reply", text: plan };
  }
  if (read === "mydebts") return { kind: "reply", text: MY_DEBTS_ANSWER };
  if (read === "stockcost") return { kind: "reply", text: formatStockCost(snap, currency) };
  if (read === "topdebtor") return { kind: "reply", text: formatTopDebtor(snap, currency) };
  if (read === "totalowed") return { kind: "reply", text: formatTotalOwed(snap, currency) };
  if (read === "overdue") {
    const o = formatOverdue(snap, currency);
    if (o !== null) return { kind: "reply", text: o };
  }
  if (read === "staffnames") {
    // A bare names question ("What is there names") only means staff
    // when the thread just talked about staff: the previous assistant
    // turn answered a staff question. An explicit staff phrase answers
    // straight away; with no staff context the question is ambiguous
    // and gets one short question instead of a guessed list.
    const explicit = /\bstaff\b/.test(t) || /\bwho works\b/.test(t);
    if (explicit) return { kind: "reply", text: formatStaffList(snap) };
    const lastAssistant = [...(history || [])].reverse().find((h) => h && h.role === "assistant" && typeof h.content === "string");
    if (lastAssistant && /\bstaff\b/i.test(lastAssistant.content)) {
      return { kind: "reply", text: formatStaffList(snap) };
    }
    return { kind: "reply", text: "Whose names do you mean: your staff, your customers, or your products?" };
  }
  if (read === "productprice") {
    const p = formatProductQuestion(text, snap, currency, "price");
    if (p !== null) return { kind: "reply", text: p };
  }
  if (read === "productstock") {
    const p = formatProductQuestion(text, snap, currency, "stock");
    if (p !== null) return { kind: "reply", text: p };
  }
  if (read === "month") return { kind: "reply", text: formatMonthSales(snap, currency) };
  if (read === "monthexpenses") return { kind: "reply", text: formatMonthExpenses(snap, currency) };
  if (read === "monthexpenseword") {
    const m = text.match(/^\s*(?:what did (?:i|we) spend on|how much did (?:i|we) spend on)\s+(.+?)\s+(?:(?:last|this|next)\s+month|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)(?:\s+\d{4})?)\s*[.!?]*$/i);
    const month = parseMonthMention(text, snap && snap.businessDate);
    if (m && month) {
      const s = formatMonthExpenseWord(snap, currency, m[1], month);
      if (s !== null) return { kind: "reply", text: s };
    }
  }
  if (read === "todayexpenses") {
    const w = formatWindowExpenses(snap, currency, "today");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "weekexpenses") {
    const w = formatWindowExpenses(snap, currency, "week");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "yearexpenses") {
    const w = formatWindowExpenses(snap, currency, "year");
    if (w !== null) return { kind: "reply", text: w };
  }
  if (read === "grossprofit") return { kind: "reply", text: formatGrossProfit(snap, currency) };
  if (read === "profit") {
    // One window asked for gets one window's answer, never all four:
    // "How much profit did I make last month?" answers last month.
    // A bare "How much profit?" and a message naming several windows
    // ("today, week, months and year") keep the all-window answer.
    const has = (re) => re.test(t);
    let windowAsked = null;
    if (has(/\blast year\b/)) windowAsked = "lastyear";
    else if (has(/\blast month\b/)) windowAsked = "lastmonth";
    else if (has(/\blast week\b/)) windowAsked = "lastweek";
    else {
      const found = [];
      if (has(/\btoday\b/)) found.push("today");
      if (has(/\bweeks?\b/)) found.push("week");
      if (has(/\bmonths?\b/)) found.push("month");
      if (has(/\byears?\b/)) found.push("year");
      if (found.length === 1) windowAsked = found[0];
    }
    if (windowAsked) {
      const single = formatSingleProfit(snap, currency, windowAsked);
      if (single !== null) return { kind: "reply", text: single };
    }
    return { kind: "reply", text: formatProfit(snap, currency) };
  }
  if (read === "advice") return { kind: "reply", text: formatBusinessAdvice(snap, currency) };
  if (read === "inventoryvalue") return { kind: "reply", text: formatInventoryValue(snap, currency) };
  if (read === "activitylog") {
    const scope = /\b(log\s*out|logout)\b/.test(t) ? "logouts" : /\b(log\s*in|login)\b/.test(t) ? "logins" : /\btoday\b/.test(t) ? "today" : "all";
    return { kind: "activitylog", scope };
  }
  if (read === "countprojects") return { kind: "reply", text: formatCountProjects(snap, currency) };
  if (read === "countstaff") return { kind: "reply", text: formatCountStaff(snap, currency) };
  if (read === "countcustomers") return { kind: "reply", text: formatCountCustomers(snap, currency) };
  if (read === "countsalestoday") return { kind: "reply", text: formatCountSalesToday(snap, currency) };
  if (read === "countsalesmonth") {
    const c = formatCountSalesWindow(snap, currency, "month");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countsalesweek") {
    const c = formatCountSalesWindow(snap, currency, "week");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countsalesyear") {
    const c = formatCountSalesWindow(snap, currency, "year");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countsaleslastweek") {
    const c = formatCountSalesWindow(snap, currency, "lastweek");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countsaleslastmonth") {
    const c = formatCountSalesWindow(snap, currency, "lastmonth");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countsaleslastyear") {
    const c = formatCountSalesWindow(snap, currency, "lastyear");
    if (c !== null) return { kind: "reply", text: c };
  }
  if (read === "countproducts") return { kind: "reply", text: formatCountProducts(snap, currency) };
  if (read === "debtors") return { kind: "reply", text: formatDebtors(snap, currency) };
  if (read === "stock") return { kind: "reply", text: formatStock(snap, currency) };
  if (read === "products") return { kind: "reply", text: formatStock(snap, currency) };
  if (read === "customers") return { kind: "reply", text: formatDebtors(snap, currency) };
  if (read === "projects") return { kind: "reply", text: formatProjects(snap, currency) };
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

  // 10b. Bare write intent ("Record payment", "Record a sale", "Log
  // expense"): no slots in this message, so use the recent chat. Scan
  // the last few user turns after the last "Done. Recorded ..." line
  // (a mention already recorded must never be resurrected) and re-parse
  // the most recent mention of that kind with the full parsers. If
  // nothing resolves, a payment asks one short question; a sale or
  // expense falls through to the existing chip flow, whose executor
  // asks its own one targeted question.
  const bareMatch = text.match(/^\s*(record|log|save)\s+(a\s+|an\s+)?(payment|sale|expense)s?\s*[.!?]*\s*$/i);
  // A bare confirmation ("Full payment", "Full debts 637,820") is a
  // write intent too: it confirms the payment just talked about, so it
  // re-parses the recent turns exactly like "Record payment" does.
  const bareFullPayment = /^\s*(the\s+)?full\s+payment\s*[.!?]*\s*$/i.test(text);
  const bareFullDebts = /^\s*(the\s+)?full\s+debts?\b/i.test(text)
    && findAllAmounts(text).length === 1 && parseAmountAnswer(text) !== null;
  if (bareMatch || bareFullPayment || bareFullDebts) {
    const bareKind = bareMatch ? bareMatch[3].toLowerCase() : "payment";
    const histArr = history || [];
    // Only turns after the last "Done. Recorded ..." line: a mention
    // already recorded must never be resurrected.
    let startIdx = 0;
    for (let i = histArr.length - 1; i >= 0; i--) {
      const h = histArr[i];
      if (h && h.role === "assistant" && typeof h.content === "string" && /Done\. Recorded (payment|sale|expense)/.test(h.content)) {
        startIdx = i + 1;
        break;
      }
    }
    const recentUser = [];
    for (let i = histArr.length - 1; i >= startIdx && recentUser.length < 4; i--) {
      const h = histArr[i];
      if (h && h.role === "user" && typeof h.content === "string") recentUser.push(h.content);
    }
    for (const content of recentUser) {
      if (bareKind === "payment") {
        const p = parsePaymentMention(content);
        if (p) {
          if (isPronounWord(p.customer_name.split(" ")[0])) {
            const debtor = resolvePronounCustomer(history, snap);
            if (debtor) return { kind: "action", tool: "record_customer_payment", params: { customer_name: debtor.name, amount: p.amount } };
            continue;
          }
          return { kind: "action", tool: "record_customer_payment", params: { customer_name: p.customer_name, amount: p.amount } };
        }
        const full = parseFullBalanceMention(content, history, snap);
        if (full && full.amount > 0) {
          return { kind: "action", tool: "record_customer_payment", params: { customer_name: full.customer_name, amount: full.amount } };
        }
      } else if (bareKind === "sale") {
        const snapSale = parseSaleSnapshot(content, history, snap, currency);
        if (snapSale) return snapSale;
        const s = parseSaleMention(content);
        if (s && s.items && s.items.length) return { kind: "action", tool: "record_sale", params: s };
      } else if (bareKind === "expense") {
        const e = parseExpenseMention(content);
        if (e && (e.amount || e.description)) return { kind: "action", tool: "add_expense", params: { amount: e.amount, description: e.description } };
      }
    }
    if (bareKind === "payment") {
      // "Full debts <amount>" carries its own amount: with a customer
      // in the recent turns (after the last Done line), propose it even
      // when no earlier mention re-parses. The amount-question answer
      // at step 2a already handled it when a question was asked; this
      // is the no-question fallback.
      if (bareFullDebts) {
        const own = parseAmountAnswer(text);
        const debtor = resolvePronounCustomer(histArr.slice(startIdx), snap);
        if (own && own.amount > 0 && debtor) {
          return { kind: "action", tool: "record_customer_payment", params: { customer_name: debtor.name, amount: own.amount } };
        }
      }
      return { kind: "reply", text: "Who paid, and how much?" };
    }
    // Sale/expense with nothing to re-parse: fall through to the chip
    // flow below, which asks its one targeted question.
  }

  // 10c. Bare follow-up sale ("And 2 sold today", "And 1 more"): the
  // message names a quantity and nothing else, so the product comes
  // from the last sale in the thread. Runs before the sale step: the
  // sale parser would otherwise read "and 2" as a product name.
  const followUpSale = parseFollowUpSale(text, history, snap, currency);
  if (followUpSale) {
    if (followUpSale.kind === "question") return { kind: "reply", text: followUpSale.text };
    return followUpSale;
  }

  // 11. Sale mention (including the bare "Record a sale" chip and
  // "Record 2 Rice"). Expense intents are excluded here; step 12 owns them.
  // The snapshot-aware parse runs first: it matches the product by its
  // real name, resolves "paid full"/"paid half" from the snapshot price,
  // and carries the exact snapshot name, so the executor never sees a
  // polluted name like "laptop now".
  if (SALE_VERBS.test(t) && !/\bexpense\b/.test(t)) {
    const snapSale = parseSaleSnapshot(text, history, snap, currency);
    if (snapSale) {
      // A partial payment with no debtor named ("I sold 3 laptops,
      // they paid for 2 and owe for 1"): ask who owes, never guess
      // walk-in and never propose the full total as paid. The executor
      // refuses a partial sale with no customer, so this question is
      // the only way the sale can be completed.
      const partial = parsePartialPayment(text);
      const totalQty = (snapSale.params.items || []).reduce((n, it) => n + (it.qty || 0), 0);
      if (partial && partial.paidQty !== null && partial.paidQty !== undefined && partial.paidQty < totalQty && !snapSale.params.customer_name && !partial.debtorName) {
        return { kind: "reply", text: partialDebtorQuestion(snapSale.params.items, partial) };
      }
      // A buyer-side report ("someone bought 5 fvamail") with no payment
      // stated: ask one short question about the payment instead of
      // assuming full payment. The seller-side ("I sold a laptop") keeps
      // the existing full-payment default.
      if (isBoughtOnly(t) && snapSale.params.amount_paid === undefined && !snapSale.params.payment_method) {
        const total = saleTotalFromSnapshot(snapSale.params.items, snap);
        return { kind: "reply", text: formatSalePaymentQuestion(snapSale.params.items, total, currency, snapSale.params.customer_name || "") };
      }
      return snapSale;
    }
    const sale = parseSaleMention(text);
    if (sale) {
      // The product is outside the snapshot's list, so the total is
      // unknown: "paid half" asks what half is, and a partial payment
      // asks what they paid, instead of defaulting to full.
      const saleItemsKnown = (sale.items || []).every((it) => matchSnapshotProduct(normalizePluralProduct(it.product, (snap && snap.products) || []), (snap && snap.products) || []));
      if (!saleItemsKnown) {
        if (/\bpaid\s+half\b/.test(t)) {
          return { kind: "reply", text: "How much is half? I do not have that item's price, so I cannot work it out." };
        }
        const partialOnly = parsePartialPayment(text);
        if (partialOnly && partialOnly.paidQty !== null && partialOnly.paidQty !== undefined) {
          const rawProduct = (sale.items || []).map((it) => it.product).join(", ");
          return { kind: "reply", text: `How much did they pay for the ${partialOnly.paidQty} ${rawProduct}? I do not have a price for it, so I cannot work out the amount.` };
        }
      }
      return { kind: "action", tool: "record_sale", params: sale };
    }
  }

  // 12. Expense mention (including the bare "Record an expense" chip).
  // "bought" reaches here only when the sale step did not claim it: a
  // first-person bought ("I bought fuel") is the owner buying supplies,
  // which is an expense. A third-party bought that matches a product
  // was already claimed by step 11.
  if (/\bexpense\b/.test(t) || /\bspent\b/.test(t) || /\bspend\b/.test(t) || /\bbought\b/.test(t)) {
    const expense = parseExpenseMention(text, snap);
    if (expense) {
      return { kind: "action", tool: "add_expense", params: withExpenseCategory({ amount: expense.amount, description: expense.description }) };
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

  // 14a. Challenge follow-up ("Really?", "Are you sure?", "That can't
  // be right"): re-check the last answer against the snapshot and either
  // correct it or confirm it, never the failure line. Runs before the
  // casual step on purpose: a challenge is a re-check, not a greeting.
  if (isChallenge(text)) {
    return challengeReply(text, history, snap, currency);
  }

  // 14b. Bare acknowledgement or greeting ("Great", "Thanks", "Hello"):
  // one short friendly line, never the model, never the failure line.
  // Whole-message anchored, so a longer sentence ("Great, now record a
  // sale") still reaches its own step.
  const ack = acknowledgementReply(text);
  if (ack) return { kind: "reply", text: ack };

  // 14c. Casual replies: emoji-only, reactions, small talk, jokes.
  // Runs after every business intent and just before the model
  // fallback, so a business message that happens to contain an emoji
  // is never misread as casual ("I sold 2 laptops 🔥" is a sale).
  const casual = casualReply(text);
  if (casual) return { kind: "reply", text: casual };

  // 15. Nothing matched: the model handles it.
  return null;
}
