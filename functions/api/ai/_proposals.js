// Kopa AI — Guardrails, confirm-before-action proposals, warnings, intent.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.
import { toSqliteDate, businessDay } from "../_utils";
import { qtyLeftText } from "./_fastpath.js";
import { TOOL_EXECUTORS } from "./_dispatch.js";
import { PROJECT_WRITE_TOOLS, firstMissingProjectField, fmt, pricePhrase } from "./_gating.js";
import { formatBusinessTime, matchCustomer, matchProduct, namesSimilar, parseRemindAt, productNotFoundLine } from "./_matchers.js";
import { resolveBusinessProject } from "./_projects.js";

// ---------------------------------------------------------------------------
// Guardrails: confirm-before-action, common sense, memory and instructions.
// Plan: GUARDRAILS-CONFIRM-COMMONSENSE.md. These helpers run BEFORE a
// proposal is stored (see runGuardrailChecks, called from the ACTION path)
// and BEFORE a proposal is executed for the stale-debtor check (tap path).
// They never execute a write themselves: they return a stop (hard check),
// a warning (soft check, stored as a pending warning, never as a proposal),
// a conflict question (standing instruction), or ok. One warning at a
// time, one question at a time. Every check is bound to the session
// business only; no other business's data is ever read or quoted.
// Provisional threshold, awaiting Fortune's own thresholds in words:
// an "unusual amount" warning fires above 3x the largest recent amount
// for the same product/customer in THIS business only. It only warns;
// it never blocks, and it never uses a market price or another business.
// ---------------------------------------------------------------------------

export const GUARDRAIL_UNUSUAL_MULTIPLIER = 3;

// Tone: honest warmth only. The sanitizer strips the exact stock phrases
// and claimed-feeling phrases the guardrail bans, so no reply the server
// sends can carry them even if a model draft does. It never invents text.
const GUARDRAIL_BANNED_PHRASES = [
  "As an AI language model",
  "I am here to help you with all your needs",
  "Rest assured",
  "I feel happy for you",
  "I understand how hard this is for you",
];
export function sanitizeTone(text) {
  let out = String(text || "");
  for (const phrase of GUARDRAIL_BANNED_PHRASES) {
    out = out.split(phrase).join("").replace(/[ \t]{2,}/g, " ");
  }
  return out.trim();
}

// Plain answer when the snapshot cannot answer a figure question.
// Never a guessed figure, never a warm-sounding half-promise.
export function unknownFigureText() {
  return "I do not have that figure for this business.";
}

// The exact 5-part warning shape, in order. A warning is not a proposal
// and not a confirmation: answering it only lets the agent draft, and
// that draft still needs a Confirm tap.
export function formatWarning(parts) {
  const asked = parts.asked || "";
  const why = parts.why || "";
  const change = parts.change || "";
  const safer = parts.safer || "";
  const question = parts.question
    || "Do you want the safer way, or do you still want the original? Tell me, and I will draft it for your Confirm tap.";
  return [
    "What you asked for: " + asked,
    "Why this looks like it could be a mistake: " + why,
    "What would change if it went ahead: " + change,
    "The safer alternative: " + safer,
    "One question: " + question,
  ].join("\n");
}

// What an owner's reply to a warning question means. Returns 'safer',
// 'original', 'drop', 'once' (follow a conflicting instruction just this
// once), 'replace' (replace a standing instruction going forward), or
// null (not a warning answer: a name, a correction, or a new request).
export function parseWarningAnswer(text) {
  const t = normalizeIntentText(text);
  if (!t) return null;
  if (/\breplace\b/.test(t) && /going forward|from now on|keep (it|that) as|make it (the )?new/.test(t)) return "replace";
  if (/just this once|only this once|just once|one time only/.test(t)) return "once";
  if (/use (the )?existing|use existing|existing one|safer way|safer one|safer\b/.test(t)) return "safer";
  if (/second sale|second one|it is a second|two sales/.test(t)) return "original";
  if (/create (a )?new|new one|keep (the )?original|original\b|still want|keep it\b/.test(t)) return "original";
  if (/first one|first sale|it was the first|only one sale|drop it|forget it|never mind/.test(t)) return "drop";
  // Bare yes/no (round 5): the duplicate warning now asks "Record it
  // again as a second sale?", so a bare Yes means proceed with the
  // original request and a bare No means cancel it. This is only ever
  // read when a warning is actually pending: the call site loads the
  // pending warning first and only then calls this function, so a bare
  // Yes with no pending warning never reaches here and never drafts
  // anything. Polite tails ("yes please", "no thanks") count as bare.
  const bare = t.replace(/[.!?]+$/g, "").trim();
  if (bare === "yes" || bare === "yeah" || bare === "yep" || bare === "yes please" || bare === "yeah please" || bare === "yep please") return "original";
  if (bare === "no" || bare === "nope" || bare === "no thanks" || bare === "no thank you") return "drop";
  return null;
}

// An instruction that asks to remove a hard gate. Returns the plain
// refusal of that part, or null. No instruction may remove the Confirm
// tap, a tier or role gate, the wrong-business stop, the payment gate,
// or the no auto-send rule.
export function instructionGateRefusal(text) {
  const t = normalizeIntentText(String(text || ""));
  if (!t) return null;
  const asksGateRemoval = /without asking|without confirm|no confirm|skip confirm|skip asking|automatically|auto send|send automatically|do not ask|don't ask|never ask|no need to ask|no need to confirm/.test(t);
  if (!asksGateRemoval) return null;
  return "I still need your Confirm tap for every write, even with that instruction. I can draft it ready for one tap, and nothing will go out until you tap Confirm.";
}

// Staff login/logout activity (round 5): the business records NO
// login/logout times anywhere, so these questions have an honest
// no-data answer, never invented times and never the model line.
// What the code actually stores, verified by reading it:
// - login only overwrites users.last_login_at (one latest stamp per
//   user, no history, no business) and opens a sessions row; it writes
//   no audit_logs row ("auth.login" is only a display label in
//   functions/api/activity.js, nothing ever writes it).
// - logout deletes the session row, so no logout time survives at all.
// - history_events (world-best migration 0061) has no login/logout
//   type and no caller records one. A separate staff-activity build
//   (approved 2026-11-06) will record these events; until it lands,
//   this is the true answer. The fast path owns the "log activity"
//   routing; this is the chat.js answer side, reached when it does
//   not match, and the system prompt below carries the same rule for
//   the model. "Log" here is never a customer name.
export const STAFF_ACTIVITY_NO_DATA = "I do not have staff login or logout times for this business. KopaBook does not record when staff sign in or out yet, so there is nothing in the log I can report and I cannot tell you exact times. Once sign-in and sign-out events are recorded, I will be able to tell you who signed in and out and when.";
export function staffActivityAnswer(text) {
  const t = normalizeIntentText(text);
  if (!t) return null;
  // "Who is signed in now" is a live-session question, not a login-time
  // question: it falls through instead of getting the no-times answer.
  if (/\b(is|are) (currently )?(signed|logged) ?in (now|right now)\b/.test(t)) return null;
  if (/\b(log ?activity|activity ?log|login ?activity|logout ?activity|login ?history|activity ?history)\b/.test(t)) return STAFF_ACTIVITY_NO_DATA;
  if (/\b(who|when|what time|what date|did|has|have)\b/.test(t)
    && /\b(log ?in|log ?out|logged ?in|logged ?out|sign ?in|sign ?out|signed ?in|signed ?out)\b/.test(t)) return STAFF_ACTIVITY_NO_DATA;
  return null;
}

// Requests the agent has no tool for: plan, price, billing, staff changes.
// Plain refusal, no change, pointer to where the owner does it themselves.
export function outOfScopeRefusal(text) {
  const t = normalizeIntentText(String(text || ""));
  if (!t) return null;
  const asksOutOfScope = /upgrade (my )?plan|change (my |the )?(plan|price|billing)|remove (a )?staff|delete (a )?staff|fire (a )?staff|change (the )?staff/.test(t);
  if (!asksOutOfScope) return null;
  return "I cannot change plans, prices, billing, or staff from this chat. You do that yourself in the app's plan and staff settings, outside this chat. I can still answer questions about this business and draft sales, expenses, and reminders for your Confirm tap.";
}


export function amountsIn(text) {
  const out = [];
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(Number(m[1].replace(/,/g, "")));
  return out;
}

export function debtorBalanceChanged(storedBalance, currentBalance) {
  return Number(storedBalance) !== Number(currentBalance);
}

// Memory for this business only. Returns null when the ai_memory table
// is absent (migration 0050 not live): memory is then not promised.
export async function loadBusinessMemory(db, businessId) {
  try {
    const rows = await db.prepare(
      `SELECT memory_key, memory_value FROM ai_memory WHERE business_id = ? ORDER BY updated_at DESC LIMIT 10`
    ).bind(businessId).all();
    return (rows.results || []).map((r) => ({ memory_key: r.memory_key, memory_value: r.memory_value }));
  } catch (e) {
    return null;
  }
}

// Pending warnings: the same on-demand table pattern as proposals.
// A warning row is not a proposal: it carries the original params, the
// safer alternative, and the question, and it expires after 10 minutes.
let pendingWarningsEnsured = false;
export async function ensurePendingWarnings(db) {
  if (pendingWarningsEnsured) return;
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS ai_pending_warnings (
        id TEXT PRIMARY KEY,
        business_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        session_key TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL,
        safer_action TEXT NOT NULL,
        summary TEXT NOT NULL,
        lines TEXT NOT NULL,
        kind TEXT NOT NULL,
        question TEXT NOT NULL,
        candidates TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`
    ).run();
    pendingWarningsEnsured = true;
  } catch (e) { /* warnings are best effort; a failed store means no warning, never a write */ }
}

export async function storePendingWarning(db, w) {
  await ensurePendingWarnings(db);
  const id = "warn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date();
  const expiresStr = toSqliteDate(new Date(createdAt.getTime() + PROPOSAL_TTL_MS));
  await db.prepare(
    `UPDATE ai_pending_warnings SET status = 'superseded' WHERE business_id = ? AND session_key = ? AND status = 'pending'`
  ).bind(w.businessId, w.sessionKey).run();
  await db.prepare(
    `INSERT INTO ai_pending_warnings (id, business_id, user_id, session_key, tool, params, safer_action, summary, lines, kind, question, candidates, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, w.businessId, w.userId, w.sessionKey, w.tool, JSON.stringify(w.params || {}), JSON.stringify(w.saferAction || { action: "proposal" }),
    w.summary || "", JSON.stringify(w.lines || []), w.kind || "", w.question || "",
    JSON.stringify(w.candidates || []), toSqliteDate(createdAt), expiresStr).run();
  return { id, expires_at: expiresStr };
}

export async function loadPendingWarning(db, businessId, sessionKey) {
  await ensurePendingWarnings(db);
  try {
    const row = await db.prepare(
      `SELECT id, business_id, user_id, session_key, tool, params, safer_action, summary, lines, kind, question, candidates, status, created_at, expires_at
       FROM ai_pending_warnings
       WHERE business_id = ? AND session_key = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(businessId, sessionKey, toSqliteDate(new Date())).first();
    return row || null;
  } catch (e) {
    return null;
  }
}

export async function clearPendingWarnings(db, businessId, sessionKey, status) {
  try {
    await db.prepare(
      `UPDATE ai_pending_warnings SET status = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
    ).bind(status || "superseded", businessId, sessionKey).run();
  } catch (e) { /* best effort */ }
}

// One shared proposal store for the warning resolver and for pa.js.
// Same shape as the ACTION path: supersede older pending, 10-minute
// expiry, business_id + session_key binding. It never executes anything.
export async function createAiProposal(db, businessId, userId, sessionKey, tool, params, summary, lines) {
  await ensurePendingProposals(db);
  const proposalId = "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date();
  const expiresStr = toSqliteDate(new Date(createdAt.getTime() + PROPOSAL_TTL_MS));
  await db.prepare(
    `UPDATE ai_pending_proposals SET status = 'superseded', resolved_at = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
  ).bind(toSqliteDate(createdAt), businessId, sessionKey).run();
  await db.prepare(
    `INSERT INTO ai_pending_proposals (id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(proposalId, businessId, userId, sessionKey, tool, JSON.stringify(params || {}), summary, toSqliteDate(createdAt), expiresStr).run();
  return { id: proposalId, tool, summary, lines: lines || [], expires_at: expiresStr };
}

// Guardrail gate, run after a dry-run proposal exists and before that
// proposal is stored. Returns { ok: true }, { stop: "one short question" },
// { warning: {...} } (soft check: warn first, propose only after the
// owner answers), or { conflict: {...} } (standing instruction clash).
// Hard checks first (H1-H6), then the first firing soft warning only
// (S1-S6): one question at a time. Any unexpected database error fails
// open to ok here, because the executors re-validate at execution time
// and a gate failure must never break the chat; it must never invent a
// pass for a check it could not run, so soft warnings that need data
// simply do not fire when their data is unavailable.
export async function runGuardrailChecks(db, auth, tool, params, proposal, userMessage, currency, opts) {
  const businessId = auth.business.id;
  const sessionKey = (opts && opts.sessionKey) || "";
  const fmtCur = (n) => fmt(n, currency);
  const stop = (msg) => ({ stop: msg });
  const askedText = (proposal && proposal.summary) || (tool + " request");
  try {
    // H1: an explicit business id in the params that is not this business.
    const paramBusiness = params && (params.business_id || params.businessId);
    if (paramBusiness && String(paramBusiness) !== String(businessId)) {
      return stop("That belongs to a different business, not this one. I can only work in this business, so I have not recorded anything.");
    }

    if (tool === "save_memory") {
      const key = String((params && (params.key || params.label)) || "").trim().slice(0, 80);
      const value = String((params && (params.value || params.fact)) || "").trim().slice(0, 1000);
      if (!key) return stop("What should I remember? Give me a short label and the fact.");
      const refuse = instructionGateRefusal(key + " " + value);
      if (refuse) return stop(refuse);
      const mem = await loadBusinessMemory(db, businessId);
      if (mem === null) {
        return stop("Memory is not available yet for this business, so I have not saved that. Your records are untouched.");
      }
      if (value) {
        const isInstruction = key.toLowerCase().startsWith("instruction:")
          || /\b(always|never)\b/.test(value.toLowerCase())
          || value.toLowerCase().includes("from now on");
        if (isInstruction) {
          const old = mem.find((r) => r.memory_key.toLowerCase() === key.toLowerCase());
          if (old && old.memory_value !== value) {
            return { conflict: {
              kind: "instruction_conflict", key, oldValue: old.memory_value, newValue: value,
              question: "You previously said, for this business, " + old.memory_value + ". This message says " + value + ". Should I follow " + value + " just this once, or replace " + old.memory_value + " going forward?",
            } };
          }
        }
      }
      return { ok: true };
    }

    if (tool === "record_sale") {
      const items = Array.isArray(params.items) ? params.items : [];
      if (!items.length) return stop("What exactly should I record? Tell me the product and quantity, e.g. '2 Rice'.");
      const resolved = [];
      for (const it of items) {
        const qty = Number(it.qty || it.quantity || 1);
        if (!Number.isFinite(qty) || qty <= 0) return stop("How many \"" + (it.product || "") + "\"? I need a valid quantity.");
        const matches = await matchProduct(db, businessId, it.product || "");
        if (!matches.length) return stop(await productNotFoundLine(db, businessId, it.product || ""));
        if (matches.length > 1) return stop("\"" + (it.product || "") + "\" matches more than one product: " + matches.map((p) => p.name).join(", ") + ". Which one do you mean?");
        const p = matches[0];
        if (p.stock < qty) return stop("Not enough stock for " + p.name + ". You have " + qtyLeftText(p.stock, p.unit) + ".");
        resolved.push({ requested: String(it.product || ""), product: p, qty, lineTotal: Math.round(p.price * qty * 100) / 100 });
      }
      const total = Math.round(resolved.reduce((s, r) => s + r.lineTotal, 0) * 100) / 100;
      const amountPaid = params.amount_paid !== undefined && params.amount_paid !== null ? Number(params.amount_paid) : null;
      if (amountPaid !== null && (!Number.isFinite(amountPaid) || amountPaid < 0)) return stop("How much did the customer pay? I need a valid amount.");
      // Customer resolution: a brand-new customer is created inside a
      // confirmed sale, so 0 matches is not a stop here; 2+ is.
      let cust = null;
      const customerName = String(params.customer_name || params.customerName || "").trim();
      if (customerName) {
        const cm = await matchCustomer(db, businessId, customerName);
        if (cm.length > 1) return stop("\"" + customerName + "\" matches more than one customer: " + cm.map((c) => c.name).join(", ") + ". Which one?");
        if (cm.length === 1) cust = cm[0];
      }
      // S3 lookalike product or customer: a single fuzzy match that is
      // not the exact name asked for. Show the closest match and ask.
      const nonExactProduct = resolved.find((r) => r.product.name.toLowerCase() !== r.requested.trim().toLowerCase());
      if (nonExactProduct) {
        const saferParams = { ...params, items: params.items.map((it) => (String(it.product || "").trim().toLowerCase() === nonExactProduct.requested.trim().toLowerCase() ? { ...it, product: nonExactProduct.product.name } : it)) };
        return { warning: {
          kind: "lookalike", asked: askedText,
          why: "\"" + nonExactProduct.requested + "\" is close to, but not exactly, the product \"" + nonExactProduct.product.name + "\" in this business.",
          change: "Stock of " + nonExactProduct.product.name + " would go from " + nonExactProduct.product.stock + " to " + (nonExactProduct.product.stock - nonExactProduct.qty) + ", total " + fmtCur(total) + ".",
          safer: "Use the existing product \"" + nonExactProduct.product.name + "\".",
          question: "Did you mean \"" + nonExactProduct.product.name + "\", or a different product? Tell me, and I will draft it for your Confirm tap.",
          candidates: [nonExactProduct.product.name],
          saferAction: { action: "proposal", params: saferParams, summary: proposal ? proposal.summary : askedText, lines: proposal ? proposal.lines : [] },
        } };
      }
      if (cust && cust.name.toLowerCase() !== customerName.toLowerCase()) {
        return { warning: {
          kind: "lookalike", asked: askedText,
          why: "\"" + customerName + "\" is close to, but not exactly, the customer \"" + cust.name + "\" in this business.",
          change: "A sale of " + fmtCur(total) + " would be recorded for " + cust.name + ".",
          safer: "Use the existing customer \"" + cust.name + "\".",
          question: "Did you mean \"" + cust.name + "\", or a different customer? Tell me, and I will draft it for your Confirm tap.",
          candidates: [cust.name],
          saferAction: { action: "proposal", params: { ...params, customer_name: cust.name }, summary: proposal ? proposal.summary : askedText, lines: proposal ? proposal.lines : [] },
        } };
      }
      // S1 duplicate: same customer + product + amount recorded today,
      // or already waiting as a pending proposal in this session.
      // "Today" is the business day in the business timezone, the same
      // window the snapshot uses: a sale at 00:30 WAT is today in Lagos
      // but yesterday in UTC, and the old UTC-day query missed it.
      let duplicate = false;
      try {
        const dupWindow = businessDay((auth.business && auth.business.timezone) || "Africa/Lagos", new Date());
        const todayRows = await db.prepare(
          `SELECT id, customer_id, total_amount FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND (status IS NULL OR status <> 'voided')`
        ).bind(businessId, dupWindow.startUtc, dupWindow.endUtc).all();
        for (const s of (todayRows.results || [])) {
          if (Number(s.total_amount) !== total) continue;
          let saleCustomer = "";
          if (s.customer_id) {
            const crow = await db.prepare(`SELECT name FROM customers WHERE id = ?`).bind(s.customer_id).first();
            saleCustomer = crow ? String(crow.name) : "";
          }
          if (saleCustomer.toLowerCase() !== customerName.toLowerCase()) continue;
          const itemRows = await db.prepare(
            `SELECT p.name FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`
          ).bind(s.id).all();
          const saleProducts = (itemRows.results || []).map((r) => String(r.name).toLowerCase()).sort().join("|");
          const wantProducts = resolved.map((r) => r.product.name.toLowerCase()).sort().join("|");
          if (saleProducts === wantProducts) { duplicate = true; break; }
        }
        if (!duplicate && sessionKey) {
          const pend = await db.prepare(
            `SELECT tool, params FROM ai_pending_proposals WHERE business_id = ? AND session_key = ? AND status = 'pending'`
          ).bind(businessId, sessionKey).all();
          for (const pr of (pend.results || [])) {
            if (pr.tool !== "record_sale") continue;
            try {
              const pp = JSON.parse(pr.params || "{}");
              if (JSON.stringify(pp) === JSON.stringify(params)) { duplicate = true; break; }
            } catch (e) { /* ignore unparseable rows */ }
          }
        }
      } catch (e) { /* duplicate data unavailable: do not warn on a guess */ }
      if (duplicate) {
        const first = resolved[0];
        return { warning: {
          kind: "duplicate", asked: askedText,
          why: "This is the second time today with the same customer, product and amount.",
          change: "A second sale would record " + fmtCur(total) + " again, and stock of " + first.product.name + " would go from " + first.product.stock + " to " + (first.product.stock - first.qty) + ".",
          safer: "Record it as one sale, not two. The first sale already stands.",
          question: "Record it again as a second sale?",
          candidates: [],
          saferAction: { action: "reply", reply: "Understood. I will keep the first sale only and I have not recorded a second one. Nothing else changed." },
        } };
      }
      // S2 wrong or changed price: the owner's own words state one amount
      // for the sale, the product record says another total. Never silently
      // correct it and never silently keep the wrong one.
      // The owner's stated price is the amount in their words that is not
      // simply a quantity (e.g. in "1 Rice for 4000", 1 is the quantity
      // and 4000 is the stated price). If the only amounts are quantities,
      // there is no stated price to compare.
      const qtyNumbers = new Set(resolved.map((r) => r.qty));
      // Numbers that are part of a product name (the 5 in "Rice 5kg") are
      // a size or weight, not a stated price, so they must not count here.
      const nameNumbers = new Set(resolved.flatMap((r) => amountsIn(r.requested)));
      const statedAmounts = amountsIn(userMessage).filter((n) => !qtyNumbers.has(n) && !nameNumbers.has(n));
      const distinctStated = [...new Set(statedAmounts)];
      if (distinctStated.length === 1 && distinctStated[0] !== total && amountPaid === null && !/paid/i.test(String(userMessage || ""))) {
        const stated = distinctStated[0];
        const first = resolved[0];
        return { warning: {
          kind: "price_mismatch", asked: askedText,
          why: "That price is different from the price on this product: you said " + fmtCur(stated) + ", but the product record says " + fmtCur(first.product.price) + " " + pricePhrase(first.product.unit) + ", so " + first.qty + " comes to " + fmtCur(total) + ".",
          change: "At the product record price, the total would be " + fmtCur(total) + " and stock of " + first.product.name + " would go from " + first.product.stock + " to " + (first.product.stock - first.qty) + ".",
          safer: "Record it at the product record price, total " + fmtCur(total) + ".",
          question: "Do you want the safer way, or do you still want the original? Tell me, and I will draft it for your Confirm tap.",
          candidates: [],
          saferAction: { action: "proposal", params, summary: proposal ? proposal.summary : askedText, lines: proposal ? proposal.lines : [] },
        } };
      }
      // S4 unusual amount, single-product sales only, judged only on this
      // business's recent sales of that product. Provisional 3x threshold.
      if (resolved.length === 1) {
        try {
          const rec = await db.prepare(
            `SELECT s.total_amount FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.business_id = ? AND si.product_id = ? AND (s.status IS NULL OR s.status <> 'voided') ORDER BY s.id DESC LIMIT 5`
          ).bind(businessId, resolved[0].product.id).all();
          const totals = (rec.results || []).map((r) => Number(r.total_amount) || 0).filter((n) => n > 0);
          const maxRecent = totals.length ? Math.max(...totals) : 0;
          if (maxRecent > 0 && total > GUARDRAIL_UNUSUAL_MULTIPLIER * maxRecent) {
            return { warning: {
              kind: "unusual_amount", asked: askedText,
              why: "That amount is far above this product's recent sales in this business: your recent sales of " + resolved[0].product.name + " are around " + fmtCur(maxRecent) + ", and this sale is " + fmtCur(total) + ".",
              change: "Stock of " + resolved[0].product.name + " would go from " + resolved[0].product.stock + " to " + (resolved[0].product.stock - resolved[0].qty) + ", total " + fmtCur(total) + ".",
              safer: "Double-check the amount first, and tell me the correct amount if this one is wrong.",
              question: "Do you want the safer way, or do you still want the original? Tell me, and I will draft it for your Confirm tap.",
              candidates: [],
              saferAction: { action: "reply", reply: "Understood. I have not recorded anything yet. Tell me the correct amount and I will draft it again for your Confirm tap." },
            } };
          }
        } catch (e) { /* no recent data: do not warn on a guess */ }
      }
      // Memory never overrides the snapshot for figures. A saved price
      // rule that disagrees with the product record is a question, and
      // the snapshot wins unless the owner updates the product itself.
      try {
        const mem = await loadBusinessMemory(db, businessId);
        if (mem) {
          for (const row of mem) {
            const hay = (row.memory_key + " " + row.memory_value).toLowerCase();
            const prod = resolved.find((r) => hay.includes(r.product.name.toLowerCase()));
            if (!prod) continue;
            const memAmounts = amountsIn(row.memory_value);
            const disagree = memAmounts.find((n) => n !== prod.product.price);
            if (disagree !== undefined) {
              return { warning: {
                kind: "memory_price", asked: askedText,
                why: "Your saved price says " + fmtCur(disagree) + ", but the product record says " + fmtCur(prod.product.price) + " for " + prod.product.name + ".",
                change: "At the product record price, the total would be " + fmtCur(total) + " and stock of " + prod.product.name + " would go from " + prod.product.stock + " to " + (prod.product.stock - prod.qty) + ".",
                safer: "Use the product record price, " + fmtCur(prod.product.price) + " " + pricePhrase(prod.product.unit) + ".",
                question: "Do you want the safer way, or do you still want the original? Tell me, and I will draft it for your Confirm tap.",
                candidates: [],
                saferAction: { action: "proposal", params, summary: proposal ? proposal.summary : askedText, lines: proposal ? proposal.lines : [] },
              } };
            }
          }
        }
      } catch (e) { /* memory unavailable: snapshot figures already used */ }
      return { ok: true };
    }

    if (tool === "record_customer_payment") {
      const name = String(params.customer_name || params.customerName || "").trim();
      const amt = Number(params.amount);
      if (!name) return stop("Which customer paid?");
      if (!Number.isFinite(amt) || amt <= 0) return stop("How much did they pay? I need an amount greater than zero.");
      const matches = await matchCustomer(db, businessId, name);
      if (!matches.length) return stop("I could not find a customer called \"" + name + "\" in this business. Check the name and try again.");
      if (matches.length > 1) return stop("\"" + name + "\" matches more than one customer: " + matches.map((c) => c.name).join(", ") + ". Which one?");
      const c = matches[0];
      if (c.balance <= 0) return stop(c.name + " has no outstanding balance, so there is nothing to record.");
      if (amt > c.balance) return stop(c.name + " owes " + fmtCur(c.balance) + ". " + fmtCur(amt) + " is more than the balance. Tell me the correct amount.");
      if (c.name.toLowerCase() !== name.toLowerCase()) {
        return { warning: {
          kind: "lookalike", asked: askedText,
          why: "\"" + name + "\" is close to, but not exactly, the customer \"" + c.name + "\" in this business.",
          change: c.name + "'s balance would go from " + fmtCur(c.balance) + " to " + fmtCur(c.balance - amt) + ".",
          safer: "Use the existing customer \"" + c.name + "\".",
          question: "Did you mean \"" + c.name + "\", or a different customer? Tell me, and I will draft it for your Confirm tap.",
          candidates: [c.name],
          saferAction: { action: "proposal", params: { ...params, customer_name: c.name }, summary: proposal ? proposal.summary : askedText, lines: proposal ? proposal.lines : [] },
        } };
      }
      try {
        const payRows = await db.prepare(
          `SELECT customer_id, amount FROM payment_records WHERE business_id = ? AND date(created_at) = date('now')`
        ).bind(businessId).all();
        const dup = (payRows.results || []).some((r) => Number(r.customer_id) === Number(c.id) && Number(r.amount) === amt);
        if (dup) {
          return { warning: {
            kind: "duplicate", asked: askedText,
            why: "This payment, same customer and same amount, was already recorded today.",
            change: c.name + "'s balance would go from " + fmtCur(c.balance) + " to " + fmtCur(c.balance - amt) + " a second time.",
            safer: "Record it as one payment, not two. The first payment already stands.",
            question: "Record it again as a second payment?",
            candidates: [],
            saferAction: { action: "reply", reply: "Understood. I will keep the first payment only and I have not recorded a second one. Nothing else changed." },
          } };
        }
        const rec = await db.prepare(
          `SELECT amount FROM payment_records WHERE business_id = ? AND customer_id = ? ORDER BY id DESC LIMIT 5`
        ).bind(businessId, c.id).all();
        const amounts = (rec.results || []).map((r) => Number(r.amount) || 0).filter((n) => n > 0);
        const maxRecent = amounts.length ? Math.max(...amounts) : 0;
        if (maxRecent > 0 && amt > GUARDRAIL_UNUSUAL_MULTIPLIER * maxRecent) {
          return { warning: {
            kind: "unusual_amount", asked: askedText,
            why: "That payment is far above this customer's usual payments in this business: recent payments from " + c.name + " are around " + fmtCur(maxRecent) + ", and this one is " + fmtCur(amt) + ".",
            change: c.name + "'s balance would go from " + fmtCur(c.balance) + " to " + fmtCur(c.balance - amt) + ".",
            safer: "Double-check the amount first, and tell me the correct amount if this one is wrong.",
            question: "Do you want the safer way, or do you still want the original? Tell me, and I will draft it for your Confirm tap.",
            candidates: [],
            saferAction: { action: "reply", reply: "Understood. I have not recorded anything yet. Tell me the correct amount and I will draft it again for your Confirm tap." },
          } };
        }
      } catch (e) { /* no payment history: do not warn on a guess */ }
      return { ok: true };
    }

    if (tool === "add_product") {
      const name = String(params.name || "").trim();
      const price = Number(params.price);
      if (!name) return stop("What is the product called?");
      if (!Number.isFinite(price) || price <= 0) return stop("What is the selling price of \"" + name + "\"? I need a price greater than zero.");
      try {
        const rows = await db.prepare(
          `SELECT name FROM products WHERE business_id = ? AND is_active = 1`
        ).bind(businessId).all();
        const close = (rows.results || []).map((r) => String(r.name)).find((n) => n.toLowerCase() !== name.toLowerCase() && namesSimilar(n, name));
        if (close) {
          return { warning: {
            kind: "new_product_may_exist", asked: askedText,
            why: "\"" + name + "\" closely matches the existing product \"" + close + "\" in this business, so this may already exist.",
            change: "A new catalogue entry \"" + name + "\" at " + fmtCur(price) + " would be created alongside \"" + close + "\".",
            safer: "Use the existing product \"" + close + "\" instead of creating a new one.",
            question: "Do you want to use the existing product, or create a new one? Tell me, and I will draft it for your Confirm tap.",
            candidates: [close],
            saferAction: { action: "reply", reply: "Understood. I will use the existing product \"" + close + "\" and I have not created a new one. Tell me what to record with it." },
          } };
        }
      } catch (e) { /* catalogue unavailable: executor still validates */ }
      return { ok: true };
    }

    if (tool === "add_expense") {
      const amt = Number(params.amount);
      if (!Number.isFinite(amt) || amt <= 0) return stop("How much was the expense? I need an amount greater than zero.");
      if (!String(params.description || "").trim()) return stop("What was the expense for? Give me a short description.");
      return { ok: true };
    }

    if (tool === "set_reminder") {
      const text = String(params.text || "").trim();
      if (!text) return stop("What should I remind you about?");
      const remindAt = parseRemindAt(params.remind_at || params.remindAt, auth.business.timezone);
      const nowStr = toSqliteDate(new Date());
      const explained = /late|overdue|missed|backdate|already (due|passed)/i.test(String(userMessage || ""));
      if (remindAt < nowStr && !explained) {
        return stop("That reminder time is in the past (" + formatBusinessTime(remindAt, auth.business.timezone) + "). What time should it be instead?");
      }
      return { ok: true };
    }

    if (tool === "send_debtor_message") {
      const name = String(params.customer_name || params.customerName || "").trim();
      const message = String(params.message || "").trim();
      if (!name || !message) return stop("Tell me which customer and the exact message to send.");
      const matches = await matchCustomer(db, businessId, name);
      if (!matches.length) return stop("I could not find a customer called \"" + name + "\" in this business.");
      if (matches.length > 1) return stop("\"" + name + "\" matches more than one customer. Which one?");
      if (matches[0].balance <= 0) return stop(matches[0].name + " has no outstanding balance, so there is no reminder to send.");
      return { ok: true };
    }

    if (tool === "mark_reminder_done") {
      const reminderId = String(params.reminder_id || params.reminderId || params.id || "").trim();
      if (!reminderId) return stop("Which reminder should I mark as done? Give me its exact title.");
      try {
        const row = await db.prepare(
          `SELECT id, title, status FROM bot_reminders WHERE id = ? AND business_id = ?`
        ).bind(reminderId, businessId).first();
        if (!row) return stop("I could not find that reminder in this business.");
      } catch (e) { /* reminder table unavailable: executor re-checks */ }
      return { ok: true };
    }

    if (tool === "create_project_plan") {
      const missing = firstMissingProjectField(params.name, params.type, params.goal);
      if (missing === "name") return stop("What should we call the project?");
      if (missing === "type") return stop("What type of project is \"" + (params.name || "") + "\"? Choose one: construction, event, charity, business, custom.");
      if (missing === "goal") return stop("What is the goal of \"" + (params.name || "") + "\"? Tell me what success should look like.");
      return { ok: true };
    }

    if (PROJECT_WRITE_TOOLS.includes(tool) && tool !== "create_project_plan") {
      const resolved = await resolveBusinessProject(db, auth, params);
      if (resolved.clarification) return stop(resolved.clarification);
      const project = resolved.project;
      const status = String(project.status || "active").toLowerCase();
      if (status === "completed" || status === "closed") {
        if (tool === "project_update") {
          const want = String(params.status || params.action || "").trim().toLowerCase();
          if (["active", "reopen", "reopened"].includes(want)) return { ok: true };
          return stop(project.name + " is closed. I can reopen it as active, but I cannot add a milestone or record a transaction on a closed project.");
        }
        return stop(project.name + " is closed, so I cannot change it. Reopen it first, or pick an active project.");
      }
      return { ok: true };
    }

    return { ok: true };
  } catch (e) {
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Confirm-before-write: pending proposals for the write tools.
// A write is first dry-run into an exact proposal, stored here, and only
// executed when the user confirms. Proposals expire after 10 minutes.
// ---------------------------------------------------------------------------
export const WRITE_TOOLS = ["record_sale", "add_expense", "add_product", "record_customer_payment", "set_reminder", "save_memory", "send_debtor_message", "mark_reminder_done", ...PROJECT_WRITE_TOOLS];
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

let pendingProposalsEnsured = false;
export async function ensurePendingProposals(db) {
  if (pendingProposalsEnsured) return;
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS ai_pending_proposals (
        id TEXT PRIMARY KEY,
        business_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        session_key TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        result TEXT
      )`
    ).run();
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_ai_pending_proposals_business_session_status ON ai_pending_proposals(business_id, session_key, status)`
    ).run();
    pendingProposalsEnsured = true;
  } catch (e) { /* proposals are best effort until migration 0051 lands */ }
}

// Confirm-tap-only rule (personal agent, best version): chat words never
// execute a proposal. A bare "yes", "confirm", "go ahead", or their Pidgin,
// Hausa, Yoruba, and Igbo equivalents in chat only produces the waiting
// reply below; the proposal stays pending until the owner taps Confirm on
// its card. The tap Confirm and Cancel buttons always remain available
// regardless of language.
// Chat confirm words, matched case-insensitively and accent-insensitively
// (diacritics are stripped before matching, so "beenì" and "beeni" are the
// same word here). They are detected ONLY to answer "still waiting".
// Pidgin: na so, oya na, correct. Hausa: i, eh, to.
// Yoruba: beeni, eeni, o dara. Igbo: ee.
// Pidgin cancel: cancel am, no do am. Hausa cancel: a'a, aa, bari.
// Yoruba cancel: rara, ko si. Igbo cancel: mba.
export const CHAT_CONFIRM_WORDS_RE = /^\s*(?:yes|yeah|yep|confirm|confirmed|go ahead|ok|okay|proceed|do it|record it|record that|record am|record this|sure|yes please|correct|that is right|that's right|na so|oya na|i|eh|to|beeni|eeni|o dara|ee)\s*[.!?]*\s*$/;
export const CANCEL_RE = /^\s*(?:no|cancel|cancel that|stop|don't|do not|never mind|forget it|leave it|cancel am|no do am|a'a|aa|bari|rara|ko si|mba)\s*[.!?]*\s*$/;

export function normalizeIntentText(text) {
  return String(text || "")
    .replace(/[’‘]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function intentMatches(re, text) {
  return re.test(normalizeIntentText(text));
}

export async function loadPendingProposalById(db, businessId, sessionKey, proposalId) {
  await ensurePendingProposals(db);
  try {
    const row = await db.prepare(
      `SELECT id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at
       FROM ai_pending_proposals
       WHERE id = ? AND business_id = ? AND session_key = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(proposalId, businessId, sessionKey, toSqliteDate(new Date())).first();
    return row || null;
  } catch (e) {
    return null;
  }
}

export async function loadPendingProposal(db, businessId, sessionKey) {
  await ensurePendingProposals(db);
  try {
    const row = await db.prepare(
      `SELECT id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at
       FROM ai_pending_proposals
       WHERE business_id = ? AND session_key = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(businessId, sessionKey, toSqliteDate(new Date())).first();
    return row || null;
  } catch (e) {
    return null;
  }
}

// The Free project-action bucket: how many project write proposals this
// business has EXECUTED today (UTC day). Proposals, cancels and failures
// never count; project reports are reads, not proposals, so they never
// count either. Per business per day by construction (business_id + the
// resolved_at day), and yesterday's executions fall out automatically.
export async function countProjectActionsToday(db, businessId, day) {
  try {
    await ensurePendingProposals(db);
    const marks = PROJECT_WRITE_TOOLS.map(() => "?").join(", ");
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM ai_pending_proposals
       WHERE business_id = ? AND status = 'executed' AND tool IN (${marks})
         AND substr(resolved_at, 1, 10) = ?`
    ).bind(businessId, ...PROJECT_WRITE_TOOLS, day).first();
    return row ? Number(row.n) || 0 : 0;
  } catch (e) { return 0; }
}

export async function updateProposalStatus(db, businessId, proposalId, status, resultText) {
  try {
    if (resultText !== undefined) {
      await db.prepare(
        `UPDATE ai_pending_proposals SET status = ?, resolved_at = ?, result = ? WHERE id = ? AND business_id = ?`
      ).bind(status, toSqliteDate(new Date()), resultText, proposalId, businessId).run();
    } else {
      await db.prepare(
        `UPDATE ai_pending_proposals SET status = ?, resolved_at = ? WHERE id = ? AND business_id = ?`
      ).bind(status, toSqliteDate(new Date()), proposalId, businessId).run();
    }
  } catch (e) { /* status bookkeeping must never break the chat */ }
}

export async function callWriteExecutor(context, db, auth, tool, params, currency, opts) {
  const exec = TOOL_EXECUTORS[tool];
  // send_debtor_message has a different signature (db first, no context)
  // and its draft check is skipped at execution: the proposal is the
  // approval, created only after the dry-run validated the draft.
  if (tool === "send_debtor_message") return exec(db, auth, params, currency, [], { skipDraftCheck: true });
  return exec(context, db, auth, params, currency, opts);
}

// ---------------------------------------------------------------------------
// Assistant identity and PA (Solo and Pro). The owner can name the assistant
// on Solo/Pro; voice choice is stored for every tier. Settings live in
// business_chat_settings (migration 0053) and are read and written
// defensively, with a lazy ADD COLUMN attempt, so the chat never breaks
// before the migration lands.
// ---------------------------------------------------------------------------
