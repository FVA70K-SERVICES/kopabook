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
const PAYMENT_FILLER = /\b(record|please|kindly|just|has|have|had|now|the|a|an|payment|paid|pay|received|receive|collected|collect|settled|settle|gave|given|from|to|for|of|me|us|it|that|this|today|yesterday|this morning|on|in full|full|fully|paid up|cleared|clear|balance|in cash|cash|transfer|pos|bank transfer|via)\b/g;

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
  rest = rest.replace(/^[.,;:!?]+|[.,;:!?]+$/g, "").trim();
  if (!rest) return null;
  // First person is not a customer: "I paid 2000 for fuel" is an
  // expense, not a payment from a customer called "I". The expense
  // parser owns that shape.
  if (/^(i|we)$/.test(rest)) return null;
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

const FULL_BALANCE_MARKERS = /\b(full balance|complete balance|entire balance|in full|paid up|don pay finish|don clear|don settle|don pay everything)\b/;
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
    .replace(/\b(paid|pay|have|has|had|don|clear|cleared|settle|settled|full|in|balance|complete|entire|everything|all|what|he|she|him|her|them|they|his|their|owe|owes|owing|now|today|just|please|kindly|the|a|an|for|to|of|up|finish)\b/g, " ")
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
  let total = 0;
  for (const it of parsed.items) {
    const match = matchSnapshotProduct(it.product, snap.products);
    if (!match) return null;
    items.push({ product: match.name, qty: it.qty });
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
  } else if (/\bpaid\s+half\b/.test(t)) {
    params.amount_paid = Math.round((total / 2) * 100) / 100;
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

const SALE_VERBS = /\b(record|new|add|sold|sell|sale|sales)\b/;

// Time words and filler are never part of a product or customer name:
// "laptop now" is the product Laptop plus the word "now", never a
// product called "laptop now".
const SALE_TIME_WORDS = /\b(now|today|just|yesterday|recently|tonight|this morning|this afternoon|this evening)\b/g;

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
  let rest = t;
  // Time words out first: they pollute product and customer names.
  rest = rest.replace(SALE_TIME_WORDS, " ").replace(/\s+/g, " ").trim();
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
  const paidMatch = rest.match(/\bpaid\s+(\d[\d,]*\.?\d*)\s*(million|thousand|k|m)?/i);
  if (paidMatch) {
    const found = findAmounts(paidMatch[0]);
    if (found.length) amountPaid = found[0].value;
    rest = rest.replace(paidMatch[0], " ");
  } else {
    const paidWordTail = rest.match(/\bpaid\s+([a-z]+(?:\s+[a-z]+){0,5})/i);
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
  // half", "paid"): remove it before the customer is read, or "fortune
  // he paid full" becomes the customer name.
  rest = rest.replace(/\b(?:he|she|they|it|i|we)?\s*paid\b.*$/, " ").replace(/\s+/g, " ").trim();
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
  // A lone payment/expense word is not a product ("record a payment" is
  // not a sale of one "payment"). Let the model ask for the details.
  if (items.length === 1 && /^(payment|paid|expense|expenses|reminder|reminders?)$/.test(items[0].product)) return null;
  // A bare "record a sale" is a real intent with no details yet: return
  // empty items so the executor asks its one targeted question.
  const params = { items };
  if (customerName) params.customer_name = titleCaseName(customerName);
  if (amountPaid !== null) params.amount_paid = amountPaid;
  if (paymentMethod) params.payment_method = paymentMethod;
  return params;
}

// ---------------------------------------------------------------------------
// Expense mentions: "Record an expense", "Record expense 5000 for fuel",
// "Spent 5000 on fuel", "Add expense fuel 600".
// ---------------------------------------------------------------------------

const EXPENSE_VERBS = /\b(record|add|spent|spend|expense|expenses|bought)\b/;

export function parseExpenseMention(text) {
  const t = normalizeFastText(text);
  // "I paid 2000 for fuel" is an expense, not a payment from a customer
  // called "I": first-person "paid ... for ..." counts as an expense
  // verb here. Any other "paid" without the word "expense" stays a
  // payment (the guard below), so "Favour paid 5000" never lands here.
  const firstPersonPaidFor = /\b(i|we)\s+paid\b/.test(t) && /\bfor\b/.test(t);
  if (!EXPENSE_VERBS.test(t) && !firstPersonPaidFor) return null;
  // Must be an expense intent, not a sale or payment.
  if (SALE_VERBS.test(t) && !/\bexpense\b/.test(t)) return null;
  if (PAYMENT_VERBS.test(t) && !/\bexpense\b/.test(t) && !firstPersonPaidFor) return null;
  const amounts = findAllAmounts(t);
  let amount = null;
  let rest = t;
  if (amounts.length) {
    amount = amounts[0].value;
    rest = removeAmount(t, amounts[0]);
  }
  // The description parser is unchanged on purpose: "I spend 5000 for
  // transport today" still records the description "i transport today"
  // (live quirk, out of scope). Only the first-person "paid for" shape
  // strips its subject and verb, so "I paid 2000 for fuel" records
  // "fuel".
  const strip = firstPersonPaidFor
    ? /\b(record|add|spent|spend|expense|expenses|bought|paid|an|the|a|please|kindly|just|for|on|of|to|i|we)\b/g
    : /\b(record|add|spent|spend|expense|expenses|bought|an|the|a|please|kindly|just|for|on|of|to)\b/g;
  rest = rest
    .replace(strip, " ")
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
// With a snapshot, a full-balance mention ("Favour paid in full") also
// resolves, taking its amount from the snapshot.
export function findPendingMention(history, snap) {
  const turns = (history || []).filter((h) => h && h.role === "user" && typeof h.content === "string").slice(-6);
  for (let i = turns.length - 1; i >= 0; i--) {
    const content = turns[i].content;
    const payment = parsePaymentMention(content);
    if (payment) return { kind: "payment", ...payment };
    if (snap) {
      const full = parseFullBalanceMention(content, history, snap);
      if (full && full.amount > 0) return { kind: "payment", customer_name: full.customer_name, amount: full.amount };
    }
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
  // Product list: the snapshot already carries every product with price
  // and stock, so this is a read, never a model call. formatStock lists
  // them, so "show my stock" keeps answering exactly as it does today.
  // Bare "My products" only counts as a whole message: "what is the best
  // way to price my products?" is a pricing question, not a list request.
  if (includesAny(t, ["list out my products", "list my products", "show me my products", "show my products", "show me the products", "list the products", "list products", "show products", "what products do i have", "what products have i", "what products", "product list", "products list"])) return "products";
  // Customer list: the snapshot carries only the debtors (customers with
  // a balance), so that is the list it can answer with. A full customer
  // list needs the snapshot to carry all customers; it does not yet, and
  // this must never invent customers to fill the gap.
  if (includesAny(t, ["list my customers", "show my customers", "who are my customers", "list customers", "show customers", "customer list"])) return "customers";
  // Project list (plural "projects" + list/show/what/my). A single
  // project report ("how is the browser apk project doing") is singular
  // "project" and stays on the project_report path below.
  if (includesAny(t, ["what projects are do i have", "what projects do i have", "list my projects", "show my projects", "list projects", "show projects", "what projects", "projects list"])) return "projects";
  // Bare "My <things>" as a whole message: "My products", "My customers",
  // "My projects", "My sales", "My expenses". Anchored, so a longer
  // question that merely mentions the noun ("what is the best way to
  // price my products?") still falls through to the model.
  const bareList = t.match(/^\s*my (products|customers|projects|sales|expenses)\s*[.!?]*$/);
  if (bareList) {
    return { products: "products", customers: "customers", projects: "projects", sales: "recentsales", expenses: "recentexpenses" }[bareList[1]];
  }
  if (includesAny(t, ["sales today", "today's sales", "todays sales", "sales so far today", "how much did we sell today", "how much we sell today", "wetin we sell today", "what did we sell today", "what did i sell today", "what have i sold today", "what have we sold today", "today sales", "sales for today"])) return "today";
  if (includesAny(t, ["sales this month", "sales for the month", "this month sales", "how much did we sell this month", "monthly sales", "sales month"])) return "month";
  if (includesAny(t, ["how much did i spend this month", "how much did we spend this month", "what did i spend this month", "my spending this month", "spending this month", "expenses this month", "expenses for the month"])) return "monthexpenses";
  if (includesAny(t, ["recent sales", "last sales", "latest sales", "sales history", "show sales", "last few sales", "recent transactions", "list my sales", "show my sales", "list sales", "sales list"])) return "recentsales";
  if (includesAny(t, ["recent expenses", "last expenses", "latest expenses", "show expenses", "what did we spend", "what have we spent", "list my expenses", "show my expenses", "list expenses", "expenses list"])) return "recentexpenses";
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

export function formatMonthExpenses(snap, currency) {
  const total = (snap.expensesMonth && snap.expensesMonth.total) || 0;
  const count = (snap.expensesMonth && snap.expensesMonth.count) || 0;
  if (!count) return "No expenses yet this month.";
  return `Expenses this month: ${formatMoney(total, currency)} across ${count} ${count === 1 ? "expense" : "expenses"}.`;
}

export function formatProjects(snap, currency) {
  if (!snap.projects || !snap.projects.length) return "No projects yet.";
  const lines = snap.projects.map((p) => {
    const t = p.totals || {};
    const balance = t.balance !== undefined && t.balance !== null
      ? Number(t.balance)
      : (Number(t.totalIncome || 0) - Number(t.totalExpense || 0));
    return `- #${p.id} ${p.name}: ${p.status}, budget ${formatMoney(p.budget, currency)}, balance ${formatMoney(balance, currency)}`;
  });
  return `Projects (${snap.projects.length}):\n${lines.join("\n")}`;
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
    const pending = findPendingMention(history, snap);
    if (!pending) {
      return { kind: "reply", text: "I do not have anything to record yet. Tell me what happened, for example 'Favour paid 1000000'." };
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
      return { kind: "action", tool: "record_sale", params: pending };
    }
    return { kind: "action", tool: "add_expense", params: { amount: pending.amount, description: pending.description } };
  }

  // 2. Full-balance payment: "Favour have paid the full balance he owe
  // now", "Favour paid in full", "Favour cleared his balance". The
  // amount is the snapshot balance, never asked for, never invented.
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

  // 2b. Direct payment mention: "Favour paid 1000000" -> propose it now.
  // A pronoun ("He paid 5000") resolves to the last customer talked
  // about; with no antecedent, one short question instead of a guess.
  // A payment with a name but no amount and no full-balance marker
  // ("Favour paid") asks how much, instead of falling to the model.
  const payment = parsePaymentMention(text);
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
  if (PAYMENT_VERBS.test(t) && !findAllAmounts(t).length && !isDebtorRemindRequest(text) && !/^\s*who\b/.test(t)) {
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
  if (read === "monthexpenses") return { kind: "reply", text: formatMonthExpenses(snap, currency) };
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
  if (bareMatch) {
    const bareKind = bareMatch[3].toLowerCase();
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
      return { kind: "reply", text: "Who paid, and how much?" };
    }
    // Sale/expense with nothing to re-parse: fall through to the chip
    // flow below, which asks its one targeted question.
  }

  // 11. Sale mention (including the bare "Record a sale" chip and
  // "Record 2 Rice"). Expense intents are excluded here; step 12 owns them.
  // The snapshot-aware parse runs first: it matches the product by its
  // real name, resolves "paid full"/"paid half" from the snapshot price,
  // and carries the exact snapshot name, so the executor never sees a
  // polluted name like "laptop now".
  if (SALE_VERBS.test(t) && !/\bexpense\b/.test(t)) {
    const snapSale = parseSaleSnapshot(text, history, snap, currency);
    if (snapSale) return snapSale;
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
