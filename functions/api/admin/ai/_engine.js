// Admin AI chat engine (owner-only control centre).
//
// HARD RULE: this engine NEVER executes a write action. It can read
// figures with the read tools and prepare proposals with the propose
// tools. Execution happens only in POST /api/admin/ai/confirm when the
// owner taps Confirm on the proposal card. A typed or spoken "yes",
// "confirm" or "go ahead" in chat changes nothing in the database: if a
// proposal is pending, the engine says so and leaves it pending.
// This file deliberately does not import executeProposal at all.
import { generateText, aiProviderAvailable } from "../../ai/chat.js";
import { TOOL_DEFS, READ_TOOL_NAMES, executeReadTool, composeBriefingText, composeDailyText, fmtNGN } from "./_tools.js";
import { PROPOSE_TOOL_DEFS, ensureAdminAiTables, createProposal, getPendingProposal } from "./_actions.js";

// Bounds for the model path. The model is the slow part: one call can
// take up to 45s per provider attempt upstream, so the engine caps the
// whole model conversation at 30s and at 3 rounds. A fast path below
// answers the common read intents with no model call at all, so the
// model is only reached for questions no read tool answers directly.
// MODEL_FAILURE_LINE is the single failure reply for the model path:
// one line, never a dump, wording kept exactly as before.
const MODEL_FAILURE_LINE = "Admin AI is not connected right now. The AI provider did not answer, so I cannot run that yet. Ask me to brief you and I will pull the live figures directly.";
const MODEL_DEADLINE_MS = 30000;
const MAX_MODEL_ROUNDS = 3;
const MAX_MODEL_REPLY_CHARS = 2000;

const PROPOSE_TO_ACTION = {
  propose_set_tier: "set_tier",
  propose_grant: "grant",
  propose_suspend: "suspend",
  propose_unsuspend: "unsuspend",
  propose_revoke_promo: "revoke_promo",
};

const CONFIRM_WORDS = /^\s*(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|approve|approved|go ahead|do it|proceed|run it|execute|please do|yes please|yes do it)\b/i;

function systemPromptText() {
  const toolLines = [...TOOL_DEFS, ...PROPOSE_TOOL_DEFS]
    .map((t) => `- ${t.name}: ${t.description} Args: ${JSON.stringify(t.args || {})}`)
    .join("\n");
  return `You are Admin AI, the owner-only control centre assistant for KopaBook. You are talking to the platform owner, the only person who can use this chat.

How you work:
- Figures come only from tools. Never invent, estimate or repeat a number you did not get from a tool result in this conversation.
- To call a tool, reply with exactly one line in this format and nothing else on that line:
TOOL_CALL {"name":"tool_name","args":{...}}
- After a tool result comes back, either call another tool the same way or give the final answer in plain text with no TOOL_CALL line.
- Read tools only read. The propose tools prepare a proposal card. A proposal is not done, not approved and not executed: it only runs if the owner taps the Confirm button on its card, which calls a separate confirm endpoint.
- Chat can never execute an action. If the owner types or says yes, confirm, go ahead, do it or anything similar in chat, that does NOT confirm anything. Tell them the action is waiting for a tap on the Confirm button on its card, and leave the proposal pending. Never say an action is done, completed, applied or executed unless a tool result in this conversation proves a read, and never claim a proposal ran.
- Never narrate a proposed action as if it already happened. Say you have prepared it for confirmation.
- Be concise and direct, in plain English. Format money as NGN with commas, for example NGN 10,000. Do not use em dashes.

Available tools:
${toolLines}`;
}

function stripToolCalls(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/TOOL_CALL/.test(line))
    .join("\n")
    .trim();
}

function parseToolCall(text) {
  const raw = String(text || "");
  const idx = raw.indexOf("TOOL_CALL");
  if (idx < 0) return null;
  const rest = raw.slice(idx + "TOOL_CALL".length);
  const start = rest.indexOf("{");
  if (start < 0) return { error: "A TOOL_CALL line had no JSON object." };
  // Find the matching closing brace for the first object.
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < rest.length; i++) {
    const ch = rest[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return { error: "A TOOL_CALL line had incomplete JSON." };
  try {
    const obj = JSON.parse(rest.slice(start, end + 1));
    if (!obj || !obj.name) return { error: "A TOOL_CALL line had no tool name." };
    return { name: String(obj.name), args: obj.args && typeof obj.args === "object" ? obj.args : {} };
  } catch (e) {
    return { error: "A TOOL_CALL line had invalid JSON." };
  }
}

async function callModel(context, deps, messages) {
  // Admin AI is paid-only work, like every Kopa bot: generateText calls
  // gemini-paid only and never falls back to a free provider. No explicit
  // maxOutputTokens here, so generateText applies the advanced tier cap
  // (4096) for this call only.
  if (deps && typeof deps.generateText === "function") {
    return await deps.generateText(context.env, messages, { temperature: 0.2, advanced: true });
  }
  return await generateText(context.env, messages, { temperature: 0.2, advanced: true });
}

class ModelDeadlineError extends Error {
  constructor() { super("Admin AI model deadline exceeded"); this.name = "ModelDeadlineError"; }
}

// One model call, raced against the time left in the global deadline.
// The losing side can never hang the request: a late model rejection is
// swallowed by the attached catch, and the timer is always cleared.
async function callModelWithDeadline(context, deps, messages, ms) {
  const pending = callModel(context, deps, messages);
  pending.catch(() => {});
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ModelDeadlineError()), ms);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Deterministic fast path: common read intents answered straight from the
// read tools, with NO model call. The matcher only looks at the words the
// owner typed; every figure in the reply comes from the tool result for
// this platform, so nothing is hardcoded to any one business, amount,
// currency or plan. Anything it does not recognise falls through to the
// model path unchanged.
// ---------------------------------------------------------------------------

function normMessage(message) {
  return String(message || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
}

function periodFrom(text) {
  if (/\b(this month|past month|last month|last 30 days|this month so far)\b/.test(text)) return "month";
  if (/\b(this week|past week|last week|last 7 days)\b/.test(text)) return "week";
  if (/\b(all time|ever)\b/.test(text)) return "all";
  return "today";
}

function daysFrom(text, fallback) {
  const m = text.match(/(\d{1,3})\s*days?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 90);
  }
  return fallback;
}

function cleanLookupQuery(q) {
  return String(q || "").trim().replace(/\s+please$/, "").replace(/[?!.]+$/, "").trim().slice(0, 120);
}

function accountQuery(text) {
  let m = text.match(/^(?:look\s+up|find|show(?:\s+me)?|search(?:\s+for)?|get)\s+(?:the\s+)?account\s+(?:for\s+|of\s+)?(.+)$/);
  if (m) return cleanLookupQuery(m[1]);
  m = text.match(/^account\s+(?:lookup|for)\s+(.+)$/);
  if (m) return cleanLookupQuery(m[1]);
  m = text.match(/^(?:look\s+up|find|who\s+is)\s+(\S+@\S+)$/);
  if (m) return cleanLookupQuery(m[1]);
  return null;
}

function businessQuery(text) {
  let m = text.match(/^(?:look\s+up|find|show(?:\s+me)?|search(?:\s+for)?|get)\s+(?:the\s+)?(?:business|store|shop|company)\s+(?:for\s+|of\s+|named\s+)?(.+)$/);
  if (m) return cleanLookupQuery(m[1]);
  m = text.match(/^(?:business|store)\s+(?:lookup|for)\s+(.+)$/);
  if (m) return cleanLookupQuery(m[1]);
  return null;
}

export function matchAdminFastPath(message) {
  const text = normMessage(message);
  if (!text) return null;

  // Briefing (already deterministic before this change; kept here so the
  // fast path owns every no-model read).
  if (/\bbrief me\b/.test(text) || /\bbriefing\b/.test(text) ||
      /^(give me|send me|show me)\s+(a\s+|the\s+)?(brief|update|summary|daily update)/.test(text)) {
    return { tool: "full_briefing", args: { daily: /\bdaily\b/.test(text) } };
  }

  // Lookups are the most specific intents, so they win over the generic
  // words inside the query ("find account for the shop that owes us").
  const aq = accountQuery(text);
  if (aq) return { tool: "account_lookup", args: { query: aq } };
  const bq = businessQuery(text);
  if (bq) return { tool: "business_lookup", args: { query: bq } };

  if (/\bpending\b.*\b(payments?|transfers?|upgrades?)\b/.test(text) ||
      /\b(payments?|transfers?)\b.*\b(waiting|pending|outstanding|unpaid|owed)\b/.test(text) ||
      /\bunpaid\b/.test(text)) {
    return { tool: "pending_payments", args: {} };
  }
  if (/\bexpir\w*\b/.test(text) || /\bending soon\b/.test(text) ||
      /\brenewals?\b.*\b(due|coming|soon)\b/.test(text) || /\bdue for renewal\b/.test(text)) {
    return { tool: "expiring_subscriptions", args: { days: daysFrom(text, 7) } };
  }
  if (/\bsupport load\b/.test(text) || /\bopen cases?\b/.test(text) ||
      /\bsupport cases?\b/.test(text) || /\bcases?\s+(awaiting|waiting|open)\b/.test(text) ||
      /\bhow many\b.*\bsupport\b/.test(text) || /\bchats?\s+needing (a\s+)?human\b/.test(text) ||
      /\bawaiting (a\s+)?first response\b/.test(text) || /\bsupport\s+(queue|backlog)\b/.test(text)) {
    return { tool: "support_load", args: {} };
  }
  if (/\bai usage\b/.test(text) || /\bai\s+(questions|used|usage)\b/.test(text) ||
      /\bhow much ai\b/.test(text) || /\bkopa ai usage\b/.test(text)) {
    return { tool: "ai_usage_today", args: {} };
  }
  if (/\bdormant\b/.test(text) || /\binactive business\w*\b/.test(text) ||
      /\bnot selling\b/.test(text) || /\bbusiness\w*\s+(with\s+)?no sales?\b/.test(text)) {
    return { tool: "dormant_businesses", args: { days: daysFrom(text, 14) } };
  }
  if (/\bpromo\w*\b/.test(text) || /\bpromotion\b/.test(text) || /\bfree month\b/.test(text)) {
    return { tool: "promo_state", args: {} };
  }
  if (/\brevenue\b/.test(text) || /\bearnings?\b/.test(text) || /\bincome\b/.test(text) ||
      /\bhow much did we make\b/.test(text) ||
      /\bhow much\b.*\b(made|earn|earned|make)\b/.test(text) ||
      /\bmoney\b.*\b(made|earned|earn)\b/.test(text)) {
    return { tool: "revenue", args: { period: periodFrom(text) } };
  }
  if (/\bsign ?ups?\b/.test(text) || /\bsigned up\b/.test(text) ||
      /\bnew\s+(users?|accounts?|signups?|members?)\b/.test(text) ||
      /\bwho signed up\b/.test(text) || /\bregistrations?\b/.test(text)) {
    return { tool: "signups", args: { period: periodFrom(text) } };
  }
  if (/\btiers?\b/.test(text) || /\baccounts?\s+by tier\b/.test(text) ||
      /\bhow many\b.*\b(free|starter|solo|pro)\b/.test(text) || /\bplan breakdown\b/.test(text)) {
    return { tool: "accounts_by_tier", args: {} };
  }
  if (/\bhow\s+(is|are)\s+(the\s+)?platform\b/.test(text) ||
      /\bplatform\s+(overview|doing|status|health|summary|totals?|figures?|numbers?)\b/.test(text) ||
      /\bhow are we doing\b/.test(text) || /\boverall\b/.test(text)) {
    return { tool: "platform_overview", args: {} };
  }
  return null;
}

// Short deterministic answer from one tool result. Lists are capped at 5
// (3 for promo / AI top lists) and the reply is plain sentences: no raw
// tool JSON is ever returned, so no reply path can contain a snapshot dump.
export function formatReadToolAnswer(tool, args, result) {
  const failed = "I could not pull that figure right now. Ask me to brief you and I will pull the live figures directly.";
  if (!result || result.error) return failed;
  const n = (v) => Number(v || 0);
  switch (tool) {
    case "platform_overview":
      return `Platform overview: ${n(result.users)} users (${n(result.suspended)} suspended), ${n(result.businesses)} businesses (${n(result.active_businesses)} active), ${n(result.paying)} paying accounts. All-time subscription revenue ${fmtNGN(result.revenue_ngn)}. Pending upgrades: ${n(result.pending_upgrades)}. Sales recorded: ${n(result.sales)} sales, volume ${fmtNGN(result.sales_volume_ngn)}.`;
    case "signups": {
      const p = result.period || "today";
      let s = `Signups ${p}: ${n(result.count)} (total users ${n(result.total)}).`;
      if (p === "week" && Array.isArray(result.series) && result.series.length) {
        s += " By day: " + result.series.map((d) => `${d.day}: ${n(d.count)}`).join(", ") + ".";
      }
      return s;
    }
    case "revenue": {
      const p = result.period || "today";
      let s = `Revenue ${p}: ${fmtNGN(result.total_ngn)} from ${n(result.count)} payments.`;
      if (Array.isArray(result.by_method) && result.by_method.length) {
        s += ` By method: ${result.by_method.slice(0, 4).map((m) => `${m.method} ${fmtNGN(m.total_ngn)} (${n(m.count)})`).join(", ")}.`;
      }
      if (Array.isArray(result.by_tier) && result.by_tier.length) {
        s += ` By tier: ${result.by_tier.slice(0, 4).map((t) => `${t.tier} ${fmtNGN(t.total_ngn)} (${n(t.count)})`).join(", ")}.`;
      }
      if (result.manual_ngn != null) s += ` Manual approved: ${fmtNGN(result.manual_ngn)} (${n(result.manual_count)}).`;
      return s;
    }
    case "pending_payments": {
      const sub = result.subscriptions || {};
      const manual = result.manual || {};
      let s = `Pending payments: ${n(sub.count)} Paystack payments, ${manual.count == null ? "unknown" : n(manual.count)} manual transfers (${manual.older_than_48h == null ? "unknown" : n(manual.older_than_48h)} older than 48 hours), ${n(result.pending_upgrades)} pending upgrades.`;
      const list = (sub.payments || []).slice(0, 3);
      if (list.length) {
        s += " Latest: " + list.map((p) => `${p.email || "unknown"} ${p.tier || ""} ${fmtNGN(p.amount_ngn)}`.trim()).join("; ") + ".";
      }
      return s;
    }
    case "expiring_subscriptions": {
      let s = `${n(result.count)} paid subscriptions expire in the next ${n(result.days || 7)} days.`;
      const list = (result.subscriptions || []).slice(0, 5);
      if (list.length) {
        s += " " + list.map((x) => `${x.email || x.full_name || "unknown"} (${x.tier || "?"}, ends ${x.current_period_end || "?"})`).join("; ") + ".";
      }
      return s;
    }
    case "promo_state": {
      let s = result.is_active ? "The Pro free month promo is running." : "The Pro free month promo is not running.";
      s += ` Total claims: ${result.total_claims == null ? "unknown" : n(result.total_claims)}, active claims: ${result.active_claims == null ? "unknown" : n(result.active_claims)}.`;
      const newest = (result.newest_claims || []).slice(0, 3);
      if (newest.length) s += " Newest: " + newest.map((c) => `${c.email || "unknown"} (${c.status || "?"})`).join("; ") + ".";
      return s;
    }
    case "support_load": {
      const by = result.by_status || {};
      const parts = Object.keys(by).map((k) => `${k} ${n(by[k])}`).join(", ");
      return `Support load: ${result.open == null ? "unknown" : n(result.open)} open cases${parts ? ` (${parts})` : ""}, ${result.awaiting_first_response == null ? "unknown" : n(result.awaiting_first_response)} awaiting a first response, ${result.chats_needing_human == null ? "unknown" : n(result.chats_needing_human)} live chats needing a human.`;
    }
    case "ai_usage_today": {
      let s = `AI usage today: ${n(result.total_questions)} questions, ${n(result.total_actions)} actions.`;
      if (Array.isArray(result.by_tier) && result.by_tier.length) {
        s += ` By tier: ${result.by_tier.map((t) => `${t.tier} ${n(t.questions)} questions`).join(", ")}.`;
      }
      const top = (result.top_businesses || []).slice(0, 3);
      if (top.length) s += ` Top businesses: ${top.map((b) => `${b.name || "business " + b.business_id} ${n(b.questions)} questions`).join(", ")}.`;
      return s;
    }
    case "dormant_businesses": {
      let s = `${n(result.count)} active businesses have had no sale in the last ${n(result.days || 14)} days.`;
      const list = (result.businesses || []).slice(0, 5);
      if (list.length) {
        s += " " + list.map((b) => `${b.name || "business " + b.id} (${b.days_inactive == null ? "?" : n(b.days_inactive)} days inactive${b.last_sale_at ? "" : ", never sold"})`).join("; ") + ".";
      }
      return s;
    }
    case "accounts_by_tier": {
      const tiers = result.by_tier || [];
      if (!tiers.length) return "No tier figures available right now.";
      return `Accounts by tier: ${tiers.map((t) => `${t.tier} ${n(t.count)}`).join(", ")} (total ${n(result.total)}).${result.active_promo_claims != null ? ` Active promo claims: ${n(result.active_promo_claims)}.` : ""}`;
    }
    case "account_lookup": {
      const acc = result.accounts || [];
      if (!acc.length) return `No account found for "${result.query || ""}".`;
      return acc.slice(0, 5).map((a) => {
        const sub = a.subscription || {};
        return `${a.full_name || a.email} (${a.email}) - ${sub.tier || "free"} ${sub.status || ""}, ${(a.businesses || []).length} business(es), paid ${fmtNGN(a.paid_total_ngn)} in total${a.support_cases && a.support_cases.open ? `, ${n(a.support_cases.open)} open support case(s)` : ""}.`.trim();
      }).join("\n");
    }
    case "business_lookup": {
      const biz = result.businesses || [];
      if (!biz.length) return `No business found for "${result.query || ""}".`;
      return biz.slice(0, 5).map((b) => `${b.name} - owner ${b.owner_email || "unknown"} (${b.owner_tier || "free"}), ${n(b.sales_count)} sales, volume ${fmtNGN(b.sales_volume_ngn)}, ${n(b.products_count)} products, ${n(b.customers_count)} customers${b.last_sale_at ? `, last sale ${b.last_sale_at}` : ", no sales yet"}.`).join("\n");
    }
    case "full_briefing":
      return composeBriefingText(result);
    default:
      return failed;
  }
}

// A model reply is plain text for the owner, never a data dump. TOOL_CALL
// lines are stripped (as before); a reply that is really a JSON object or
// array, e.g. the model echoing a TOOL_RESULT payload, is dropped in full
// instead of shown; anything longer than the cap is truncated.
function sanitizeModelReply(text) {
  const clean = stripToolCalls(text);
  if (!clean) return "";
  if (/^\s*[\[{]/.test(clean)) return "";
  return clean.length > MAX_MODEL_REPLY_CHARS ? clean.slice(0, MAX_MODEL_REPLY_CHARS) + "..." : clean;
}

export async function runAdminAiChat(context, auth, body, deps = {}) {
  const env = context.env;
  const db = env.KOPABOOK_DB;
  const message = String((body && body.message) || "").trim();
  const history = Array.isArray(body && body.history) ? body.history : [];
  if (!message) return { ok: false, reply: "Type a message first.", tools_used: [] };

  try { await ensureAdminAiTables(db); } catch (e) { /* proposals degrade */ }

  // Hard rule, checked before anything else: a chat confirmation word
  // never executes. If a proposal is pending, point at its card.
  if (CONFIRM_WORDS.test(message)) {
    let pending = null;
    try { pending = await getPendingProposal(db, auth.user.id); } catch (e) { pending = null; }
    if (pending) {
      return {
        ok: true,
        reply: `That action is waiting for your confirmation. Chat cannot run it, even when you say yes here. Tap the Confirm button on its card to run it, or tap Cancel on the card to drop it. Waiting proposal: ${pending.summary}`,
        tools_used: [],
        proposal: pending,
      };
    }
  }

  // Deterministic fast path: common read intents run the read tool
  // directly, with NO model call, so they answer in seconds even when
  // the AI provider is down or slow. "brief me" lives here too.
  const fast = matchAdminFastPath(message);
  if (fast) {
    try {
      const pack = await executeReadTool(db, fast.tool, fast.args || {});
      if (fast.tool === "full_briefing") {
        const reply = fast.args && fast.args.daily ? composeDailyText(pack) : composeBriefingText(pack);
        return { ok: true, reply, tools_used: ["full_briefing"] };
      }
      return { ok: true, reply: formatReadToolAnswer(fast.tool, fast.args || {}, pack), tools_used: [fast.tool] };
    } catch (e) {
      return {
        ok: true,
        reply: "I could not pull that figure right now. Ask me to brief you and I will pull the live figures directly.",
        tools_used: [],
      };
    }
  }

  const hasModel = (deps && typeof deps.generateText === "function") || aiProviderAvailable(env);
  if (!hasModel) {
    if (/\b(daily\s+)?briefing\b/i.test(message)) {
      const pack = await executeReadTool(db, "full_briefing", {});
      return { ok: true, reply: composeDailyText(pack), tools_used: ["full_briefing"] };
    }
    return {
      ok: true,
      reply: "Admin AI is not connected right now. No AI provider is configured, so I can only run the built in briefing. Ask me to brief you and I will pull the live figures.",
      tools_used: [],
    };
  }

  const messages = [{ role: "system", content: systemPromptText() }];
  for (const h of history.slice(-16)) {
    const role = h && h.role === "assistant" ? "assistant" : "user";
    const content = String((h && h.content) || "").trim();
    if (content) messages.push({ role, content: content.slice(0, 4000) });
  }
  messages.push({ role: "user", content: message });

  const toolsUsed = [];
  let lastText = "";
  // Global model deadline: 30s across all rounds, 3 rounds max. Before
  // the loop a single model round could take 90s and five rounds 450s.
  // If the deadline expires, the one-line failure is returned, never a
  // partial dump and never a hang past the budget.
  const deadlineAt = Date.now() + MODEL_DEADLINE_MS;
  for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      return { ok: true, reply: MODEL_FAILURE_LINE, tools_used: [] };
    }
    let text = "";
    try {
      text = String((await callModelWithDeadline(context, deps, messages, remaining)) || "");
    } catch (e) {
      if (e instanceof ModelDeadlineError || !toolsUsed.length) {
        return {
          ok: true,
          reply: MODEL_FAILURE_LINE,
          tools_used: [],
        };
      }
      break;
    }
    lastText = text;
    const call = parseToolCall(text);
    if (!call) {
      const reply = sanitizeModelReply(text) || "I do not have an answer for that yet. Try asking for a briefing or a specific figure.";
      return { ok: true, reply, tools_used: toolsUsed };
    }
    if (call.error) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `TOOL_RESULT error ${JSON.stringify({ error: call.error })} Reply to the owner in plain text, or call a valid tool.` });
      continue;
    }
    const name = call.name;
    const args = call.args || {};

    // Proposal path: create the card and stop. Never execute here.
    if (Object.prototype.hasOwnProperty.call(PROPOSE_TO_ACTION, name)) {
      toolsUsed.push(name);
      const proposal = await createProposal(context, auth, PROPOSE_TO_ACTION[name], args);
      if (proposal && proposal.error) {
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `TOOL_RESULT ${name} ${JSON.stringify({ error: proposal.error, candidates: proposal.candidates || [] })} Tell the owner what is missing or ambiguous in plain text. Do not claim anything was prepared or done.`,
        });
        continue;
      }
      return {
        ok: true,
        reply: "Prepared for your confirmation. " + proposal.summary + " Nothing has changed yet. Tap Confirm on the card to run it, or Cancel to drop it.",
        tools_used: toolsUsed,
        proposal,
      };
    }

    if (!READ_TOOL_NAMES.includes(name)) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `TOOL_RESULT ${name} ${JSON.stringify({ error: "Unknown tool." })} Use only the listed tools.` });
      continue;
    }

    toolsUsed.push(name);
    let result;
    try {
      result = await executeReadTool(db, name, args);
    } catch (e) {
      result = { error: String((e && e.message) || e) };
    }
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: `TOOL_RESULT ${name} ${JSON.stringify(result).slice(0, 8000)}` });
  }

  const fallback = sanitizeModelReply(lastText);
  return {
    ok: true,
    reply: fallback || "I checked the available figures but could not finish a clean answer. Try asking for one specific figure, or ask me to brief you.",
    tools_used: toolsUsed,
  };
}
