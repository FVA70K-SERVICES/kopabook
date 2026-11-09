// POST /api/ai/chat: Kopa, the KopaBook business assistant (paid Gemini keys only, no free chain).
//
// One live chatbot that answers EVERYTHING about the business from real,
// live store data. The LLM never writes SQL and never invents numbers: every
// request injects a rich business snapshot (all queries parameterized, every
// one filtered by business_id from the authenticated session).
//
// On Solo/Pro the assistant is also agentic: when the user asks it to DO
// something, the model emits an ACTION line, the backend validates it
// into an exact proposal, and only a Confirm tap on the proposal card
// executes it against the real tables, then confirms with real numbers.
// Chat words alone never execute anything.
//
// Tiered AI for every plan. Free: 5 questions/day, read-only for general
// actions, PLUS project writes in their own bucket of 5 executed project
// actions/day (Projects itself is open to all plans). Starter: 20/day,
// read + record_sale/add_expense (10 actions/day). Solo: 50/day, all tools.
// Pro: 100/day, all tools. 60/hr rate limit on top.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate, businessDay, businessDayWindow } from "../_utils";
import { getBusinessOwnerTier, LIMITS } from "../billing";
import { checkRateLimit } from "../_webhook_security";
import { PROJECT_TYPES, projectTotals } from "../projects/_lib.js";
import { onRequestPost as createProjectEndpoint } from "../projects/index.js";
import {
  onRequestPost as addProjectMilestoneEndpoint,
  onRequestPatch as updateProjectMilestoneEndpoint,
} from "../projects/milestones.js";
import { onRequestPost as recordProjectTransactionEndpoint } from "../projects/transactions.js";
import { onRequestPost as createProjectInviteEndpoint } from "../projects/invites.js";
import { onRequestGet as projectReportEndpoint } from "../projects/report.js";
import {
  onRequestPatch as updateProjectEndpoint,
  onRequestDelete as deleteProjectEndpoint,
} from "../projects/[id].js";
import { resolveFastPath, isClearChatRequest, CLEAR_CHAT_QUESTION, CLEAR_CHAT_DECLINED, CLEAR_CHAT_DONE } from "./_fastpath.js";

const GEMINI_MODEL = "gemini-3.7-flash";
// Cut 2026-11-05 from 45000: the 45s ceiling let one failing model call
// hang the chat for up to 180s (two providers, one retry each) before the
// resting dump. The deterministic fast path now answers every common
// intent with no model call, so the model is only for open questions; a
// failed model call must fail fast instead. 15s per attempt, retry only
// on 429/5xx, two providers: worst case about 30s per model call.
const PROVIDER_TIMEOUT_MS = 15000;
// Two paid Gemini slots, the ONLY model providers for every Kopa bot.
// Fortune confirmed 2026-11-02 that the Gemini keys already held are paid
// API keys, so both are paid providers, not a free chain: GEMINI_PAID_API_KEY
// is tried first, then the already-held GEMINI_API_KEY. No Groq, OpenRouter,
// Workers AI, or any other provider is restored by this change.
// Model changed 2026-11-02 from gemini-3.8-flash to gemini-3.7-flash:
// Fortune reported from his own Google AI Studio check that 3.7 is the
// version available to his keys, after both keys failed on 3.8-flash.
// No other provider, key order, or cap changes in this set.
// Env var names only: GEMINI_PAID_API_KEY, GEMINI_API_KEY, Pages dashboard
// secrets, never in code, chat, files, logs, or any endpoint response.
const GEMINI_PAID_MODEL = GEMINI_MODEL;
// Raised 2026-11-05 from 2048: gemini-3.7-flash is a reasoning model and
// spends part of its output budget thinking. With a 2048 cap the visible
// answer can come back empty, which generateText treats as a provider
// failure and the chat answered with the resting dump. 4096 leaves room
// for thinking plus the answer, matching the advanced cap.
const STANDARD_MAX_OUTPUT_TOKENS = 4096;
const ADVANCED_MAX_OUTPUT_TOKENS = 4096;
// The ONLY reply when the model cannot be reached. One line, no snapshot
// dump: the full business snapshot must never be pasted into chat.
const MODEL_UNAVAILABLE_LINE = "Kopa AI could not reach the AI just now. Your books are fine. Try again, or ask me for today's sales or who owes you.";
const STATIC_CACHE_TTL_MS = 600000; // 10 minutes, static knowledge only
const RETRY_BACKOFF_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Static-knowledge cache only. Business chat always carries a live snapshot,
// so it must never opt in: a caller may pass staticKnowledge + staticCacheKey
// only for a business-free, static answer (plans, how-to, product facts).
// The key itself must never contain business data, figures, or user text.
const staticKnowledgeCache = new Map();

// Each provider below has this shape: (env, messages, opts) => text,
// and throws when it cannot answer. A missing credential throws a
// "not configured" error and the call moves to the next paid key, never
// falling back to any free provider.
async function providerGeminiPaid(env, messages, opts) {
  const key = env && env.GEMINI_PAID_API_KEY ? String(env.GEMINI_PAID_API_KEY) : "";
  if (!key) throw new Error("gemini-paid not configured");
  return geminiGenerate(key, messages, opts, GEMINI_PAID_MODEL);
}

// Already-held Gemini key, confirmed paid 2026-11-02, tried second only
// when gemini-paid fails or is absent. Same model, same endpoint.
async function providerGeminiExisting(env, messages, opts) {
  const key = env && env.GEMINI_API_KEY ? String(env.GEMINI_API_KEY) : "";
  if (!key) throw new Error("gemini-existing not configured");
  return geminiGenerate(key, messages, opts, GEMINI_PAID_MODEL);
}

async function geminiGenerate(key, messages, opts, modelName) {
  const model = modelName || GEMINI_MODEL;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  // Convert OpenAI-style {role, content} messages to Gemini format: the first
  // system message becomes system_instruction, assistant turns become model
  // turns. gemini-3.7-flash is a reasoning model, so the token budget leaves
  // room for its thinking plus the visible answer.
  let systemText = "";
  const contents = [];
  for (const m of messages || []) {
    const text = String((m && m.content) || "");
    if (!text) continue;
    const role = String((m && m.role) || "");
    if (role === "system" && !systemText) { systemText = text; continue; }
    contents.push({ role: role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  const payload = { contents };
  if (systemText) payload.system_instruction = { parts: [{ text: systemText }] };
  payload.generationConfig = {
    temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
    maxOutputTokens: opts.maxOutputTokens || 2048,
  };
  // Single retry only on 429 or 5xx, with a short backoff. Never on 400
  // and never on a timeout/abort.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        throw new Error("Gemini HTTP " + res.status);
      }
      const data = await res.json();
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map((p) => (p && p.text) || "").join("").trim();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Gemini HTTP retry exhausted");
}

const AI_PROVIDERS = {
  "gemini-paid": providerGeminiPaid,
  "gemini-existing": providerGeminiExisting,
};

export function aiProviderAvailable(env) {
  return !!((env && env.GEMINI_PAID_API_KEY) || (env && env.GEMINI_API_KEY));
}

// Paid-only routing: every Kopa bot (business chat, Admin AI, drafts,
// confirms) calls generateText, and generateText calls paid Gemini keys
// only, GEMINI_PAID_API_KEY first, then the already-held GEMINI_API_KEY.
// There is no free chain, no provider order env var, and no silent
// upgrade or downgrade. If both paid keys are absent or both fail,
// generateText throws and the call fails closed; callers keep their
// own deterministic fallbacks (business snapshot figures, Admin briefing),
// which are local figures, not a free AI provider.
//
// Tiered output caps: an explicit opts.maxOutputTokens always wins
// (draft/confirm calls keep 400). Otherwise standard calls get
// STANDARD_MAX_OUTPUT_TOKENS and advanced calls get
// ADVANCED_MAX_OUTPUT_TOKENS, set per call, never globally. The
// advanced flag now only sets the output cap, it no longer changes
// which provider is used, because paid is the only provider either way.
//
// Static cache: only when opts.staticKnowledge === true AND the caller
// supplies a business-free opts.staticCacheKey. Business chat never sets
// either, because its snapshot is live data that must never be cached.
export async function generateText(env, messages, opts) {
  const o = opts || {};
  const isAdvanced = o.advanced === true;
  const maxOutputTokens = typeof o.maxOutputTokens === "number"
    ? o.maxOutputTokens
    : (isAdvanced ? ADVANCED_MAX_OUTPUT_TOKENS : STANDARD_MAX_OUTPUT_TOKENS);
  const callOpts = Object.assign({}, o, { maxOutputTokens });
  const cacheKey = o.staticKnowledge === true && typeof o.staticCacheKey === "string" && o.staticCacheKey
    ? o.staticCacheKey : null;
  if (cacheKey) {
    const hit = staticKnowledgeCache.get(cacheKey);
    if (hit && Date.now() < hit.expiresAt) return hit.text;
    if (hit) staticKnowledgeCache.delete(cacheKey);
  }
  const order = ["gemini-paid", "gemini-existing"];
  let lastErr = null;
  for (const name of order) {
    const fn = AI_PROVIDERS[name];
    if (!fn) { console.error("AI provider order: unknown provider '" + name + "'"); continue; }
    try {
      const text = await fn(env, messages, callOpts);
      if (text) {
        if (cacheKey) staticKnowledgeCache.set(cacheKey, { text, expiresAt: Date.now() + STATIC_CACHE_TTL_MS });
        return text;
      }
      throw new Error("empty response from " + name);
    } catch (e) {
      lastErr = e;
      console.error("AI provider '" + name + "' failed: " + String((e && e.message) || e));
    }
  }
  throw lastErr || new Error("no AI provider available");
}

const HISTORY_LIMIT = 20;

// Per-tier AI allowances. tools: [] = read-only answers; "all" = every tool.
// actionsPerDay: null = unlimited actions within the question cap.
const AI_TIER_LIMITS = {
  free:    { questionsPerDay: 5,   tools: [], actionsPerDay: 0 },
  starter: { questionsPerDay: 20,  tools: ["record_sale", "add_expense", "draft_debtor_message", "save_memory"], actionsPerDay: 10 },
  solo:    { questionsPerDay: 50,  tools: "all", actionsPerDay: null },
  pro:     { questionsPerDay: 100, tools: "all", actionsPerDay: null },
};
const BASE_TOOLS = ["record_sale", "add_expense", "add_product", "record_customer_payment", "set_reminder", "get_customer_balance", "draft_debtor_message", "send_debtor_message", "save_memory"];
const PROJECT_WRITE_TOOLS = [
  "create_project_plan",
  "project_add_milestone",
  "project_complete_milestone",
  "project_record_transaction",
  "project_update",
  "project_invite",
];
const PROJECT_TOOLS = [...PROJECT_WRITE_TOOLS, "project_report"];
const ALL_TOOLS = [...BASE_TOOLS, ...PROJECT_TOOLS];
const UPGRADE_NUDGE = "Upgrade to Starter for AI actions, or Solo/Pro for the full AI assistant.";

// Projects is open to every plan, Free included (Fortune, 2026-10-20), so
// the project tools are allowed on all tiers. What stays tiered is HOW MANY
// AI project actions a Free business may execute: its own bucket of 5 per
// day, counted on execution only (see countProjectActionsToday). Every
// other Free write stays behind the standing read-only rule.
const FREE_PROJECT_ACTIONS_PER_DAY = 5;
const FREE_PROJECT_CAP_MSG = "You have used today's 5 free AI project actions for this business. Project actions resume tomorrow, or upgrade to Starter, Solo or Pro for more AI actions. Nothing was created or changed.";

// Pure helpers, exported for local tests. They carry no business data.
export function debtorDraftMatches(lastAssistantContent, message) {
  const draft = typeof lastAssistantContent === "string" ? lastAssistantContent : "";
  const text = typeof message === "string" ? message.trim() : "";
  return !!text && draft.includes(text);
}
export function firstMissingProjectField(name, type, goal) {
  if (!name) return "name";
  if (!PROJECT_TYPES.includes(String(type || "").trim().toLowerCase())) return "type";
  if (!goal) return "goal";
  return null;
}
export function tierAllowsTool(tier, tool) {
  // Project tools are open on every plan. The Projects endpoints make the
  // final access decision, including the invited-member path, and the Free
  // project-action bucket is enforced separately below.
  if (PROJECT_TOOLS.includes(tool)) return true;
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  if (cfg.tools === "all") return true;
  return cfg.tools.includes(tool);
}

function allowedToolsForTier(tier) {
  const cfg = AI_TIER_LIMITS[tier] || AI_TIER_LIMITS.free;
  const base = cfg.tools === "all" ? BASE_TOOLS : [...cfg.tools];
  return [...new Set([...base, ...PROJECT_TOOLS])];
}

// Roles that may use every AI tool. Everyone else (shop staff) may only
// record sales and check customer balances.
const PRIVILEGED_ROLES = ["owner", "partner", "admin"];
const STAFF_TOOLS = ["record_sale", "get_customer_balance", "project_report"];

function fmt(n, currency) {
  const v = Number(n || 0);
  return (currency || "NGN") + " " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function isPrivileged(auth) {
  return PRIVILEGED_ROLES.includes(auth.business && auth.business.role);
}

export function toolAllowed(auth, tool) {
  if (isPrivileged(auth)) return true;
  return STAFF_TOOLS.includes(tool);
}

// ---------------------------------------------------------------------------
// Rich business snapshot. One bad query must never kill the whole answer, so
// each section is wrapped in its own try/catch. Every query binds business_id
// from auth, never from user input.
//
// Business-timezone windows (round 5): every sales/expenses figure below
// comes from the business's own timezone (auth.business.timezone, default
// Africa/Lagos), the same pattern buildBriefing already uses. The old
// UTC-day/month queries answered the wrong day after midnight WAT: at
// 01:32 WAT on 2026-11-06 the UTC day had 0 sales while the Lagos day
// had 1 sale, NGN 2,270,256, so Ask Kopa AI said "No sales yet today"
// on the same session the Dashboard showed NGN 2,270,256.
//
// Profit is sales minus expenses per window, the same definition as the
// briefing's "Profit today" line. There is NO cost_price in this
// snapshot (products carry price and stock only), so gross margin from
// cost is not computable here: never invent cost data, and a reader
// that cannot compute a figure must use unknownFigureText() with the
// reason, never a guessed figure.
// ---------------------------------------------------------------------------
// Exported for local tests (same convention as the pure helpers below):
// the snapshot fields are only observable through chat replies otherwise.
export async function buildSnapshot(db, auth) {
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

  // Business-tz period windows, all from the same "now": today,
  // yesterday, this week (Monday to Sunday), this month, this year.
  // Sales compare created_at (a UTC timestamp) against UTC windows;
  // expenses compare incurred_on (a local YYYY-MM-DD date) against
  // local dates. Voided sales (status 'voided', world-best soft void)
  // never count anywhere: old rows may have a NULL status, so the
  // filter keeps NULLs and excludes only 'voided'.
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayW = businessDay(tz, now);
  const yestW = businessDay(tz, new Date(now.getTime() - 24 * 3600 * 1000));
  const tomorrowDate = businessDay(tz, new Date(now.getTime() + 24 * 3600 * 1000)).date;
  const [ty, tm, td] = todayW.date.split("-").map(Number);
  const dayMs = 24 * 3600 * 1000;
  const utcDay = Date.UTC(ty, tm - 1, td);
  const mondayMs = utcDay - (((new Date(utcDay).getUTCDay() + 6) % 7) * dayMs);
  const mondayDate = new Date(mondayMs).toISOString().slice(0, 10);
  const nextMondayDate = new Date(mondayMs + 7 * dayMs).toISOString().slice(0, 10);
  const monthStartDate = todayW.date.slice(0, 8) + "01";
  const nextMonthDate = tm === 12 ? (ty + 1) + "-01-01" : ty + "-" + String(tm + 1).padStart(2, "0") + "-01";
  const yearStartDate = ty + "-01-01";
  const nextYearDate = (ty + 1) + "-01-01";
  const weekStartUtc = businessDayWindow(tz, mondayDate).startUtc;
  const weekEndUtc = businessDayWindow(tz, nextMondayDate).startUtc;
  const monthStartUtc = businessDayWindow(tz, monthStartDate).startUtc;
  const monthEndUtc = businessDayWindow(tz, nextMonthDate).startUtc;
  const yearStartUtc = businessDayWindow(tz, yearStartDate).startUtc;
  const yearEndUtc = businessDayWindow(tz, nextYearDate).startUtc;
  const VOIDED = "(status IS NULL OR status <> 'voided')";
  const salesWindow = async (startUtc, endUtc) => {
    const r = await q(async () => await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt, COALESCE(SUM(change_given),0) AS changeGiven FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND ${VOIDED}`
    ).bind(businessId, startUtc, endUtc).first(), null);
    return { total: Number(r && r.total) || 0, count: Number(r && r.cnt) || 0, changeGiven: Number(r && r.changeGiven) || 0 };
  };
  const expensesWindow = async (startDate, endDate) => {
    const r = await q(async () => await db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses WHERE business_id = ? AND incurred_on >= ? AND incurred_on < ?`
    ).bind(businessId, startDate, endDate).first(), null);
    return { total: Number(r && r.total) || 0, count: Number(r && r.cnt) || 0 };
  };

  snap.businessName = auth.business.name || "Your business";
  snap.businessDate = todayW.date;
  snap.timezone = tz;
  snap.businessType = auth.business.business_type || "general";
  snap.tier = (await q(async () => (await getBusinessOwnerTier(db, businessId)).tier, "free")) || "free";

  snap.products = await q(async () => {
    let rows;
    try {
      rows = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.business_id = ? AND s.created_at >= date('now', '-30 days') AND (s.status IS NULL OR s.status <> 'voided')), 0) AS sold_30d
         FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
         WHERE p.business_id = ? AND p.is_active = 1
         ORDER BY sold_30d DESC, p.name ASC LIMIT 50`
      ).bind(businessId, businessId).all();
    } catch (e) {
      if (!/no such column: unit/i.test(String(e && e.message))) throw e;
      rows = await db.prepare(
        `SELECT p.id, p.name, p.unit_price, COALESCE(ii.quantity_on_hand, 0) AS stock,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                          WHERE si.product_id = p.id AND s.business_id = ? AND s.created_at >= date('now', '-30 days') AND (s.status IS NULL OR s.status <> 'voided')), 0) AS sold_30d
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

  snap.salesToday = await salesWindow(todayW.startUtc, todayW.endUtc);
  snap.salesYesterday = await salesWindow(yestW.startUtc, yestW.endUtc);
  snap.salesWeek = await salesWindow(weekStartUtc, weekEndUtc);
  snap.salesMonth = await salesWindow(monthStartUtc, monthEndUtc);
  snap.salesYear = await salesWindow(yearStartUtc, yearEndUtc);

  snap.expensesToday = await expensesWindow(todayW.date, tomorrowDate);
  snap.expensesYesterday = await expensesWindow(yestW.date, todayW.date);
  snap.expensesWeek = await expensesWindow(mondayDate, nextMondayDate);
  snap.expensesMonth = await expensesWindow(monthStartDate, nextMonthDate);
  snap.expensesYear = await expensesWindow(yearStartDate, nextYearDate);

  // Sales by day for the last 31 business days, in one query: the
  // date-sales and day-report reads need line items per day, not just
  // window totals. Rows are bucketed in JS by business-local date, so
  // a sale just after midnight WAT still lands on the Lagos day. Every
  // day in the range gets an entry, even with no sales, so a quiet day
  // reads as no sales rather than as missing data. Per day: total,
  // count, change given, items aggregated by product name (cap 20),
  // and debts for sales with a balance due (cap 10). Voided sales
  // never count. On a query failure the field is null, so the date
  // readers fall through instead of claiming no sales.
  snap.salesByDay = await q(async () => {
    const startMs = utcDay - 30 * dayMs;
    const startDate = new Date(startMs).toISOString().slice(0, 10);
    const startUtc = businessDayWindow(tz, startDate).startUtc;
    const rs = await db.prepare(
      `SELECT s.id, s.sale_number, COALESCE(c.name, 'Walk-in') AS customer,
              s.total_amount, s.amount_paid, s.balance_due, COALESCE(s.change_given, 0) AS change_given,
              s.created_at, si.quantity, si.line_total, p.name AS product_name
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND ${VOIDED}
       ORDER BY s.created_at ASC`
    ).bind(businessId, startUtc, todayW.endUtc).all();
    const days = {};
    const windows = [];
    for (let i = 0; i < 31; i++) {
      const d = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
      days[d] = { date: d, total: 0, count: 0, changeGiven: 0, items: [], debts: [] };
      windows.push({ date: d, ...businessDayWindow(tz, d) });
    }
    const seen = new Set();
    const agg = {};
    for (const row of rs.results || []) {
      const w = windows.find((x) => row.created_at >= x.startUtc && row.created_at < x.endUtc);
      if (!w) continue;
      const day = days[w.date];
      if (!seen.has(row.id)) {
        seen.add(row.id);
        day.total = Math.round((day.total + (Number(row.total_amount) || 0)) * 100) / 100;
        day.count += 1;
        day.changeGiven = Math.round((day.changeGiven + (Number(row.change_given) || 0)) * 100) / 100;
        if ((Number(row.balance_due) || 0) > 0 && day.debts.length < 10) {
          day.debts.push({ customer: row.customer || "Walk-in", amount: Number(row.balance_due) || 0, ref: row.sale_number || "" });
        }
      }
      if (row.product_name) {
        const key = w.date + "\n" + row.product_name;
        const a = agg[key] || (agg[key] = { product: row.product_name, qty: 0, amount: 0 });
        a.qty += Number(row.quantity) || 0;
        a.amount = Math.round((a.amount + (Number(row.line_total) || 0)) * 100) / 100;
      }
    }
    for (const [key, a] of Object.entries(agg)) {
      days[key.slice(0, 10)].items.push(a);
    }
    for (const d of Object.keys(days)) {
      days[d].items.sort((a, b) => b.amount - a.amount);
      days[d].items = days[d].items.slice(0, 20);
    }
    return days;
  }, null);

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
       WHERE s.business_id = ? AND (s.status IS NULL OR s.status <> 'voided') ORDER BY s.id DESC LIMIT 5`
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

  // All customers, not just debtors: "how many customers do I have"
  // needs this count; snap.debtors above is owing customers only.
  snap.customerCount = await q(async () => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE business_id = ?`).bind(businessId).first();
    return Number(r && r.n) || 0;
  }, 0);

  snap.projects = await q(async () => {
    const byId = new Map();
    const own = await db.prepare(
      `SELECT id, name, type, status, budget, 'business' AS access, NULL AS member_role
       FROM projects WHERE business_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(businessId).all();
    for (const p of own.results || []) byId.set(Number(p.id), p);
    const invited = await db.prepare(
      `SELECT p.id, p.name, p.type, p.status, p.budget, 'invited' AS access, pm.role AS member_role
       FROM project_members pm JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = ? ORDER BY p.id DESC LIMIT 20`
    ).bind(auth.user.id).all();
    for (const p of invited.results || []) if (!byId.has(Number(p.id))) byId.set(Number(p.id), p);
    const projects = [];
    for (const p of [...byId.values()].slice(0, 20)) {
      projects.push({ ...p, totals: await projectTotals(db, p.id) });
    }
    return projects;
  }, []);

  return snap;
}

function snapshotText(snap, currency) {
  const L = [];
  L.push(`Business: ${snap.businessName} (${snap.businessType}), plan: ${snap.tier}, staff members: ${snap.staffCount}, customers: ${Number(snap.customerCount || 0)}.`);
  if (snap.businessDate) {
    L.push(`Today is ${snap.businessDate} (${snap.timezone || "Africa/Lagos"}).`);
  }
  if (snap.products.length) {
    L.push("Products (name, price, unit, stock): " + snap.products.map((p) => `${p.name} ${fmt(p.price, currency)} per ${p.unit} (stock ${p.stock})`).join("; ") + ".");
  } else {
    L.push("Products: none added yet.");
  }
  L.push(`Sales today: ${fmt(snap.salesToday.total, currency)} across ${snap.salesToday.count} sales.`);
  if (snap.salesYesterday) {
    L.push(`Sales yesterday: ${fmt(snap.salesYesterday.total, currency)} across ${snap.salesYesterday.count} sales.`);
  }
  L.push(`Sales this month: ${fmt(snap.salesMonth.total, currency)} across ${snap.salesMonth.count} sales.`);
  if (snap.expensesToday) {
    L.push(`Expenses today: ${fmt(snap.expensesToday.total, currency)} across ${snap.expensesToday.count} expenses.`);
    // Profit is sales minus expenses for the same window. No cost_price
    // exists in the snapshot, so this is not gross margin from cost.
    L.push(`Profit today: ${fmt(Math.round((Number(snap.salesToday.total || 0) - Number(snap.expensesToday.total || 0)) * 100) / 100, currency)} (sales minus expenses).`);
  }
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
  if (snap.projects && snap.projects.length) {
    L.push("Projects visible to this user (id, name, type, status, budget, income, expenses, balance, milestones done/total, access): " + snap.projects.map((p) => `#${p.id} ${p.name} (${p.type}, ${p.status}, budget ${fmt(p.budget, currency)}, income ${fmt(p.totals.totalIncome, currency)}, expenses ${fmt(p.totals.totalExpense, currency)}, balance ${fmt(p.totals.balance, currency)}, milestones ${p.totals.milestonesDone}/${p.totals.milestonesTotal}, ${p.access}${p.member_role ? " " + p.member_role : ""})`).join("; ") + ".");
  } else {
    L.push("Projects visible to this user: none.");
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
  send_debtor_message: `- send_debtor_message: {"customer_name": "name", "message": "the EXACT draft text"}. This is a proposal first: show the draft, then the owner taps Confirm on the proposal card, then tap the WhatsApp link. The message param must match the draft you showed them word for word. Kopa never sends WhatsApp itself.`,
  save_memory: `- save_memory: {"key": "short label, e.g. supplier or price rule", "value": "the fact to remember"}. Saves something about this business to long-term memory so you remember it in future chats. To forget something, save the same key with an empty value. A key starting with "instruction:" is a standing instruction for this business only; it never applies to another business and never removes a hard gate.`,
  create_project_plan: `- create_project_plan: {"name": "project name", "type": "construction|event|charity|business|custom", "goal": "what success means", "milestones": [{"title": "step", "description": "optional", "due_date": "YYYY-MM-DD optional"}], "budget_lines": [{"label": "cost item", "amount": number}], "budget": optional total, "start_date": "optional", "end_date": "optional"}. Use ONLY after the brief interview below has produced a name, a valid type and a goal. This is a proposal to create the project and all its milestones in one go.`,
  project_add_milestone: `- project_add_milestone: {"project": "exact project name or id", "title": "milestone", "description": "optional", "due_date": "YYYY-MM-DD optional"}`,
  project_complete_milestone: `- project_complete_milestone: {"project": "exact project name or id", "milestone": "exact milestone title or id"}`,
  project_record_transaction: `- project_record_transaction: {"project": "exact project name or id", "kind": "income|expense", "amount": number, "description": "what the money was for", "category": "optional"}`,
  project_update: `- project_update: {"project": "exact project name or id", "new_name": "optional replacement name", "status": "completed to close it, or active to reopen it"}. Use for renaming or closing/reopening a project only.`,
  project_invite: `- project_invite: {"project": "exact project name or id", "email": "person@example.com", "role": "contributor|viewer optional"}. Contributor is the default unless the owner asks for viewer.`,
  project_report: `- project_report: {"project": "exact project name or id"}. Use this for EVERY question about how a named project is doing; its figures come from the project record, never from memory.`,
};

export function systemPrompt(snap, currency, tier, memorySection, assistant) {
  const profile = assistant || { name: "Kopa", custom: false, paEnabled: false, language: "en" };
  const assistantName = profile.name || "Kopa";
  const allowed = allowedToolsForTier(tier);
  const toolDocs = allowed.map((t) => TOOL_DOCS[t]).join("\n");
  const actionSection = allowed.length
    ? `ACTIONS (you can DO things, not just answer):
When the user asks you to DO something, output ONE line on its own, exactly in this format, with no code fences:
ACTION: {"tool": "tool_name", "params": {...}}
Then on the next lines write your normal reply text (e.g. what you are about to do).

Available tools and params:
${toolDocs}

DEBTOR MESSAGES: when the user wants a payment reminder written for a customer who owes money, use draft_debtor_message. I will show the draft for review. Only use send_debtor_message after the owner taps Confirm on its proposal card. The message you send must be word-for-word the draft they approved.

WRITE ACTIONS ARE PROPOSALS: write actions are proposals, not done deals. The system shows the user an exact summary and only records after they confirm, so your reply text beside a write ACTION must speak of what you propose to record, never claim it is already recorded.

MISSING DETAILS: if a write request is missing a detail that cannot be known from the snapshot (which product when several match, the price of a brand new product, how much was paid when that changes a balance), ask ONE short question and emit NO ACTION line.

Only output an ACTION line when the user clearly wants something done. For plain questions, just answer in natural text with no ACTION line.`
    : `ACTIONS: you are in read-only mode on this plan. You cannot record sales, add expenses, or take any other action. If the user asks you to DO something, answer warmly that actions need an upgrade: "${UPGRADE_NUDGE}"`;
  const projectSection = `PROJECT INTERVIEW AND MANAGEMENT:
- When the user wants a NEW project planned or created, interview briefly, ONE missing item at a time: first the project name, then its type (${PROJECT_TYPES.join(", ")}), then the goal. Do not invent the name, type or goal, and emit NO project ACTION while one is missing.
- Once name, type and goal are known, draft an ordered milestone list and planned budget lines from the goal and anything the user gave you, then emit create_project_plan. If the user gave no budget information at all, ask ONE question for a rough total or the main cost lines before emitting it. Planned budget lines are a draft for confirmation, not recorded spending.
- For an existing project, use the exact project name or id from the snapshot. If more than one visible project could match, ask which one; never guess.
- Use project_report for every status question about a project. Use the project management tools only for the active business's own projects, each as a separate proposal. Invited projects are report-only here: you may report on them, but you may not change them through this chat; their changes belong to their own business.

${tier === "free" ? `PROJECT ACTIONS ON THE FREE PLAN:
Projects itself is open on this plan, in the app and through you. You may plan, create and manage projects with the project tools, always as proposals the user confirms first. Free includes ${FREE_PROJECT_ACTIONS_PER_DAY} AI project actions a day for this business, counted only when a confirmed project action is actually carried out; proposals, cancellations and project reports never use one up. If the system says today's free project actions are used up, relay that plainly and do not emit a project ACTION. Every OTHER kind of action (recording sales, adding expenses, adding products and so on) still needs an upgrade on this plan.

` : ""}`;
  const managerSection = profile.paEnabled
    ? `MANAGER AND PA ROLE:
You are also the owner's business manager and personal assistant. Be proactive about stock, debts and reminders: flag low stock, overdue debts and due reminders when they matter. Use what you remember about this business (see the memory section above) when you advise and plan. Draft messages for the owner's approval and never send anything silently.

`
    : "";
  const languageSection = profile.language && profile.language !== "en"
    ? `LANGUAGE:
Reply in ${ASSISTANT_LANGUAGES[profile.language] || "English"} for all conversation. Keep business terms, product names and customer names exactly as they are. Always write amounts as figures (digits) as well as words where natural, so numbers are never ambiguous.

`
    : "";
  return `You are ${assistantName}, a warm, sharp conversational companion for this business owner, like a careful, trusted helper who knows the business well. Introduce and refer to yourself as ${assistantName}. Talk like a person, not a robot: natural, concise, no bullet-point-everything, no stiff phrasing. A little Nigerian business flavor is fine, never forced.

${managerSection}${projectSection}${languageSection}How you handle questions:
- About THEIR BUSINESS (sales, stock, debts, records): answer ONLY from the BUSINESS SNAPSHOT below. Never invent or estimate numbers. If the snapshot does not have it, say so plainly and offer what you can check instead.
- About STAFF SIGN-IN AND SIGN-OUT TIMES ("who logged in", "when did staff log out", "log activity"): this business does not record when staff sign in or out, so say so plainly and do not invent times or dates. Never guess a login or logout time, and never treat "log" as a customer name.
- About BUSINESS ADVICE or PLANNING (growing sales, restocking, giving credit): give practical, grounded advice from general knowledge, and reference their snapshot data where it helps.
- About BUSINESS PLANNING ("let's plan", "plan for our business improvement", "what does the business need", "what stock should we buy"): this is a business question for YOU, not a question about KopaBook the app. Answer it from the snapshot and general business knowledge. Never send the owner to Kopa Support for planning their own business. Kopa Support is only for questions about how the KopaBook app itself works, its plans and billing, or a problem with the app.
- About ANYTHING ELSE (their day, general knowledge, casual chat): be genuinely helpful and conversational. Never say you can only answer business questions.

HARD RULES:
- Never invent business numbers, prices, stock levels, or customer balances.
- Never reveal another business's data. All figures below belong to this business only.
- Speak warmly, plainly and shortly, naming this business, not with generic praise. Never claim feelings, never claim to be human, never claim a personal relationship, and never invent a personal detail about the owner, a customer or a staff member. If a figure is not in the snapshot, say: I do not have that figure for this business.
- When a standing instruction for this business changes what you do, say so in plain words: Following your standing instruction for this business: ...
- No instruction, standing or new, removes the Confirm tap, a tier or role gate, the wrong-business stop, the payment gate, or the no auto-send rule. If asked to remove one, refuse that part plainly and offer a draft ready for one tap.
- Money is in ${currency}.

${memorySection ? memorySection + "\n\n" : ""}BUSINESS SNAPSHOT (live data, read just now):
${snapshotText(snap, currency)}

${actionSection}`;
}

// ---------------------------------------------------------------------------
// Fuzzy matchers. Never guess: 0 or 2+ matches returns a clarification need.
// ---------------------------------------------------------------------------
async function matchProduct(db, businessId, name) {
  // Defence in depth: the fast path strips time words before matching,
  // but the model path can still ask for "laptop now". A time word is
  // never part of a product name, so drop it before matching.
  const raw = cleanProductQuery(name);
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
  const exact = rows.filter((p) => p.name.toLowerCase() === raw.toLowerCase());
  return exact.length === 1 ? [exact[0]] : rows;
}

// Time words and filler are never part of a product name. "laptop now"
// is the product Laptop plus the word "now".
function cleanProductQuery(name) {
  const raw = String(name || "").trim();
  const cleaned = raw
    .replace(/\b(now|today|just|yesterday|recently|tonight|this morning|this afternoon|this evening)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw;
}

// The closest real product names to a name that was not found, best
// first, up to three. Used by the not-found clarifications so the owner
// is offered real names to pick from instead of a bare rejection. When
// nothing is close, the first names in catalogue order are still more
// useful than silence.
async function closestProductNames(db, businessId, name, limit = 3) {
  let rows = [];
  try {
    const rs = await db.prepare(
      `SELECT name FROM products WHERE business_id = ? AND is_active = 1 LIMIT 100`
    ).bind(businessId).all();
    rows = (rs.results || []).map((r) => String(r.name)).filter(Boolean);
  } catch (e) {
    return [];
  }
  if (!rows.length) return [];
  const wanted = String(name || "").toLowerCase().trim();
  const score = (candidate) => {
    const c = candidate.toLowerCase();
    if (!wanted) return 0;
    if (c === wanted) return 100;
    if (c.includes(wanted) || wanted.includes(c)) return 80;
    const cw = c.split(/\s+/);
    const ww = wanted.split(/\s+/);
    const shared = cw.filter((x) => ww.some((y) => namesSimilar(x, y))).length;
    if (shared) return 50 + shared * 10;
    if (namesSimilar(c, wanted)) return 40;
    return 0;
  };
  return rows
    .map((n) => ({ name: n, s: score(n) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.name);
}

// One short not-found line that lists the closest real product names
// when there are any, so the owner can pick one. Never invents a name.
async function productNotFoundLine(db, businessId, requested) {
  const clean = cleanProductQuery(requested);
  const closest = await closestProductNames(db, businessId, clean);
  if (!closest.length) return `I could not find "${clean}" in your products. Check the name and try again.`;
  const list = closest.length === 1
    ? closest[0]
    : closest.slice(0, -1).join(", ") + ", or " + closest[closest.length - 1];
  return `I could not find "${clean}" in your products. Did you mean ${list}?`;
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

const BUSINESS_TIME_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Display a stored UTC "YYYY-MM-DD HH:MM:SS" instant in the business
// timezone (round 5). The stored value stays UTC; only the words
// change: "2026-11-07 14:00:00" in Africa/Lagos reads "3:00 pm
// tomorrow, 7 Nov" when today is 6 Nov. The raw UTC stamp used to show
// in the reminder proposal and done message, where 14:00 UTC read as
// 2pm instead of 3pm WAT. An unparseable stamp, or an unknown timezone,
// falls back to the raw stamp with no crash. Pure, exported for tests.
export function formatBusinessTime(utcStamp, tz, now) {
  const raw = String(utcStamp || "");
  const at = new Date(raw.replace(" ", "T") + "Z");
  if (!raw || Number.isNaN(at.getTime())) return raw;
  const zone = tz || "Africa/Lagos";
  const ref = now instanceof Date ? now : new Date();
  try {
    const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });
    const localDate = dateFmt.format(at);
    const refDate = dateFmt.format(ref);
    const time = timeFmt.format(at).toLowerCase();
    const [y, mo, d] = localDate.split("-").map(Number);
    const dayMs = 24 * 3600 * 1000;
    const diff = Math.round((Date.parse(localDate + "T00:00:00Z") - Date.parse(refDate + "T00:00:00Z")) / dayMs);
    let dayWord;
    if (diff === 0) dayWord = "today";
    else if (diff === 1) dayWord = "tomorrow";
    else if (diff === -1) dayWord = "yesterday";
    else dayWord = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(at);
    return `${time} ${dayWord}, ${d} ${BUSINESS_TIME_MONTHS[mo - 1]}`;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Tool executors. Each returns { ok, summary, clarification? }.
// clarification (string) means: do not execute, ask the user this instead.
// ---------------------------------------------------------------------------
async function execRecordSale(context, db, auth, params, currency, opts) {
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) return { ok: false, clarification: "What exactly should I record? Tell me the product and quantity, e.g. '2 Rice'." };

  const lines = [];
  for (const it of items) {
    const qty = Number(it.qty || it.quantity || 1);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, clarification: `How many "${it.product}"? I need a valid quantity.` };
    const matches = await matchProduct(db, auth.business.id, it.product || "");
    if (!matches.length) return { ok: false, clarification: await productNotFoundLine(db, auth.business.id, it.product || "") };
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

  if (opts && opts.dryRun) {
    // Be sure before proposing: if the user's own words did not name the
    // resolved product in full, and another product shares its first word
    // (Rice 5kg vs Rice 10kg), the model may have guessed between siblings.
    // Ask one targeted question instead of proposing the wrong item.
    if (opts.userMessage) {
      const msgLower = String(opts.userMessage).toLowerCase();
      for (const l of lines) {
        if (msgLower.includes(l.product.name.toLowerCase())) continue;
        const firstToken = l.product.name.trim().split(/\s+/)[0].toLowerCase();
        if (firstToken.length < 3) continue;
        const all = await db.prepare(
          `SELECT name FROM products WHERE business_id = ? AND is_active = 1 LIMIT 100`
        ).bind(auth.business.id).all();
        const siblings = (all.results || [])
          .map((r) => String(r.name))
          .filter((n) => n.toLowerCase() !== l.product.name.toLowerCase()
            && n.trim().split(/\s+/)[0].toLowerCase() === firstToken);
        if (siblings.length) {
          return { ok: false, clarification: `I want to be sure before I record anything: did you mean ${l.product.name} or ${siblings.join(" or ")}?` };
        }
      }
    }
    const proposalLines = lines.map((l) => `${l.qty} × ${l.product.name} at ${fmt(l.unitPrice, currency)} per ${l.product.unit} = ${fmt(l.lineTotal, currency)}`);
    proposalLines.push(`Total: ${fmt(subtotal, currency)}`);
    proposalLines.push(`Customer: ${customerName || "Walk-in"}`);
    proposalLines.push(`Amount paid: ${fmt(paid, currency)} (${paymentMethod})`);
    if (change > 0) proposalLines.push(`Change to give back: ${fmt(change, currency)}`);
    if (balanceDue > 0) proposalLines.push(`Balance going to debt: ${fmt(balanceDue, currency)}`);
    const itemDesc = lines.map((l) => `${l.qty} ${l.product.name} at ${fmt(l.unitPrice, currency)} per ${l.product.unit}`).join(", ");
    const custDesc = customerName ? ` for ${customerName}` : "";
    const payDesc = balanceDue > 0
      ? `paid ${fmt(paid, currency)} ${paymentMethod}, balance ${fmt(balanceDue, currency)} to be recorded as debt`
      : `paid ${fmt(paid, currency)} ${paymentMethod}`;
    return {
      ok: true,
      proposal: {
        summary: `Record sale of ${itemDesc}${custDesc}, total ${fmt(subtotal, currency)}, ${payDesc}.`,
        lines: proposalLines,
      },
    };
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

async function execAddExpense(context, db, auth, params, currency, opts) {
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
    else if (!(opts && opts.dryRun)) {
      const ins = await db.prepare(`INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 0)`)
        .bind(auth.business.id, categoryName).run();
      catId = ins.meta.last_row_id;
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record expense: ${description}, ${fmt(amt, currency)}${categoryName ? ` under ${categoryName}` : ""} on ${date}.`,
        lines: [
          `Description: ${description}`,
          `Amount: ${fmt(amt, currency)}`,
          `Category: ${categoryName || "Uncategorised"}`,
          `Date: ${date}`,
        ],
      },
    };
  }
  const result = await db.prepare(
    `INSERT INTO expenses (business_id, category_id, amount, note, incurred_on, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(auth.business.id, catId, Math.round(amt * 100) / 100, description, date, auth.user.id).run();
  await audit(context, auth, "ai.expense.create", "expense", result.meta.last_row_id, { amount: amt, via: "kopa_ai" });
  return { ok: true, summary: `Recorded expense: ${description}, ${fmt(amt, currency)}${categoryName ? ` under ${categoryName}` : ""}.` };
}

async function execAddProduct(context, db, auth, params, currency, opts) {
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
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Add product "${name}" at ${fmt(price, currency)} per ${unit}${opening > 0 ? ` with opening stock of ${opening}` : ""}.`,
        lines: [
          `Name: ${name}`,
          `Price: ${fmt(price, currency)}`,
          `Unit: ${unit}`,
          `Opening stock: ${opening}`,
        ],
      },
    };
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

async function execRecordCustomerPayment(context, db, auth, params, currency, opts) {
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
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record payment of ${fmt(applied, currency)} from ${c.name}. Balance will go from ${fmt(c.balance, currency)} to ${fmt(newBalance, currency)}.`,
        lines: [
          `Customer: ${c.name}`,
          `Amount: ${fmt(applied, currency)}`,
          `Balance before: ${fmt(c.balance, currency)}`,
          `Balance after: ${fmt(newBalance, currency)}`,
        ],
      },
    };
  }
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

async function execSetReminder(context, db, auth, params, currency, opts) {
  const text = String(params.text || "").trim().slice(0, 200);
  if (!text) return { ok: false, clarification: "What should I remind you about?" };
  const remindAt = parseRemindAt(params.remind_at || params.remindAt, auth.business.timezone);
  // Display only: the stored instant stays UTC (remindAt), the words
  // the owner reads are in the business timezone (round 5). 14:00 UTC
  // is 3:00 pm WAT, and the old "(UTC)" stamp read as 2pm.
  const remindDisplay = formatBusinessTime(remindAt, auth.business.timezone);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Set reminder: "${text}" for ${remindDisplay}.`,
        lines: [
          `Reminder: ${text}`,
          `Remind at: ${remindDisplay}`,
        ],
      },
    };
  }
  const id = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare(
    `INSERT INTO bot_reminders (id, business_id, user_id, title, remind_at, repeat_type, status) VALUES (?, ?, ?, ?, ?, 'once', 'pending')`
  ).bind(id, auth.business.id, String(auth.user.id), text, remindAt).run();
  await audit(context, auth, "ai.reminder.create", "reminder", null, { text, remind_at: remindAt, via: "kopa_ai" });
  return { ok: true, summary: `Reminder set: "${text}" for ${remindDisplay}.` };
}

async function execGetCustomerBalance(context, db, auth, params, currency) {
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
async function execDraftDebtorMessage(env, db, auth, params, currency) {
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
    draft = await generateText(env, [
        { role: "system", content: `You write short, professional payment reminders for Nigerian small businesses. Tone: ${tone} (${tone === "polite" ? "warm and respectful, first reminder" : tone === "firm" ? "direct but respectful, second reminder" : "serious and final, last warning before further action"}). Rules: address the customer by first name only, state the EXACT amount owed, mention the business name once, sign off with the business name, no emojis, no slang, keep it under 60 words. Plain text only, no quotes around it.` },
        { role: "user", content: `Customer: ${c.name}. Owes: ${fmt(c.balance, currency)}. Business: ${businessName}. Write the ${tone} reminder now.` },
      ], { maxOutputTokens: 400 });
    draft = String(draft).trim();
    if (!draft) throw new Error("empty");
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
async function execSendDebtorMessage(db, auth, params, currency, history, opts) {
  const name = String(params.customer_name || params.customerName || "").trim();
  const message = String(params.message || "").trim();
  if (!name || !message) return { ok: false, clarification: "Tell me which customer and the exact message to send." };
  // Enforcement: the previous assistant message must contain the exact draft.
  // On execution (Confirm tap), this check is skipped on purpose: the
  // proposal itself is the approval, and it was created only after the
  // dry-run below validated the draft. Re-checking chat history at
  // execution time would fail for a tap that carries no chat history.
  const lastAssistant = [...(history || [])].reverse().find((h) => h.role === "assistant");
  const approved = (opts && opts.skipDraftCheck) || debtorDraftMatches(lastAssistant && lastAssistant.content, message);
  if (!approved) {
    return { ok: false, clarification: `I need you to see and approve the message before I send anything. Tell me which customer you want reminded and I will draft it first.` };
  }
  const matches = await matchCustomer(db, auth.business.id, name);
  if (!matches.length) return { ok: false, clarification: `I could not find a customer called "${name}".` };
  if (matches.length > 1) return { ok: false, clarification: `"${name}" matches more than one customer. Which one?` };
  const c = matches[0];
  if (opts && opts.dryRun) {
    // Proposal only: no action log, no link handed out yet. The link is
    // built again at execution time, after the Confirm tap.
    return {
      ok: true,
      proposal: {
        summary: `Send a WhatsApp reminder to ${c.name} (${fmt(c.balance, currency)}).`,
        lines: [`Send to ${c.name} on WhatsApp:`, message],
      },
    };
  }
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

// Long-term memory: the model can remember facts about this business across
// chats. Empty value deletes the key. Needs migration 0050 (ai_memory table).
async function execSaveMemory(context, db, auth, params, currency, opts) {
  const key = String((params && (params.key || params.label)) || "").trim().slice(0, 80);
  const value = String((params && (params.value || params.fact)) || "").trim().slice(0, 1000);
  if (!key) return { ok: false, clarification: "What should I remember? Give me a short label and the fact." };
  if (opts && opts.dryRun) {
    const line = value ? `Remember ${key}: ${value}` : `Forget ${key}`;
    return {
      ok: true,
      proposal: {
        summary: line,
        lines: [line],
      },
    };
  }
  try {
    if (!value) {
      await db.prepare(`DELETE FROM ai_memory WHERE business_id = ? AND memory_key = ?`).bind(auth.business.id, key).run();
      await logAiAction(db, auth, params, "save_memory", { key, deleted: true }, {});
      return { ok: true, summary: `Forgot "${key}". I will not remember that anymore.` };
    }
    await db.prepare(
      `INSERT INTO ai_memory (business_id, memory_key, memory_value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(business_id, memory_key) DO UPDATE SET memory_value = excluded.memory_value, updated_at = datetime('now')`
    ).bind(auth.business.id, key, value).run();
  } catch (e) {
    return { ok: false, clarification: "I could not save that memory yet. The memory store needs a quick update first." };
  }
  await logAiAction(db, auth, params, "save_memory", { key }, { value });
  return { ok: true, summary: `Remembered "${key}". I will keep it in mind from now on.` };
}

async function execMarkReminderDone(context, db, auth, params, currency, opts) {
  const reminderId = String((params && (params.reminder_id || params.reminderId || params.id)) || "").trim();
  const title = String((params && params.title) || "").trim();
  if (!reminderId) return { ok: false, clarification: "Which reminder should I mark as done? Give me its exact title." };
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Mark reminder "${title || reminderId}" as done.`,
        lines: [`Mark reminder "${title || reminderId}" as done.`],
      },
    };
  }
  try {
    const res = await db.prepare(`UPDATE bot_reminders SET status = 'done' WHERE id = ? AND business_id = ?`).bind(reminderId, businessIdOf(auth)).run();
    // D1 run() does not reliably report changed rows, so re-read to prove it.
    const row = await db.prepare(`SELECT status FROM bot_reminders WHERE id = ? AND business_id = ?`).bind(reminderId, businessIdOf(auth)).first();
    if (!row || row.status !== "done") return { ok: false, clarification: "I could not find that reminder in this business." };
  } catch (e) {
    return { ok: false, clarification: "I could not update that reminder just now. Please try again." };
  }
  return { ok: true, summary: `Marked the reminder "${title || reminderId}" as done.` };
}
function businessIdOf(auth) { return auth && auth.business ? auth.business.id : null; }

async function logAiAction(db, auth, params, tool, p, result) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(
      `INSERT INTO ai_action_log (business_id, user_id, day, tool, params, result) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(auth.business.id, auth.user.id, day, tool, JSON.stringify(p || params || {}), JSON.stringify(result || {})).run();
  } catch (e) { /* logging must never break the action */ }
}

// ---------------------------------------------------------------------------
// Project powers. These executors are adapters around the existing Projects
// endpoints: every read and write goes through those handlers, with the
// caller's original session request, so project access, tier checks and
// audit behaviour stay in exactly one place.
// ---------------------------------------------------------------------------
function projectParam(params, ...keys) {
  for (const key of keys) {
    if (params && params[key] !== undefined && params[key] !== null && String(params[key]).trim() !== "") return params[key];
  }
  return "";
}

function cleanProjectText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function roundProjectMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function validProjectDate(value) {
  if (!value) return true;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text + "T00:00:00Z"));
}

async function callProjectEndpoint(context, handler, options = {}) {
  const headers = new Headers(context.request.headers);
  headers.delete("content-length");
  let body;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  const request = new Request(new URL(options.path || "/api/projects", context.request.url), {
    method: options.method || "GET",
    headers,
    body,
  });
  const childContext = { ...context, request, params: options.params || {} };
  const response = await handler(childContext);
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  if (!response.ok || !data || data.ok !== true) {
    return {
      ok: false,
      status: response.status,
      message: (data && data.message) || `The project service returned ${response.status}.`,
      data,
    };
  }
  return { ok: true, status: response.status, data };
}

async function matchBusinessProjects(db, businessId, queryRaw) {
  const query = String(queryRaw || "").trim();
  if (!query) return [];
  if (/^\d+$/.test(query)) {
    const row = await db.prepare(`SELECT * FROM projects WHERE id = ? AND business_id = ? LIMIT 1`)
      .bind(Number(query), businessId).first();
    return row ? [row] : [];
  }
  const exact = await db.prepare(
    `SELECT * FROM projects WHERE business_id = ? AND lower(name) = lower(?) ORDER BY id DESC`
  ).bind(businessId, query).all();
  if ((exact.results || []).length) return exact.results;
  const partial = await db.prepare(
    `SELECT * FROM projects WHERE business_id = ? AND instr(lower(name), lower(?)) > 0 ORDER BY id DESC LIMIT 10`
  ).bind(businessId, query).all();
  return partial.results || [];
}

async function resolveBusinessProject(db, auth, params) {
  const query = projectParam(params, "project", "project_name", "projectName", "project_id", "projectId", "id");
  if (!query) return { clarification: "Which project do you mean? Give me its exact name." };
  const matches = await matchBusinessProjects(db, auth.business.id, query);
  if (!matches.length) return { clarification: `I could not find a project called "${query}" in this business.` };
  if (matches.length > 1) {
    return { clarification: `"${query}" matches more than one project: ${matches.map((p) => `#${p.id} ${p.name}`).join(", ")}. Which one do you mean?` };
  }
  return { project: matches[0] };
}

async function matchProjectMilestones(db, projectId, queryRaw) {
  const query = String(queryRaw || "").trim();
  if (!query) return [];
  if (/^\d+$/.test(query)) {
    const row = await db.prepare(`SELECT * FROM project_milestones WHERE id = ? AND project_id = ? LIMIT 1`)
      .bind(Number(query), projectId).first();
    return row ? [row] : [];
  }
  const exact = await db.prepare(
    `SELECT * FROM project_milestones WHERE project_id = ? AND lower(title) = lower(?) ORDER BY id ASC`
  ).bind(projectId, query).all();
  if ((exact.results || []).length) return exact.results;
  const partial = await db.prepare(
    `SELECT * FROM project_milestones WHERE project_id = ? AND instr(lower(title), lower(?)) > 0 ORDER BY id ASC LIMIT 10`
  ).bind(projectId, query).all();
  return partial.results || [];
}

async function resolveProjectMilestone(db, project, params) {
  const query = projectParam(params, "milestone", "milestone_name", "milestoneName", "milestone_id", "milestoneId", "id");
  if (!query) return { clarification: `Which milestone in ${project.name} should I update?` };
  const matches = await matchProjectMilestones(db, project.id, query);
  if (!matches.length) return { clarification: `I could not find a milestone called "${query}" in ${project.name}.` };
  if (matches.length > 1) {
    return { clarification: `"${query}" matches more than one milestone in ${project.name}: ${matches.map((m) => `#${m.id} ${m.title}`).join(", ")}. Which one do you mean?` };
  }
  return { milestone: matches[0] };
}

function requireProjectOwnerPartner(auth, action) {
  if (["owner", "partner"].includes(auth.business && auth.business.role)) return null;
  return `Only the project owner or a partner can ${action}.`;
}

function normalizeProjectMilestones(params) {
  const raw = params && (params.milestones || params.steps);
  // Round 6: no milestones yet is a plan with zero milestones, not an
  // error. The executor used to ask "What milestones should the project
  // plan include, in order?" whenever none were supplied, so the
  // deterministic interview (name, type, goal, per the system prompt's
  // own project interview) could never reach a dry-run proposal: the
  // model path only worked because the model drafts a milestone list
  // from the goal, and the fast path must never invent milestones.
  // The proposal itself says "with 0 milestones", so the owner sees
  // it before Confirm, and milestones can be added afterwards with
  // project_add_milestone. Supplied milestones are still validated
  // exactly as before, and the 50 cap is unchanged.
  if (!Array.isArray(raw) || !raw.length) {
    return { milestones: [] };
  }
  if (raw.length > 50) return { error: "That project plan has too many milestones. Keep it to 50 or fewer." };
  const milestones = [];
  for (let i = 0; i < raw.length; i++) {
    const item = typeof raw[i] === "string" ? { title: raw[i] } : (raw[i] || {});
    const title = cleanProjectText(item.title || item.name, 200);
    if (!title) return { error: `Milestone ${i + 1} needs a title.` };
    const dueDate = item.due_date || item.dueDate || null;
    if (!validProjectDate(dueDate)) return { error: `Milestone "${title}" has an invalid due date. Use YYYY-MM-DD.` };
    milestones.push({
      title,
      description: cleanProjectText(item.description, 1000),
      dueDate: dueDate ? String(dueDate).slice(0, 10) : null,
    });
  }
  return { milestones };
}

function normalizeProjectBudgetLines(params) {
  const raw = params && (params.budget_lines || params.budgetLines || params.planned_budget || params.plannedBudget);
  const lines = [];
  if (raw !== undefined && raw !== null && raw !== "") {
    if (!Array.isArray(raw)) return { error: "Give the planned budget as a list of cost lines, each with a label and amount." };
    if (raw.length > 50) return { error: "That project plan has too many budget lines. Keep it to 50 or fewer." };
    for (let i = 0; i < raw.length; i++) {
      const item = typeof raw[i] === "string" ? { label: raw[i] } : (raw[i] || {});
      const label = cleanProjectText(item.label || item.category || item.name || item.description, 100);
      const amount = Number(item.amount ?? item.value ?? item.cost);
      if (!label) return { error: `Budget line ${i + 1} needs a label.` };
      if (!Number.isFinite(amount) || amount < 0) return { error: `What amount should I plan for "${label}"?` };
      lines.push({ label, amount: roundProjectMoney(amount) });
    }
  }
  const linesTotal = roundProjectMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const explicitRaw = params && (params.budget ?? params.total_budget ?? params.totalBudget);
  let budget = linesTotal;
  if (explicitRaw !== undefined && explicitRaw !== null && explicitRaw !== "") {
    const explicit = Number(explicitRaw);
    if (!Number.isFinite(explicit) || explicit < 0) return { error: "The project budget must be a valid non-negative amount." };
    budget = roundProjectMoney(explicit);
    if (lines.length && budget !== linesTotal) {
      return { error: "The project budget total does not match the planned budget lines. Which total should I use?" };
    }
  }
  return { lines, budget };
}

function plannedProjectDescription(goal, lines, currency) {
  let description = String(goal || "").trim();
  if (lines.length) {
    description += "\n\nPlanned budget lines:\n" + lines.map((line) => `- ${line.label}: ${fmt(line.amount, currency)}`).join("\n");
  }
  return description;
}

async function execCreateProjectPlan(context, db, auth, params, currency, opts) {
  const name = cleanProjectText(projectParam(params, "name", "project", "project_name", "projectName"), 200);
  const type = String(projectParam(params, "type", "project_type", "projectType") || "").trim().toLowerCase();
  const goal = cleanProjectText(projectParam(params, "goal", "description", "objective"), 2000);
  // Interview gate, shared with local tests: no action while name, type,
  // or goal is missing. Each missing field asks one short question.
  const missingField = firstMissingProjectField(name, type, goal);
  if (missingField === "name") return { ok: false, clarification: "What should we call the project?" };
  if (missingField === "type") return { ok: false, clarification: `What type of project is "${name}"? Choose one: ${PROJECT_TYPES.join(", ")}.` };
  if (missingField === "goal") return { ok: false, clarification: `What is the goal of "${name}"? Tell me what success should look like.` };

  const milestoneResult = normalizeProjectMilestones(params || {});
  if (milestoneResult.error) return { ok: false, clarification: milestoneResult.error };
  const budgetResult = normalizeProjectBudgetLines(params || {});
  if (budgetResult.error) return { ok: false, clarification: budgetResult.error };

  const startDate = projectParam(params, "start_date", "startDate") || null;
  const endDate = projectParam(params, "end_date", "endDate") || null;
  if (!validProjectDate(startDate) || !validProjectDate(endDate)) {
    return { ok: false, clarification: "Project dates must use YYYY-MM-DD." };
  }
  if (startDate && endDate && String(endDate).slice(0, 10) < String(startDate).slice(0, 10)) {
    return { ok: false, clarification: "The project end date is before its start date. Which dates are correct?" };
  }
  const description = plannedProjectDescription(goal, budgetResult.lines, currency);
  if (description.length > 2000) {
    return { ok: false, clarification: "That project goal and budget plan are too long to store together. Shorten the goal or budget lines." };
  }

  if (opts && opts.dryRun) {
    const lines = [
      `Project: ${name}`,
      `Type: ${type}`,
      `Goal: ${goal}`,
      `Planned budget: ${fmt(budgetResult.budget, currency)}`,
    ];
    for (const line of budgetResult.lines) lines.push(`Budget: ${line.label}: ${fmt(line.amount, currency)}`);
    lines.push("Milestones, in order:");
    milestoneResult.milestones.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.title}${m.dueDate ? ` (due ${m.dueDate})` : ""}${m.description ? `: ${m.description}` : ""}`);
    });
    if (startDate) lines.push(`Start date: ${String(startDate).slice(0, 10)}`);
    if (endDate) lines.push(`End date: ${String(endDate).slice(0, 10)}`);
    return {
      ok: true,
      proposal: {
        summary: `Create project "${name}" (${type}) with ${milestoneResult.milestones.length} milestones and a planned budget of ${fmt(budgetResult.budget, currency)}.`,
        lines,
      },
    };
  }

  const created = await callProjectEndpoint(context, createProjectEndpoint, {
    method: "POST",
    path: "/api/projects",
    body: {
      name,
      type,
      description,
      budget: budgetResult.budget,
      startDate: startDate ? String(startDate).slice(0, 10) : null,
      endDate: endDate ? String(endDate).slice(0, 10) : null,
    },
  });
  if (!created.ok) return { ok: false, clarification: created.message };
  const projectId = created.data.id;

  for (const milestone of milestoneResult.milestones) {
    const added = await callProjectEndpoint(context, addProjectMilestoneEndpoint, {
      method: "POST",
      path: "/api/projects/milestones",
      body: {
        projectId,
        title: milestone.title,
        description: milestone.description,
        dueDate: milestone.dueDate,
      },
    });
    if (!added.ok) {
      const rollback = await callProjectEndpoint(context, deleteProjectEndpoint, {
        method: "DELETE",
        path: `/api/projects/${projectId}`,
        params: { id: String(projectId) },
      }).catch(() => ({ ok: false }));
      return {
        ok: false,
        clarification: rollback.ok
          ? `I could not add the milestone "${milestone.title}", so I removed the incomplete project and changed nothing. ${added.message}`
          : `I created ${name}, but could not add the milestone "${milestone.title}". The incomplete project could not be removed automatically, so please check Projects before trying again. ${added.message}`,
      };
    }
  }

  return {
    ok: true,
    summary: `Created project "${name}" (${type}) with ${milestoneResult.milestones.length} milestones in order and a planned budget of ${fmt(budgetResult.budget, currency)}. Project ID ${projectId}.`,
  };
}

async function execProjectAddMilestone(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const title = cleanProjectText(projectParam(params, "title", "milestone", "milestone_name", "milestoneName"), 200);
  if (!title) return { ok: false, clarification: `What milestone should I add to ${project.name}?` };
  const description = cleanProjectText(params && params.description, 1000);
  const dueDate = projectParam(params, "due_date", "dueDate") || null;
  if (!validProjectDate(dueDate)) return { ok: false, clarification: "The milestone due date must use YYYY-MM-DD." };
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Add milestone "${title}" to project "${project.name}".`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Milestone: ${title}`,
          ...(description ? [`Details: ${description}`] : []),
          ...(dueDate ? [`Due date: ${String(dueDate).slice(0, 10)}`] : []),
        ],
      },
    };
  }
  const added = await callProjectEndpoint(context, addProjectMilestoneEndpoint, {
    method: "POST",
    path: "/api/projects/milestones",
    body: { projectId: project.id, title, description, dueDate: dueDate ? String(dueDate).slice(0, 10) : null },
  });
  if (!added.ok) return { ok: false, clarification: added.message };
  return { ok: true, summary: `Added milestone "${title}" to project "${project.name}".` };
}

async function execProjectCompleteMilestone(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const found = await resolveProjectMilestone(db, resolved.project, params || {});
  if (found.clarification) return { ok: false, clarification: found.clarification };
  const milestone = found.milestone;
  if (milestone.status === "done") {
    return { ok: false, clarification: `"${milestone.title}" in ${resolved.project.name} is already marked done.` };
  }
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Mark milestone "${milestone.title}" as done in project "${resolved.project.name}".`,
        lines: [
          `Project: ${resolved.project.name} (#${resolved.project.id})`,
          `Milestone: ${milestone.title} (#${milestone.id})`,
          "New status: done",
        ],
      },
    };
  }
  const updated = await callProjectEndpoint(context, updateProjectMilestoneEndpoint, {
    method: "PATCH",
    path: "/api/projects/milestones",
    body: { id: milestone.id, status: "done" },
  });
  if (!updated.ok) return { ok: false, clarification: updated.message };
  return { ok: true, summary: `Marked milestone "${milestone.title}" as done in project "${resolved.project.name}".` };
}

async function execProjectRecordTransaction(context, db, auth, params, currency, opts) {
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const kind = String(projectParam(params, "kind", "transaction_type", "transactionType") || "").trim().toLowerCase();
  if (!["income", "expense"].includes(kind)) {
    return { ok: false, clarification: `Was that money coming in (income) or going out (expense) for ${project.name}?` };
  }
  const amount = Number(params && params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, clarification: `How much was the project ${kind}? I need an amount greater than zero.` };
  }
  const description = cleanProjectText(params && params.description, 500);
  if (!description) return { ok: false, clarification: `What was the project ${kind} for? Give me a short description.` };
  const category = cleanProjectText(params && params.category, 100);
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Record project ${kind} of ${fmt(amount, currency)} for "${project.name}": ${description}.`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Type: ${kind}`,
          `Amount: ${fmt(amount, currency)}`,
          `Description: ${description}`,
          ...(category ? [`Category: ${category}`] : []),
        ],
      },
    };
  }
  const recorded = await callProjectEndpoint(context, recordProjectTransactionEndpoint, {
    method: "POST",
    path: "/api/projects/transactions",
    body: { projectId: project.id, kind, amount: roundProjectMoney(amount), category, description },
  });
  if (!recorded.ok) return { ok: false, clarification: recorded.message };
  return { ok: true, summary: `Recorded project ${kind} of ${fmt(amount, currency)} for "${project.name}": ${description}.` };
}

async function execProjectUpdate(context, db, auth, params, currency, opts) {
  const ownerDenied = requireProjectOwnerPartner(auth, "rename or close a project");
  if (ownerDenied) return { ok: false, clarification: ownerDenied };
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const newName = cleanProjectText(projectParam(params, "new_name", "newName", "rename_to", "renameTo"), 200);
  const statusText = String(projectParam(params, "status", "action") || "").trim().toLowerCase();
  let status = null;
  if (["completed", "complete", "closed", "close", "done"].includes(statusText)) status = "completed";
  else if (["active", "reopen", "reopened"].includes(statusText)) status = "active";
  else if (statusText) return { ok: false, clarification: "I can close a project by marking it completed, or reopen it as active. Which should I do?" };
  if (!newName && !status) {
    return { ok: false, clarification: `What should I change on ${project.name}: its name, or close it by marking it completed?` };
  }
  if (newName && newName === project.name && (!status || status === project.status)) {
    return { ok: false, clarification: `${project.name} already has that name and status.` };
  }
  if (!newName && status && status === project.status) {
    return { ok: false, clarification: `${project.name} is already ${status}.` };
  }
  const body = {};
  if (newName) body.name = newName;
  if (status) body.status = status;
  if (opts && opts.dryRun) {
    const changes = [];
    if (newName) changes.push(`Name: ${project.name} -> ${newName}`);
    if (status) changes.push(`Status: ${project.status} -> ${status}`);
    return {
      ok: true,
      proposal: {
        summary: `Update project "${project.name}": ${changes.join("; ")}.`,
        lines: [`Project: ${project.name} (#${project.id})`, ...changes],
      },
    };
  }
  const updated = await callProjectEndpoint(context, updateProjectEndpoint, {
    method: "PATCH",
    path: `/api/projects/${project.id}`,
    params: { id: String(project.id) },
    body,
  });
  if (!updated.ok) return { ok: false, clarification: updated.message };
  return { ok: true, summary: `Updated project "${project.name}"${newName ? ` to "${newName}"` : ""}${status ? ` and set its status to ${status}` : ""}.` };
}

async function execProjectInvite(context, db, auth, params, currency, opts) {
  const ownerDenied = requireProjectOwnerPartner(auth, "invite people to a project");
  if (ownerDenied) return { ok: false, clarification: ownerDenied };
  const resolved = await resolveBusinessProject(db, auth, params || {});
  if (resolved.clarification) return { ok: false, clarification: resolved.clarification };
  const project = resolved.project;
  const identifier = cleanProjectText(projectParam(params, "email", "identifier", "username"), 200);
  if (!identifier) return { ok: false, clarification: `What email should I invite to ${project.name}?` };
  const role = String(projectParam(params, "role") || "contributor").trim().toLowerCase() === "viewer" ? "viewer" : "contributor";
  if (opts && opts.dryRun) {
    return {
      ok: true,
      proposal: {
        summary: `Create a ${role} invite for ${identifier} to project "${project.name}".`,
        lines: [
          `Project: ${project.name} (#${project.id})`,
          `Invite: ${identifier}`,
          `Role: ${role}`,
        ],
      },
    };
  }
  const created = await callProjectEndpoint(context, createProjectInviteEndpoint, {
    method: "POST",
    path: "/api/projects/invites",
    body: { projectId: project.id, identifier, role },
  });
  if (!created.ok) return { ok: false, clarification: created.message };
  return {
    ok: true,
    summary: `Created a ${role} invite for ${identifier} to project "${project.name}". Share this join link with them: ${created.data.joinLink}`,
  };
}

async function execProjectReport(context, db, auth, params, currency) {
  const query = projectParam(params, "project", "project_name", "projectName", "project_id", "projectId", "id");
  let projectId = null;
  if (query && /^\d+$/.test(String(query))) {
    projectId = Number(query);
  } else if (query) {
    const byId = new Map();
    for (const p of await matchBusinessProjects(db, auth.business.id, query)) byId.set(Number(p.id), p);
    const invited = await db.prepare(
      `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND (lower(p.name) = lower(?) OR instr(lower(p.name), lower(?)) > 0)
       ORDER BY CASE WHEN lower(p.name) = lower(?) THEN 0 ELSE 1 END, p.id DESC LIMIT 10`
    ).bind(auth.user.id, query, query, query).all();
    for (const p of invited.results || []) byId.set(Number(p.id), p);
    const matches = [...byId.values()];
    if (!matches.length) return { ok: false, clarification: `I could not find a project called "${query}" that you can access.` };
    if (matches.length > 1) {
      return { ok: false, clarification: `"${query}" matches more than one accessible project: ${matches.map((p) => `#${p.id} ${p.name}`).join(", ")}. Which one do you mean?` };
    }
    projectId = Number(matches[0].id);
  } else {
    const visible = (await buildVisibleProjectIds(db, auth));
    if (visible.length === 1) projectId = visible[0];
    else if (!visible.length) return { ok: false, clarification: "I could not find any project you can access." };
    else return { ok: false, clarification: "Which project should I report on? Give me its exact name." };
  }

  const report = await callProjectEndpoint(context, projectReportEndpoint, {
    method: "GET",
    path: `/api/projects/report?projectId=${encodeURIComponent(projectId)}`,
  });
  if (!report.ok) return { ok: false, clarification: report.message };
  const project = report.data.project || {};
  const totals = report.data.totals || {};
  return {
    ok: true,
    summary: `${project.name || "That project"} (${project.type || "custom"}, ${project.status || "active"}) has received ${fmt(totals.totalIncome, currency)} in income and recorded ${fmt(totals.totalExpense, currency)} in expenses, leaving a balance of ${fmt(totals.balance, currency)}. Milestones are ${Number(totals.milestonesDone) || 0} of ${Number(totals.milestonesTotal) || 0} done. Its planned budget is ${fmt(project.budget, currency)}.`,
  };
}

async function buildVisibleProjectIds(db, auth) {
  const ids = new Set();
  const own = await db.prepare(`SELECT id FROM projects WHERE business_id = ?`).bind(auth.business.id).all();
  for (const row of own.results || []) ids.add(Number(row.id));
  const invited = await db.prepare(`SELECT project_id AS id FROM project_members WHERE user_id = ?`).bind(auth.user.id).all();
  for (const row of invited.results || []) ids.add(Number(row.id));
  return [...ids];
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
  mark_reminder_done: execMarkReminderDone,
  save_memory: execSaveMemory,
  create_project_plan: execCreateProjectPlan,
  project_add_milestone: execProjectAddMilestone,
  project_complete_milestone: execProjectCompleteMilestone,
  project_record_transaction: execProjectRecordTransaction,
  project_update: execProjectUpdate,
  project_invite: execProjectInvite,
  project_report: execProjectReport,
};

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

function levenshtein(a, b) {
  const m = a.length, n = b.length;
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

// Close-name test for S3/S5: contains, shared first word, singular/plural,
// or a small edit distance. Never across businesses: callers only pass
// names already resolved inside this business.
export function namesSimilar(a, b) {
  const na = String(a || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nb = String(b || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!na || !nb || na === nb) return na === nb;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  const sing = (s) => (s.endsWith("s") ? s.slice(0, -1) : s);
  if (sing(na) === sing(nb)) return true;
  const fa = na.split(" ")[0], fb = nb.split(" ")[0];
  if (fa.length >= 3 && fa === fb) return true;
  if (na.length >= 4 && nb.length >= 4 && levenshtein(na, nb) <= 2) return true;
  return false;
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
        if (p.stock < qty) return stop("Not enough stock for " + p.name + ". You have " + p.stock + " " + p.unit + " left.");
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
          why: "That price is different from the price on this product: you said " + fmtCur(stated) + ", but the product record says " + fmtCur(first.product.price) + " per " + first.product.unit + ", so " + first.qty + " comes to " + fmtCur(total) + ".",
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
                safer: "Use the product record price, " + fmtCur(prod.product.price) + " per " + prod.product.unit + ".",
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
const WRITE_TOOLS = ["record_sale", "add_expense", "add_product", "record_customer_payment", "set_reminder", "save_memory", "send_debtor_message", "mark_reminder_done", ...PROJECT_WRITE_TOOLS];
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

let pendingProposalsEnsured = false;
async function ensurePendingProposals(db) {
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
const CHAT_CONFIRM_WORDS_RE = /^\s*(?:yes|yeah|yep|confirm|confirmed|go ahead|ok|okay|proceed|do it|record it|record that|record am|record this|sure|yes please|correct|that is right|that's right|na so|oya na|i|eh|to|beeni|eeni|o dara|ee)\s*[.!?]*\s*$/;
const CANCEL_RE = /^\s*(?:no|cancel|cancel that|stop|don't|do not|never mind|forget it|leave it|cancel am|no do am|a'a|aa|bari|rara|ko si|mba)\s*[.!?]*\s*$/;

function normalizeIntentText(text) {
  return String(text || "")
    .replace(/[’‘]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function intentMatches(re, text) {
  return re.test(normalizeIntentText(text));
}

async function loadPendingProposalById(db, businessId, sessionKey, proposalId) {
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

async function loadPendingProposal(db, businessId, sessionKey) {
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
async function countProjectActionsToday(db, businessId, day) {
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

async function updateProposalStatus(db, businessId, proposalId, status, resultText) {
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

async function callWriteExecutor(context, db, auth, tool, params, currency, opts) {
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
const ASSISTANT_VOICES = ["ng_female", "ng_male", "default"];
export const ASSISTANT_LANGUAGES = {
  en: "English",
  pcm: "Nigerian Pidgin",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
};
let assistantColumnsEnsured = false;
async function ensureAssistantColumns(db) {
  if (assistantColumnsEnsured) return;
  assistantColumnsEnsured = true;
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_name TEXT`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_voice TEXT NOT NULL DEFAULT 'default'`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_language TEXT NOT NULL DEFAULT 'en'`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
  try {
    await db.prepare(`ALTER TABLE business_chat_settings ADD COLUMN assistant_speech INTEGER NOT NULL DEFAULT 1`).run();
  } catch (e) { /* column already exists, or table not ready yet */ }
}

export async function getAssistantSettings(db, businessId) {
  await ensureAssistantColumns(db);
  try {
    const row = await db.prepare(
      `SELECT assistant_name, assistant_voice, assistant_language, assistant_speech FROM business_chat_settings WHERE business_id = ?`
    ).bind(businessId).first();
    const voice = row && ASSISTANT_VOICES.includes(String(row.assistant_voice || "")) ? String(row.assistant_voice) : "default";
    const language = row && ASSISTANT_LANGUAGES[String(row.assistant_language || "")] ? String(row.assistant_language) : "en";
    const speech = !(row && (row.assistant_speech === 0 || row.assistant_speech === "0" || row.assistant_speech === false));
    return { storedName: String((row && row.assistant_name) || "").trim(), voice, language, speech };
  } catch (e) {
    return { storedName: "", voice: "default", language: "en", speech: true };
  }
}

export async function setAssistantLanguage(db, businessId, language) {
  if (!ASSISTANT_LANGUAGES[language]) return false;
  await ensureAssistantColumns(db);
  try {
    await db.prepare(`INSERT OR IGNORE INTO business_chat_settings (business_id) VALUES (?)`).bind(businessId).run();
  } catch (e) { /* settings row creation is best effort */ }
  try {
    await db.prepare(
      `UPDATE business_chat_settings SET assistant_language = ?, updated_at = datetime('now') WHERE business_id = ?`
    ).bind(language, businessId).run();
  } catch (e) {
    try {
      await db.prepare(`UPDATE business_chat_settings SET assistant_language = ? WHERE business_id = ?`).bind(language, businessId).run();
    } catch (e2) { return false; }
  }
  return true;
}

export async function getAssistantProfile(db, businessId, tier) {
  const paEnabled = tier === "solo" || tier === "pro";
  let settings = { storedName: "", voice: "default", language: "en", speech: true };
  try {
    settings = await getAssistantSettings(db, businessId);
  } catch (e) { /* defaults above stand */ }
  const custom = !!(paEnabled && settings.storedName);
  return {
    name: custom ? settings.storedName : "Kopa",
    custom,
    paEnabled,
    voice: settings.voice,
    language: settings.language || "en",
    speech_enabled: settings.speech !== false,
  };
}

// Localised proposal framing. Only the intro, the closing question and the
// cancelled line are localised; the item lines are the user's own resolved
// data and figures, so they stay exactly as built by the executors.
export const PROPOSAL_TEXT = {
  en: {
    intro: "Here is exactly what I will record:",
    closing: "Tap Confirm to run it, or tap Cancel to drop it. Nothing is recorded yet.",
    cancelled: "Cancelled. Nothing was recorded.",
  },
  pcm: {
    intro: "Na wetin I go record be this:",
    closing: "Tap Confirm to run am. Tap Cancel, and nothing is recorded.",
    cancelled: "Cancelled. I no record anything.",
  },
  ha: {
    intro: "Ga abin da zan rubuta:",
    closing: "Taɓa Confirm don gudanar da shi, ko taɓa Cancel don sokewa. Ba a rubuta komai ba tukuna.",
    cancelled: "Na soke. Ba a rubuta komai ba.",
  },
  yo: {
    intro: "Ohun ti mo ma kọ silẹ ni eyi:",
    closing: "Tẹ Confirm lati ṣiṣẹ rẹ, tabi tẹ Cancel lati fagile rẹ. Ko si ohun ti a kọ silẹ sibẹsibẹ.",
    cancelled: "Mo ti fagile. Ko si ohun ti a kọ silẹ.",
  },
  ig: {
    intro: "Nke a bụ ihe m ga-edekọ:",
    closing: "Pịa Confirm iji mee ya, ma ọ bụ pịa Cancel iji hapụ ya. Edebeghị ihe ọ bụla.",
    cancelled: "Akagbuola. Ọ dịghị ihe edekọrọ.",
  },
};

export const LANGUAGE_SWITCH_REPLIES = {
  en: "Done. I will speak English with you from now on.",
  pcm: "Done. Na Pidgin I go dey speak with you from now.",
  ha: "An gama. Zan ci gaba da magana da kai da Hausa.",
  yo: "O ti pari. Ma a ba ọ sọrọ ni Yoruba lati isinsinyi.",
  ig: "Ọ dị mma. Aga m asụ Igbo gị site ugbu a.",
};

const LANGUAGE_NAME_TO_CODE = {
  "english": "en",
  "pidgin": "pcm",
  "nigerian pidgin": "pcm",
  "hausa": "ha",
  "yoruba": "yo",
  "igbo": "ig",
};
const LANGUAGE_SWITCH_RE = /^\s*(?:please\s+)?(?:speak|switch|talk|use|change)(?:\s+to|\s+in)?\s+(english|nigerian pidgin|pidgin|hausa|yoruba|igbo)\s*[.!?]*\s*$/i;

function detectLanguageSwitch(message) {
  const m = String(message || "").match(LANGUAGE_SWITCH_RE);
  if (!m) return null;
  return LANGUAGE_NAME_TO_CODE[m[1].toLowerCase()] || null;
}

function daysSince(dateText) {
  const t = Date.parse(String(dateText || "").replace(" ", "T") + (String(dateText || "").includes("T") ? "" : "Z"));
  if (!Number.isFinite(t)) return null;
  const diff = Math.floor((Date.now() - t) / 86400000);
  return diff < 0 ? 0 : diff;
}

// PA briefing: deterministic lines from real data only, no model call.
// Note: products has no expiry column anywhere in the schema, so nothing
// about expiring stock is included.
async function buildBriefing(db, auth, snap, currency) {
  const businessId = auth.business.id;
  const L = [];
  L.push("Here is your briefing.");
  // Today and yesterday in the BUSINESS timezone, from the same "now":
  // two disjoint UTC windows, so the two lines can never repeat each
  // other. The old query used SQLite's UTC day (date('now','-1 day')),
  // which is a different day from the business day after midnight WAT
  // and repeated today's figure as yesterday's. If either window query
  // fails, today falls back to the snapshot and yesterday is omitted,
  // so the briefing never loses its today line.
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayWindow = businessDay(tz, now);
  const yesterdayWindow = businessDay(tz, new Date(now.getTime() - 24 * 3600 * 1000));
  let todaySales = { total: Number(snap.salesToday.total) || 0, count: Number(snap.salesToday.count) || 0 };
  let yesterdaySales = null;
  try {
    const t = await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, todayWindow.startUtc, todayWindow.endUtc).first();
    todaySales = { total: Number(t && t.total) || 0, count: Number(t && t.cnt) || 0 };
  } catch (e) {}
  try {
    const y = await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, yesterdayWindow.startUtc, yesterdayWindow.endUtc).first();
    yesterdaySales = { total: Number(y && y.total) || 0, count: Number(y && y.cnt) || 0 };
  } catch (e) {}
  L.push(`Sales today so far: ${fmt(todaySales.total, currency)} across ${todaySales.count} ${todaySales.count === 1 ? "sale" : "sales"}.`);
  if (yesterdaySales) {
    L.push(`Yesterday: ${fmt(yesterdaySales.total, currency)} across ${yesterdaySales.count} ${yesterdaySales.count === 1 ? "sale" : "sales"}.`);
  }
  if (snap.debtors && snap.debtors.length) {
    const owingLines = [];
    for (const d of snap.debtors) {
      let line = `${d.name} owes ${fmt(d.balance, currency)}`;
      try {
        const cust = await db.prepare(`SELECT id FROM customers WHERE business_id = ? AND name = ? LIMIT 1`).bind(businessId, d.name).first();
        if (cust) {
          const oldest = await db.prepare(
            `SELECT MIN(created_at) AS oldest FROM sales WHERE business_id = ? AND customer_id = ? AND balance_due > 0 AND (status IS NULL OR status <> 'voided')`
          ).bind(businessId, cust.id).first();
          const days = oldest && oldest.oldest ? daysSince(oldest.oldest) : null;
          if (days !== null) line += `, oldest unpaid sale ${days} ${days === 1 ? "day" : "days"} ago`;
        }
      } catch (e) {}
      owingLines.push(line);
    }
    L.push("Who is owing: " + owingLines.join("; ") + ".");
  } else {
    L.push("Who is owing: nobody owes money right now.");
  }
  if (snap.lowStock && snap.lowStock.length) {
    L.push("Low stock: " + snap.lowStock.map((p) => `${p.name} (${p.qty} ${p.unit} left)`).join("; ") + ".");
  } else {
    L.push("Low stock: nothing is running low.");
  }
  try {
    const rs = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' AND remind_at <= ? ORDER BY remind_at ASC LIMIT 10`
    ).bind(businessId, toSqliteDate(new Date())).all();
    const due = (rs && rs.results) || [];
    if (due.length) {
      L.push("Reminders due now: " + due.map((r) => `${r.title} (${r.remind_at})`).join("; ") + ".");
    } else {
      L.push("Reminders due now: none.");
    }
  } catch (e) {
    L.push("Reminders due now: none.");
  }
  return L.join("\n");
}

// PA end-of-day summary: deterministic lines from real data only.
// Business-timezone windows (round 5): the old UTC-day queries counted
// the wrong day after midnight WAT, and counted voided sales. "Sales
// today" and the profit line reuse the snapshot's business-day figures;
// expenses, best sellers and new debts query the same window here.
async function buildEodSummary(db, auth, snap, currency) {
  const businessId = auth.business.id;
  const L = [];
  L.push("Here is your end of day summary.");
  L.push(`Sales today: ${fmt(snap.salesToday.total, currency)} across ${snap.salesToday.count} ${snap.salesToday.count === 1 ? "sale" : "sales"}.`);
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayW = businessDay(tz, now);
  const tomorrowDate = businessDay(tz, new Date(now.getTime() + 24 * 3600 * 1000)).date;
  let expensesToday = 0;
  let expensesCount = 0;
  try {
    const e = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses WHERE business_id = ? AND incurred_on >= ? AND incurred_on < ?`
    ).bind(businessId, todayW.date, tomorrowDate).first();
    expensesToday = Number(e && e.total) || 0;
    expensesCount = Number(e && e.cnt) || 0;
  } catch (err) {}
  L.push(`Expenses today: ${fmt(expensesToday, currency)} across ${expensesCount} ${expensesCount === 1 ? "expense" : "expenses"}.`);
  L.push(`Profit today: ${fmt(Math.round((Number(snap.salesToday.total || 0) - expensesToday) * 100) / 100, currency)} (sales minus expenses).`);
  try {
    const rs = await db.prepare(
      `SELECT p.name AS name, COALESCE(SUM(si.quantity),0) AS qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND (s.status IS NULL OR s.status <> 'voided')
       GROUP BY si.product_id ORDER BY qty DESC LIMIT 3`
    ).bind(businessId, todayW.startUtc, todayW.endUtc).all();
    const best = (rs && rs.results) || [];
    if (best.length) {
      L.push("Best sellers today: " + best.map((b) => `${b.name} (${Number(b.qty) || 0} sold)`).join("; ") + ".");
    } else {
      L.push("Best sellers today: no product sales yet today.");
    }
  } catch (err) {
    L.push("Best sellers today: no product sales yet today.");
  }
  try {
    const d = await db.prepare(
      `SELECT COALESCE(SUM(balance_due),0) AS total, COUNT(*) AS cnt FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND balance_due > 0 AND (status IS NULL OR status <> 'voided')`
    ).bind(businessId, todayW.startUtc, todayW.endUtc).first();
    const debtTotal = Number(d && d.total) || 0;
    const debtCount = Number(d && d.cnt) || 0;
    L.push(`New debts today: ${fmt(debtTotal, currency)} across ${debtCount} ${debtCount === 1 ? "sale" : "sales"}.`);
  } catch (err) {}
  return L.join("\n");
}

const REMINDER_STOP_WORDS = new Set(["reminder", "remind", "done", "mark", "marked", "complete", "completed", "finished", "finish", "please", "the", "that", "this", "with", "for", "and", "you", "your", "have", "has", "now", "can", "set", "off", "as", "is", "it", "to", "a", "an", "my", "me"]);
function reminderTitleMatches(title, message) {
  const words = String(title || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !REMINDER_STOP_WORDS.has(w));
  if (!words.length) return false;
  const msg = " " + String(message || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return words.some((w) => msg.includes(" " + w + " ") || msg.includes(" " + w + "s "));
}

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
// Reminder helpers, shared by the deterministic fast path (all tiers)
// and the PA block below. A reminder is never marked done by chat words:
// the owner's words only select it, a proposal is stored, and only a
// Confirm tap on the proposal card marks it done. Nothing is updated here.
// ---------------------------------------------------------------------------
async function listDueReminders(db, businessId) {
  let pendingReminders = [];
  try {
    const rr = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 50`
    ).bind(businessId).all();
    pendingReminders = (rr && rr.results) || [];
  } catch (e) { pendingReminders = []; }
  const nowStr = toSqliteDate(new Date());
  const due = pendingReminders.filter((r) => String(r.remind_at || "") <= nowStr);
  if (!pendingReminders.length) return "No reminders set.";
  if (!due.length) {
    const next = pendingReminders[0];
    return `No reminders are due right now. Next: "${next.title}" at ${next.remind_at}.`;
  }
  return `Reminders due (${due.length}):\n` + due.map((r) => `- ${r.title} (due ${r.remind_at})`).join("\n");
}

async function handleReminderDone(db, auth, businessId, sessionKey, message, currency, proposalText) {
  let pendingReminders = [];
  try {
    const rr = await db.prepare(
      `SELECT id, title, remind_at FROM bot_reminders WHERE business_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 50`
    ).bind(businessId).all();
    pendingReminders = (rr && rr.results) || [];
  } catch (e) { pendingReminders = []; }
  const nowStr = toSqliteDate(new Date());
  const dueReminders = pendingReminders.filter((r) => String(r.remind_at || "") <= nowStr);
  const matched = pendingReminders.filter((r) => reminderTitleMatches(r.title, message));
  let reminderReply = null;
  let target = null;
  if (matched.length === 1) target = matched[0];
  else if (matched.length > 1) {
    reminderReply = "More than one reminder matches that. Which one is done?\n" + matched.map((r) => "- " + r.title).join("\n");
  } else if (dueReminders.length === 1) {
    target = dueReminders[0];
  } else if (dueReminders.length > 1) {
    reminderReply = "These reminders are due. Which one is done?\n" + dueReminders.map((r) => "- " + r.title).join("\n");
  } else {
    reminderReply = "I do not have a due reminder to mark as done.";
  }
  let reminderProposal = null;
  if (target) {
    // Same proposal shape as the ACTION path: supersede any older pending
    // proposal for this session, store this one with a 10-minute expiry,
    // and ask for a Confirm tap. Execution runs only through the confirm
    // tap path, via mark_reminder_done.
    const proposalId = "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const createdAt = new Date();
    const expiresStr = toSqliteDate(new Date(createdAt.getTime() + PROPOSAL_TTL_MS));
    try {
      await ensurePendingProposals(db);
      await db.prepare(
        `UPDATE ai_pending_proposals SET status = 'superseded', resolved_at = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
      ).bind(toSqliteDate(createdAt), businessId, sessionKey).run();
      await db.prepare(
        `INSERT INTO ai_pending_proposals (id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(proposalId, businessId, auth.user.id, sessionKey, "mark_reminder_done", JSON.stringify({ reminder_id: target.id, title: target.title }), `Mark reminder "${target.title}" as done.`, toSqliteDate(createdAt), expiresStr).run();
      reminderProposal = { id: proposalId, tool: "mark_reminder_done", summary: `Mark reminder "${target.title}" as done.`, lines: [`Mark reminder "${target.title}" as done.`], expires_at: expiresStr };
      // One rendering only: the proposal card shows the lines. The reply
      // stays empty so the same proposal is never also pasted as a chat
      // bubble (duplicate-proposal fix, round 2).
      reminderReply = "";
    } catch (e) {
      reminderReply = "I could not prepare that for confirmation just now. Your reminder is untouched. Try again.";
    }
  }
  return { reply: reminderReply, proposal: reminderProposal };
}

// ---------------------------------------------------------------------------
// Main handler.
// ---------------------------------------------------------------------------
export async function runKopaAiChat(context, auth, body) {
  const db = context.env.KOPABOOK_DB;
  try {
    const businessId = auth.business && auth.business.id;
    if (!businessId) return { status: 400, body: { ok: false, message: "Pick a business first." } };
    const currency = auth.business.currency || "NGN";

    // Tiered AI: every plan gets Kopa AI. Staff use the business owner's plan.
    const { tier: rawTier } = await getBusinessOwnerTier(db, businessId);
    const tier = AI_TIER_LIMITS[rawTier] ? rawTier : "free";
    const tierCfg = AI_TIER_LIMITS[tier];

    // The platform owner (Fortune) has no AI limits anywhere in KopaBook:
    // no hourly rate guard, no daily question cap, no daily action cap.
    // Keyed to the server-verified is_platform_admin flag on the signed-in
    // account, never to anything a client can claim. Every other account
    // keeps its tier limits exactly as configured in AI_TIER_LIMITS.
    const isPlatformOwner = !!(auth.user && auth.user.isPlatformAdmin);

    // Assistant identity: a Solo/Pro owner may have named the assistant;
    // everyone else talks to Kopa. Language is stored for every tier.
    const assistant = await getAssistantProfile(db, businessId, tier);
    const proposalText = PROPOSAL_TEXT[assistant.language] || PROPOSAL_TEXT.en;

    // Abuse guard on top of the daily AI cap. The platform owner is exempt.
    if (!isPlatformOwner && !(await checkRateLimit(db, `ai_${auth.user.id}`, 60, 3600000))) {
      return { status: 429, body: { ok: false, message: "Too many questions at once. Slow down a little." } };
    }

    const safeBody = body || {};
    const message = String(safeBody.message || safeBody.question || "").trim().slice(0, 1000);
    // A Confirm tap may carry no message text at all, so it is exempt
    // from the ask-a-question guard. It still runs below, after sessionKey.
    if (!message && !safeBody.confirmProposalId) return { status: 400, body: { ok: false, message: "Ask a question first." } };
    const history = Array.isArray(safeBody.history)
      ? safeBody.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string").slice(-HISTORY_LIMIT)
      : [];
    const sessionKey = safeBody.sessionId ? "s:" + safeBody.sessionId : "u:" + auth.user.id + ":b:" + businessId;

    // Confirm-tap execution path (structured, not a chat word). The
    // frontend proposal card sends { confirmProposalId: "<id>" } when the
    // owner taps Confirm. This is the ONLY path that executes a proposal
    // in this version: a typed "yes" in chat only produces the waiting
    // reply above. If the frontend still sends the word "confirm" as a
    // chat message, it must be wired to this flag before this set ships,
    // or proposals will stay pending. See PUSH-READY-DIFF-V2.md.
    if (typeof safeBody.confirmProposalId === "string" && safeBody.confirmProposalId) {
      const tapProposal = await loadPendingProposalById(db, businessId, sessionKey, safeBody.confirmProposalId);
      if (!tapProposal) {
        return { status: 200, body: { ok: true, reply: "That proposal is no longer waiting. It may have expired after 10 minutes, been cancelled, or already run. Nothing was recorded by this tap.", answer: "That proposal is no longer waiting.", actions_taken: [], fallback: false } };
      }
      const tapDay = new Date().toISOString().slice(0, 10);
      if (tier === "free" && !isPlatformOwner && PROJECT_WRITE_TOOLS.includes(tapProposal.tool)) {
        const usedProjectActions = await countProjectActionsToday(db, businessId, tapDay);
        if (usedProjectActions >= FREE_PROJECT_ACTIONS_PER_DAY) {
          await updateProposalStatus(db, businessId, tapProposal.id, "failed", FREE_PROJECT_CAP_MSG);
          return { status: 200, body: { ok: true, reply: FREE_PROJECT_CAP_MSG, answer: FREE_PROJECT_CAP_MSG, actions_taken: [], fallback: false, capped: true } };
        }
      }
      let tapParams = {};
      try { tapParams = JSON.parse(tapProposal.params || "{}") || {}; } catch (e) { tapParams = {}; }
      // S6 stale debtor balance: the draft was approved against the balance
      // at draft time. If it changed since, stop, show the new balance, and
      // hand out no link. The owner asks for a fresh draft; nothing is sent.
      if (tapProposal.tool === "send_debtor_message" && tapParams._balanceAtDraft !== undefined) {
        const storedBalance = Number(tapParams._balanceAtDraft);
        delete tapParams._balanceAtDraft;
        const tapMatches = await matchCustomer(db, businessId, tapParams.customer_name || tapParams.customerName || "");
        if (tapMatches.length === 1 && debtorBalanceChanged(storedBalance, tapMatches[0].balance)) {
          const staleReply = "That balance changed since the draft: it was " + fmt(storedBalance, currency) + ", and now it is " + fmt(tapMatches[0].balance, currency) + ". I have not sent anything. Ask me to draft it again and I will draft it with the new balance.";
          await updateProposalStatus(db, businessId, tapProposal.id, "stale", staleReply);
          return { status: 200, body: { ok: true, reply: sanitizeTone(staleReply), answer: sanitizeTone(staleReply), actions_taken: [], fallback: false } };
        }
      } else if (tapParams._balanceAtDraft !== undefined) {
        delete tapParams._balanceAtDraft;
      }
      let tapResult;
      try {
        if (!WRITE_TOOLS.includes(tapProposal.tool) || !TOOL_EXECUTORS[tapProposal.tool]) throw new Error("unknown proposal tool");
        tapResult = await callWriteExecutor(context, db, auth, tapProposal.tool, tapParams, currency);
      } catch (e) {
        tapResult = { ok: false, clarification: "Something went wrong while doing that. Your data is untouched. Try again." };
      }
      if (!tapResult || tapResult.clarification || !tapResult.ok) {
        const tapFail = (tapResult && tapResult.clarification) || "Something went wrong while doing that. Your data is untouched. Try again.";
        await updateProposalStatus(db, businessId, tapProposal.id, "failed", tapFail);
        return { status: 200, body: { ok: true, reply: tapFail, answer: tapFail, actions_taken: [], fallback: false } };
      }
      await updateProposalStatus(db, businessId, tapProposal.id, "executed", tapResult.summary);
      // Count the executed action here, inline: this path runs before the
      // bumpActions helper below is defined, and the SQL is identical to it.
      try {
        await db.prepare(
          `INSERT INTO ai_usage (business_id, day, count, actions) VALUES (?, ?, 0, 1)
           ON CONFLICT(business_id, day) DO UPDATE SET actions = actions + 1`
        ).bind(String(businessId), tapDay).run();
      } catch (e) { /* action counting must never break execution */ }
      try { await audit(context, auth, "ai.proposal.execute", "ai_pending_proposal", tapProposal.id, { tool: tapProposal.tool }); } catch (e) { /* audit must never break execution */ }
      // Debtor send: the WhatsApp link is the result, not a generated
      // confirmation. The owner taps the link; Kopa never sends it.
      if (tapProposal.tool === "send_debtor_message" && tapResult.waLink) {
        const tapWaReply = `${tapResult.summary}\n\nTap to send on WhatsApp:\n${tapResult.waLink}`;
        return { status: 200, body: { ok: true, reply: sanitizeTone(tapWaReply), answer: sanitizeTone(tapWaReply), actions_taken: [{ tool: tapProposal.tool, summary: tapResult.summary }], waLink: tapResult.waLink, fallback: false } };
      }
      return { status: 200, body: { ok: true, reply: sanitizeTone("Done. " + tapResult.summary), answer: sanitizeTone("Done. " + tapResult.summary), actions_taken: [{ tool: tapProposal.tool, summary: tapResult.summary }], fallback: false } };
    }

    // Daily counters (per business per UTC day). bumpActions lives here
    // for non-proposal action execution below; the confirm tap path above
    // counts its executed action inline with the same SQL.
    const day = new Date().toISOString().slice(0, 10);
    const bumpActions = async () => {
      await db.prepare(
        `INSERT INTO ai_usage (business_id, day, count, actions) VALUES (?, ?, 0, 1)
         ON CONFLICT(business_id, day) DO UPDATE SET actions = actions + 1`
      ).bind(String(businessId), day).run().catch(() => {});
    };

    // ---- Early intents -----------------------------------------------------
    // Clear chat, language switch, and cancel of a pending
    // proposal run BEFORE the daily question cap and BEFORE the question is
    // counted: none of them may consume a question or be blocked by the cap.
    // Clear chat (round 5): asking to clear only ASKS, once, in plain
    // words. The words never clear anything on their own: the question
    // is stored as a pending warning (kind "clear_chat") and only a
    // bare Yes after it executes the clear, in the warning resolver
    // below. That is the 2026-10-20 order (clear after one quick
    // confirmation), which the old immediate clear never kept: it
    // cleared on the words with no confirmation, and its anchored
    // phrase list missed "clear old chat" and "clearly old chat"
    // entirely, so those fell to the model and failed.
    const executeClearChat = async () => {
      await ensurePendingProposals(db);
      try {
        await db.prepare(
          `UPDATE ai_pending_proposals SET status = 'cancelled', resolved_at = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
        ).bind(toSqliteDate(new Date()), businessId, sessionKey).run();
      } catch (e) { /* cancelling proposals is best effort here */ }
      if (safeBody.sessionId) {
        let sess = null;
        try {
          sess = await db.prepare(`SELECT needs_human, handled_by FROM chat_sessions WHERE id = ?`).bind(safeBody.sessionId).first();
        } catch (e) { sess = null; }
        // Block only when a person is genuinely on the chat: the session is
        // human-handled, or a team member has actually posted in it. A bare
        // needs_human flag is not enough (ordinary words on the AI side, like
        // "Cancel" for a proposal, can set that flag with no human present).
        let humanPresent = !!(sess && sess.handled_by === "human");
        if (!humanPresent && sess) {
          try {
            const agentMsg = await db.prepare(
              `SELECT id FROM chat_messages WHERE session_id = ? AND sender = 'agent' LIMIT 1`
            ).bind(safeBody.sessionId).first();
            humanPresent = !!agentMsg;
          } catch (e) { /* if we cannot tell, allow the clear */ }
        }
        if (humanPresent) {
          const blockedReply = "I cannot clear this chat while a person from the KopaBook team is on it. End the support conversation first, or ask them to close it, and then I can clear it.";
          return { status: 200, body: { ok: true, reply: blockedReply, answer: blockedReply, actions_taken: [], fallback: false } };
        }
      }
      try {
        await audit(context, auth, "ai.chat.clear", "chat", safeBody.sessionId || null, { session_key: sessionKey });
      } catch (e) { /* audit must never break the clear */ }
      // clear_chat: true tells send.js to wipe this session's thread
      // (DELETE FROM chat_messages WHERE session_id = ?) and the
      // frontend to clear the visible bubbles. Support case tables are
      // separate and are never touched by this clear.
      return { status: 200, body: { ok: true, reply: CLEAR_CHAT_DONE, answer: CLEAR_CHAT_DONE, actions_taken: [], fallback: false, clear_chat: true } };
    };
    const askClearChatQuestion = async () => {
      await storePendingWarning(db, {
        businessId, userId: auth.user.id, sessionKey, tool: "clear_chat",
        params: {}, summary: "Clear the old chat", lines: [],
        kind: "clear_chat", question: CLEAR_CHAT_QUESTION, candidates: [],
        saferAction: { action: "reply", reply: CLEAR_CHAT_DECLINED },
      });
      return { status: 200, body: { ok: true, reply: CLEAR_CHAT_QUESTION, answer: CLEAR_CHAT_QUESTION, actions_taken: [], fallback: false } };
    };
    if (isClearChatRequest(message)) {
      return await askClearChatQuestion();
    }

    // Language switch: an explicit settings instruction from the owner, so
    // it executes directly and is confirmed in the new language.
    const switchTo = detectLanguageSwitch(message);
    if (switchTo) {
      await setAssistantLanguage(db, businessId, switchTo);
      assistant.language = switchTo;
      const langReply = LANGUAGE_SWITCH_REPLIES[switchTo] || LANGUAGE_SWITCH_REPLIES.en;
      return { status: 200, body: { ok: true, reply: langReply, answer: langReply, actions_taken: [], fallback: false } };
    }

    // Guardrail refusals, before the question cap (like clear and language
    // switch): the agent has no tool for plan, price, billing, or staff
    // changes, and no instruction may remove a hard gate.
    const outOfScope = outOfScopeRefusal(message);
    if (outOfScope) {
      return { status: 200, body: { ok: true, reply: sanitizeTone(outOfScope), answer: sanitizeTone(outOfScope), actions_taken: [], fallback: false } };
    }
    const gateRefusal = instructionGateRefusal(message);
    if (gateRefusal) {
      return { status: 200, body: { ok: true, reply: sanitizeTone(gateRefusal), answer: sanitizeTone(gateRefusal), actions_taken: [], fallback: false } };
    }
    let oneOffInstruction = null;

    // A pending warning is the latest question the AI asked, so it is
    // answered before any older pending proposal: a bare "Yes" with both
    // pending answers the warning (round 5 capstone), not the proposal.
    // The proposal block below only runs when no warning is pending;
    // the warning block after it answers the warning first.
    const pendingWarning = await loadPendingWarning(db, businessId, sessionKey);
    const pendingProposal = await loadPendingProposal(db, businessId, sessionKey);
    if (pendingProposal && !pendingWarning) {
      // Confirm-tap-only: chat words never execute a proposal. A bare
      // "yes" (or its Pidgin, Hausa, Yoruba, or Igbo equivalent) only
      // produces this waiting reply. The proposal stays pending, nothing
      // is recorded, and no action is counted. Execution happens only
      // when the owner taps Confirm on the proposal card, which runs the
      // separate confirm path: free project-action bucket re-checked,
      // then callWriteExecutor, then the proposal is marked executed.
      if (intentMatches(CHAT_CONFIRM_WORDS_RE, message)) {
        const waitingReply = `That action is still waiting for your confirmation. Tap Confirm on its card to run it, or tap Cancel on the card to drop it. Nothing is recorded yet. Waiting: ${pendingProposal.summary}`;
        return { status: 200, body: { ok: true, reply: waitingReply, answer: waitingReply, actions_taken: [], fallback: false, proposal: pendingProposal } };
      }
      if (intentMatches(CANCEL_RE, message)) {
        await updateProposalStatus(db, businessId, pendingProposal.id, "cancelled");
        try {
          await audit(context, auth, "ai.proposal.cancel", "ai_pending_proposal", pendingProposal.id, { tool: pendingProposal.tool });
        } catch (e) { /* audit must never break the cancel */ }
        const cancelReply = proposalText.cancelled;
        return { status: 200, body: { ok: true, reply: cancelReply, answer: cancelReply, actions_taken: [], fallback: false } };
      }
      // Any other message: the proposal stays pending and the normal flow runs.
    }

    // Pending-warning resolution, before the question cap: answering a
    // warning question never consumes a question and never executes
    // anything. A safer/original answer drafts a proposal (still needing
    // a Confirm tap); a name answer drops the warning and falls through
    // so the normal flow re-emits with the exact name; any other message
    // supersedes the warning and falls through as a new request.
    if (pendingWarning) {
      let wParams = {};
      let wSafer = { action: "proposal" };
      let wCandidates = [];
      try { wParams = JSON.parse(pendingWarning.params || "{}") || {}; } catch (e) { wParams = {}; }
      try { wSafer = JSON.parse(pendingWarning.safer_action || "{}") || { action: "proposal" }; } catch (e) { wSafer = { action: "proposal" }; }
      try { wCandidates = JSON.parse(pendingWarning.candidates || "[]") || []; } catch (e) { wCandidates = []; }
      const normMsg = normalizeIntentText(message);
      const candidateHit = wCandidates.find((c) => normalizeIntentText(c) === normMsg);
      // Round 5: the warning answer is read before the cancel words, so
      // a bare "No" to a warning answers the warning (kind-aware reply)
      // instead of falling into the generic cancel branch below. A bare
      // "Yes" is likewise a warning answer, not a cancel. This only
      // runs while a warning is actually pending.
      const warnAnswer = parseWarningAnswer(message);
      if (warnAnswer === "drop") {
        // A bare No (or "drop it" / "never mind") to a warning cancels
        // it with one plain line. Nothing is drafted and nothing is
        // recorded. For a duplicate warning the stored safer reply
        // names the first sale that still stands. A co-pending
        // proposal is cancelled too: one No ends the whole thread.
        await clearPendingWarnings(db, businessId, sessionKey, "cancelled");
        if (pendingProposal) {
          await updateProposalStatus(db, businessId, pendingProposal.id, "cancelled");
        }
        const dropReply = (wSafer && wSafer.action === "reply" && wSafer.reply)
          ? wSafer.reply
          : "Understood. I cancelled that. Nothing was recorded.";
        return { status: 200, body: { ok: true, reply: dropReply, answer: dropReply, actions_taken: [], fallback: false } };
      } else if (intentMatches(CANCEL_RE, message)) {
        await clearPendingWarnings(db, businessId, sessionKey, "cancelled");
        // A co-pending proposal is cancelled too: one "Cancel" ends the
        // whole pending thread, it never leaves an older proposal waiting.
        if (pendingProposal) {
          await updateProposalStatus(db, businessId, pendingProposal.id, "cancelled");
        }
        const warnCancelReply = proposalText.cancelled;
        return { status: 200, body: { ok: true, reply: warnCancelReply, answer: warnCancelReply, actions_taken: [], fallback: false } };
      } else if (candidateHit) {
        await clearPendingWarnings(db, businessId, sessionKey, "superseded");
        // Fall through: the normal flow below re-emits with the exact name.
      } else {
        if (pendingWarning.kind === "clear_chat") {
          // A bare Yes (or "yes, clear it" and the like) after the one
          // clear question executes the clear. A No is already handled
          // by the drop branch above, using the stored declined reply.
          // Any other message supersedes the question and falls
          // through as a new request.
          const clearYes = warnAnswer === "original" || /^\s*yes\b/.test(normMsg);
          if (clearYes) {
            await clearPendingWarnings(db, businessId, sessionKey, "answered");
            return await executeClearChat();
          }
          await clearPendingWarnings(db, businessId, sessionKey, "superseded");
          // Fall through: a new, unrelated request replaces the question.
        } else if (warnAnswer === "once" && pendingWarning.kind === "instruction_conflict") {
          await clearPendingWarnings(db, businessId, sessionKey, "answered");
          oneOffInstruction = wParams.value || wParams.fact || "";
          // Fall through: the one-off instruction is appended to the
          // memory section for this next action only, and the standing
          // instruction is left unchanged.
        } else if (warnAnswer === "replace" && pendingWarning.kind === "instruction_conflict") {
          await clearPendingWarnings(db, businessId, sessionKey, "answered");
          const replaceProposal = await createAiProposal(db, businessId, auth.user.id, sessionKey, "save_memory", wParams, pendingWarning.summary, [pendingWarning.summary]);
          try { await audit(context, auth, "ai.proposal.create", "ai_pending_proposal", replaceProposal.id, { tool: "save_memory", supersedes: pendingWarning.summary }); } catch (e) { /* audit must never break the proposal */ }
          // One rendering only: the proposal card carries the lines; the
          // reply stays empty (duplicate-proposal fix, round 2).
          return { status: 200, body: { ok: true, reply: "", answer: "", actions_taken: [], fallback: false, proposal: replaceProposal } };
        } else if (warnAnswer === "safer" || warnAnswer === "original") {
          await clearPendingWarnings(db, businessId, sessionKey, "answered");
          if (warnAnswer === "original" && pendingWarning.kind === "memory_price") {
            const memPriceReply = "I record sales at the product record price, so I cannot record it at the saved price. Update the product price first, or confirm the record price and I will draft it for your Confirm tap.";
            return { status: 200, body: { ok: true, reply: memPriceReply, answer: memPriceReply, actions_taken: [], fallback: false } };
          }
          if (warnAnswer === "safer" && wSafer.action === "reply") {
            const saferReply = wSafer.reply || "Understood. I have not recorded anything yet.";
            return { status: 200, body: { ok: true, reply: saferReply, answer: saferReply, actions_taken: [], fallback: false } };
          }
          const chosenParams = warnAnswer === "safer" ? (wSafer.params || wParams) : wParams;
          const chosenSummary = warnAnswer === "safer" ? (wSafer.summary || pendingWarning.summary) : pendingWarning.summary;
          const chosenLines = warnAnswer === "safer" ? (wSafer.lines || []) : (() => { try { return JSON.parse(pendingWarning.lines || "[]"); } catch (e) { return [pendingWarning.summary]; } })();
          const chosenProposal = await createAiProposal(db, businessId, auth.user.id, sessionKey, pendingWarning.tool, chosenParams, chosenSummary, chosenLines);
          try { await audit(context, auth, "ai.proposal.create", "ai_pending_proposal", chosenProposal.id, { tool: pendingWarning.tool, warning_kind: pendingWarning.kind, warning_answer: warnAnswer }); } catch (e) { /* audit must never break the proposal */ }
          // One rendering only: the proposal card carries the lines; the
          // reply stays empty (duplicate-proposal fix, round 2).
          return { status: 200, body: { ok: true, reply: "", answer: "", actions_taken: [], fallback: false, proposal: chosenProposal } };
        } else {
          await clearPendingWarnings(db, businessId, sessionKey, "superseded");
          // Fall through: a new, unrelated request replaces the warning.
        }
      }
    }

    // Daily question cap for this tier (per business per UTC day).
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
    if (!isPlatformOwner && usedToday >= tierCfg.questionsPerDay) {
      const capMsg = `You have used today's Kopa AI limit (${tierCfg.questionsPerDay} questions on your plan). It resets tomorrow, and your data is untouched.` + (tier === "free" ? ` ${UPGRADE_NUDGE}` : "");
      return { status: 200, body: {
        ok: true,
        reply: capMsg,
        answer: capMsg,
        actions_taken: [],
        fallback: true,
        capped: true,
        usage: { used_today: usedToday, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay },
      } };
    }

    // Rich live snapshot, injected into every request.
    const snap = await buildSnapshot(db, auth);

    // Count the question before the AI call so failures still respect the cap.
    await db.prepare(
      `INSERT INTO ai_usage (business_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT(business_id, day) DO UPDATE SET count = count + 1`
    ).bind(String(businessId), day).run();
    const newUsed = usedToday + 1;
    const countedUsage = { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay };

    // Deterministic fast path (all tiers, no model call). Common intents
    // are answered from the live snapshot, or turned into an ACTION that
    // flows through the same dry-run / guardrail / proposal dispatch
    // below, so tier, role, cap and guardrail checks still apply and a
    // Confirm tap is still required before anything is recorded. Read
    // intents work on every plan, including Free. The PA block below is
    // now the fallback for Solo/Pro when the fast path does not match.
    let fastPathAction = null;
    const fastPath = resolveFastPath(message, history, snap, currency);
    if (fastPath) {
      if (fastPath.kind === "reply") {
        return { status: 200, body: { ok: true, reply: fastPath.text, answer: fastPath.text, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      if (fastPath.kind === "briefing") {
        const briefing = await buildBriefing(db, auth, snap, currency);
        return { status: 200, body: { ok: true, reply: briefing, answer: briefing, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      if (fastPath.kind === "eod") {
        const eod = await buildEodSummary(db, auth, snap, currency);
        return { status: 200, body: { ok: true, reply: eod, answer: eod, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      if (fastPath.kind === "reminders") {
        const reminderText = await listDueReminders(db, businessId);
        return { status: 200, body: { ok: true, reply: reminderText, answer: reminderText, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      if (fastPath.kind === "reminder_done") {
        const done = await handleReminderDone(db, auth, businessId, sessionKey, message, currency, proposalText);
        return { status: 200, body: { ok: true, reply: done.reply, answer: done.reply, actions_taken: [], fallback: false, usage: countedUsage, proposal: done.proposal } };
      }
      if (fastPath.kind === "activitylog") {
        // Round 5: staff login/logout activity. No login/logout times
        // are recorded anywhere yet (no source table, no audit rows),
        // so every scope gets the honest no-data answer, never a
        // customer lookup and never invented times. When the
        // staff-activity build lands (migration 0063,
        // staff_activity_events), replace this with a real read.
        return { status: 200, body: { ok: true, reply: STAFF_ACTIVITY_NO_DATA, answer: STAFF_ACTIVITY_NO_DATA, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      if (fastPath.kind === "clearchat_question") {
        // Normally unreachable: the early-intents branch above asks
        // the question before the cap. This is the backstop so a
        // clear request that reaches the fast path never falls to
        // the model and never clears on the words alone.
        return await askClearChatQuestion();
      }
      // kind === "action": fall through with a synthetic ACTION line, so
      // the existing parseAction + dispatch below runs unchanged and no
      // model call is made for it. Any other kind must NOT reach the
      // ACTION render (it would print "ACTION: {}"); it falls through
      // to the backstops and the model instead.
      if (fastPath.kind === "action") fastPathAction = fastPath;
    }

    // PA deterministic intents (Solo and Pro only). These run in the normal
    // counted flow, after the question is counted and before any model
    // call, and they are built from real data only. The deterministic texts
    // stay in English in a figures-first format for precision.
    if (assistant.paEnabled) {
      const lowerMsg = message.toLowerCase().replace(/’/g, "'");
      const BRIEFING_PHRASES = ["brief me", "briefing", "morning briefing", "daily briefing"];
      if (BRIEFING_PHRASES.some((p) => lowerMsg.includes(p))) {
        const briefing = await buildBriefing(db, auth, snap, currency);
        return { status: 200, body: { ok: true, reply: briefing, answer: briefing, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      const EOD_PHRASES = ["end of day", "day summary", "today's summary", "how did we do today", "close of day"];
      if (EOD_PHRASES.some((p) => lowerMsg.includes(p))) {
        const eod = await buildEodSummary(db, auth, snap, currency);
        return { status: 200, body: { ok: true, reply: eod, answer: eod, actions_taken: [], fallback: false, usage: countedUsage } };
      }
      // Reminder done: the shared helper builds the proposal (all
      // tiers). The fast path above already handled this intent; this
      // branch is the fallback for Solo/Pro when it did not match.
      if (/reminder/i.test(message) && /(done|mark|complete|finished)/i.test(message)) {
        const done = await handleReminderDone(db, auth, businessId, sessionKey, message, currency, proposalText);
        return { status: 200, body: { ok: true, reply: done.reply, answer: done.reply, actions_taken: [], fallback: false, usage: countedUsage, proposal: done.proposal } };
      }
    }

    // Staff login/logout activity (round 5): the business records no
    // login/logout times anywhere, so these questions are answered here
    // from the honest no-data text, never by the model (which would
    // invent times or fail). The fast path owns the "log activity"
    // routing above; this is the backstop for when it does not match.
    // It runs after the fast path so a fast-path answer still wins.
    if (!fastPathAction) {
      const staffActivity = staffActivityAnswer(message);
      if (staffActivity) {
        return { status: 200, body: { ok: true, reply: staffActivity, answer: staffActivity, actions_taken: [], fallback: false, usage: countedUsage } };
      }
    }

    // Long-term memory: up to 10 remembered facts for this business.
    let memorySection = "";
    try {
      const mrows = await db.prepare(
        `SELECT memory_key, memory_value FROM ai_memory WHERE business_id = ? ORDER BY updated_at DESC LIMIT 10`
      ).bind(businessId).all();
      const mems = ((mrows && mrows.results) || []).filter((r) => r && r.memory_value);
      if (mems.length) {
        memorySection = "What you remember about this business:\n" + mems.map((r) => `- ${r.memory_key}: ${r.memory_value}`).join("\n");
      }
    } catch (e) { /* ai_memory table not migrated yet; skip silently */ }

    if (oneOffInstruction) {
      memorySection = (memorySection ? memorySection + "\n" : "") + "One-off instruction for this next action only (it does not replace any standing instruction): " + oneOffInstruction;
    }

    const sys = systemPrompt(snap, currency, tier, memorySection, assistant);

    // Graceful degradation: the app must never break because AI is down.
    // A failed model call says so in one line. The full business snapshot
    // is never pasted into chat as a reply.
    let modelText;
    if (fastPathAction) {
      modelText = "ACTION: " + JSON.stringify({ tool: fastPathAction.tool, params: fastPathAction.params });
    } else if (!aiProviderAvailable(context.env)) {
      const reply = MODEL_UNAVAILABLE_LINE;
      return { status: 200, body: { ok: true, reply, answer: reply, actions_taken: [], fallback: true, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay } } };
    } else {
      try {
        const messages = [{ role: "system", content: sys }];
        for (const h of history.slice(-8)) messages.push({ role: h.role, content: h.content.slice(0, 500) });
        messages.push({ role: "user", content: message });
        modelText = await generateText(context.env, messages);
      } catch (e) {
        const reply = MODEL_UNAVAILABLE_LINE;
        return { status: 200, body: { ok: true, reply, answer: reply, actions_taken: [], fallback: true, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay } } };
      }
    }

    // Agentic path: the model asked to DO something.
    const action = parseAction(modelText);
    const actionsTaken = [];
    if (action && !action.parseError) {
      const usageObj = () => ({ used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay });
      if (!TOOL_EXECUTORS[action.tool]) {
        return { status: 200, body: {
          ok: true, reply: `I understood you want me to do something, but "${action.tool}" is not something I can do. Try asking me to record a sale, add an expense, or draft a debtor reminder.`,
          answer: `I understood you want me to do something, but "${action.tool}" is not something I can do.`,
          actions_taken: [], fallback: false, usage: usageObj(),
        } };
      }
      // Tier check first: Free is read-only EXCEPT project writes (their
      // own bucket, checked below); Starter has a small tool set.
      if (!tierAllowsTool(tier, action.tool)) {
        const tierMsg = tier === "free"
          ? `I can answer questions about your business on your Free plan, but doing things like that needs an upgrade. ${UPGRADE_NUDGE}`
          : `Your ${tier[0].toUpperCase() + tier.slice(1)} plan does not include "${action.tool}". Upgrade to Solo or Pro for the full AI assistant.`;
        return { status: 200, body: { ok: true, reply: tierMsg, answer: tierMsg, actions_taken: [], fallback: false, usage: usageObj() } };
      }
      if (!toolAllowed(auth, action.tool)) {
        return { status: 200, body: {
          ok: true,
          reply: "Your staff role does not allow that action. You can record sales and check customer balances; everything else needs the owner or an admin.",
          answer: "Your staff role does not allow that action.",
          actions_taken: [], fallback: false, usage: usageObj(),
        } };
      }
      // Per-day action caps. Project writes on Free use their OWN bucket:
      // 5 executed project actions per business per day, counted on
      // execution only, so once the bucket is full no new proposal is
      // created. Every other capped tier (Starter) keeps the shared
      // ai_usage action counter exactly as before, project actions
      // included. Read-only project reports consume no action anywhere.
      if (PROJECT_WRITE_TOOLS.includes(action.tool) && tier === "free" && !isPlatformOwner) {
        const usedProjectActions = await countProjectActionsToday(db, businessId, day);
        if (usedProjectActions >= FREE_PROJECT_ACTIONS_PER_DAY) {
          return { status: 200, body: { ok: true, reply: FREE_PROJECT_CAP_MSG, answer: FREE_PROJECT_CAP_MSG, actions_taken: [], fallback: false, capped: true, usage: usageObj() } };
        }
      } else if (action.tool !== "project_report" && !isPlatformOwner && tierCfg.actionsPerDay !== null && tierCfg.actionsPerDay !== undefined && actionsToday >= tierCfg.actionsPerDay) {
        const capMsg = `You have used today's AI action limit (${tierCfg.actionsPerDay} actions on Starter). It resets tomorrow. Upgrade to Solo or Pro for more.`;
        return { status: 200, body: { ok: true, reply: capMsg, answer: capMsg, actions_taken: [], fallback: false, capped: true, usage: usageObj() } };
      }
      const isWriteTool = WRITE_TOOLS.includes(action.tool);
      let result;
      try {
        const exec = TOOL_EXECUTORS[action.tool];
        // Write tools run in dry-run mode first: they validate everything
        // and return an exact proposal, and nothing is recorded yet.
        // send_debtor_message has a different signature (db first) and its
        // dry-run validates the draft against chat history, without
        // logging an action or handing out a WhatsApp link yet.
        result = isWriteTool && action.tool === "send_debtor_message"
          ? await exec(db, auth, action.params, currency, history, { dryRun: true, userMessage: message, skipDraftCheck: !!(action.params && action.params._fastpathDraft) })
          : isWriteTool
            ? await exec(context, db, auth, action.params, currency, { dryRun: true, userMessage: message })
            : action.tool === "draft_debtor_message"
              ? await exec(context.env, db, auth, action.params, currency)
              : await exec(context, db, auth, action.params, currency);
      } catch (e) {
        result = { ok: false, clarification: "Something went wrong while doing that. Your data is untouched. Try again." };
      }
      if (result.clarification) {
        // Never execute on ambiguity. Ask the user, conversationally.
        return { status: 200, body: {
          ok: true, reply: sanitizeTone(result.clarification), answer: sanitizeTone(result.clarification),
          actions_taken: [], fallback: false, usage: usageObj(),
        } };
      }
      // Guardrails, after the dry-run validates and before any proposal is
      // stored: hard stops ask one short question, soft warnings warn
      // first in the exact 5-part shape, instruction conflicts ask which
      // wins. Tier and role gates already ran above, before the dry-run.
      if (isWriteTool && result.proposal) {
        const gate = await runGuardrailChecks(db, auth, action.tool, action.params, result.proposal, message, currency, { sessionKey });
        if (gate.stop) {
          return { status: 200, body: {
            ok: true, reply: sanitizeTone(gate.stop), answer: sanitizeTone(gate.stop),
            actions_taken: [], fallback: false, usage: usageObj(),
          } };
        }
        if (gate.conflict) {
          const conflictWarning = await storePendingWarning(db, {
            businessId, userId: auth.user.id, sessionKey, tool: "save_memory",
            params: { key: gate.conflict.key, value: gate.conflict.newValue },
            summary: "Remember " + gate.conflict.key + ": " + gate.conflict.newValue,
            lines: ["Remember " + gate.conflict.key + ": " + gate.conflict.newValue],
            kind: "instruction_conflict", question: gate.conflict.question, candidates: [],
            saferAction: { action: "reply", reply: "" },
          });
          void conflictWarning;
          return { status: 200, body: {
            ok: true, reply: sanitizeTone(gate.conflict.question), answer: sanitizeTone(gate.conflict.question),
            actions_taken: [], fallback: false, usage: usageObj(),
          } };
        }
        if (gate.warning) {
          const w = gate.warning;
          await storePendingWarning(db, {
            businessId, userId: auth.user.id, sessionKey, tool: action.tool,
            params: action.params, summary: result.proposal.summary, lines: result.proposal.lines,
            kind: w.kind, question: w.question, candidates: w.candidates || [],
            saferAction: w.saferAction || { action: "proposal", params: action.params, summary: result.proposal.summary, lines: result.proposal.lines },
          });
          const warningReply = formatWarning({ asked: w.asked, why: w.why, change: w.change, safer: w.safer, question: w.question });
          return { status: 200, body: {
            ok: true, reply: sanitizeTone(warningReply), answer: sanitizeTone(warningReply),
            actions_taken: [], fallback: false, usage: usageObj(),
          } };
        }
      }
      if (action.tool === "project_report") {
        // A read-only report is returned exactly as the Projects endpoint
        // calculated it. It is not an AI action, so actions are not bumped.
        return { status: 200, body: {
          ok: true, reply: result.summary, answer: result.summary,
          actions_taken: [], fallback: false, usage: usageObj(),
        } };
      }
      if (isWriteTool && result.proposal) {
        // Store the proposal and ask for confirmation. Actions are counted
        // on execution, never on proposal, so no bumpActions here.
        await ensurePendingProposals(db);
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + PROPOSAL_TTL_MS);
        const proposalId = "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const expiresStr = toSqliteDate(expiresAt);
        try {
          await db.prepare(
            `UPDATE ai_pending_proposals SET status = 'superseded', resolved_at = ? WHERE business_id = ? AND session_key = ? AND status = 'pending'`
          ).bind(toSqliteDate(createdAt), businessId, sessionKey).run();
          let storedParams = action.params || {};
          // The fast-path marker is a dispatch hint only: the proposal the
          // Confirm tap executes must carry clean params, exactly as the
          // model path stores them. The proposal card itself is the
          // approval for a fast-path draft; the executor's draft check is
          // unchanged for every other action.
          if (storedParams._fastpathDraft !== undefined) {
            storedParams = { ...storedParams };
            delete storedParams._fastpathDraft;
          }
          if (action.tool === "send_debtor_message") {
            try {
              const draftMatches = await matchCustomer(db, businessId, action.params.customer_name || action.params.customerName || "");
              if (draftMatches.length === 1) storedParams = { ...storedParams, _balanceAtDraft: draftMatches[0].balance };
            } catch (e) { /* no baseline: the tap path then skips the stale check */ }
          }
          await db.prepare(
            `INSERT INTO ai_pending_proposals (id, business_id, user_id, session_key, tool, params, summary, status, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
          ).bind(proposalId, businessId, auth.user.id, sessionKey, action.tool, JSON.stringify(storedParams), result.proposal.summary, toSqliteDate(createdAt), expiresStr).run();
        } catch (e) {
          return { status: 200, body: {
            ok: true, reply: "I could not prepare that for confirmation just now. Your data is untouched. Try again.", answer: "I could not prepare that for confirmation just now. Your data is untouched. Try again.",
            actions_taken: [], fallback: false, usage: usageObj(),
          } };
        }
        try {
          await audit(context, auth, "ai.proposal.create", "ai_pending_proposal", proposalId, { tool: action.tool });
        } catch (e) { /* audit must never break the proposal */ }
        // One rendering only: the proposal card shows the lines. The reply
        // and answer stay empty so the same proposal is never also pasted
        // as a chat bubble (duplicate-proposal fix, round 2). The waiting
        // reply above is untouched: it is a waiting message, not the
        // proposal text, and its card is deduped by id.
        return { status: 200, body: {
          ok: true, reply: "", answer: "", actions_taken: [], fallback: false,
          proposal: { id: proposalId, tool: action.tool, summary: result.proposal.summary, lines: result.proposal.lines, expires_at: expiresStr },
          usage: usageObj(),
        } };
      }
      await bumpActions();
      actionsTaken.push({ tool: action.tool, summary: result.summary, waLink: result.waLink || null });

      // Drafts are returned as-is for review (with a send prompt for Solo/Pro).
      if (result.isDraft) {
        const draftReply = `${result.draft}\n\nShall I send this?`;
        return { status: 200, body: {
          ok: true, reply: draftReply, answer: draftReply, actions_taken: actionsTaken,
          draft: result.draft, fallback: false, usage: usageObj(),
        } };
      }
      // WhatsApp send links ride along on the confirmation.
      if (result.waLink) {
        const waReply = `${result.summary}\n\nTap to send on WhatsApp:\n${result.waLink}`;
        return { status: 200, body: {
          ok: true, reply: waReply, answer: waReply, actions_taken: actionsTaken,
          waLink: result.waLink, fallback: false, usage: usageObj(),
        } };
      }

      // Confirmation in Kopa's voice, with real numbers. Capped at 8s:
      // the action already ran, so a slow model must never hold up the
      // answer. On timeout or failure the plain summary is used.
      let reply;
      try {
        const generated = await Promise.race([
          generateText(context.env, [
            { role: "system", content: `You are ${assistant.name}, the warm, plain KopaBook business assistant for Nigerian shop owners. The user asked you to do something and you just did it. Write a short, natural confirmation (2-3 sentences max) using ONLY the facts given. Never add numbers that are not in the facts.` },
            { role: "user", content: `User request: ${message}\nWhat was done: ${result.summary}\nWrite the confirmation now.` },
          ], { maxOutputTokens: 400 }),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (!generated) throw new Error("empty");
        reply = String(generated);
        if (!reply) throw new Error("empty");
      } catch (e) {
        reply = "Done. " + result.summary;
      }
      return { status: 200, body: {
        ok: true, reply, answer: reply, actions_taken: actionsTaken,
        fallback: false, usage: usageObj(),
      } };
    }

    // Plain conversational answer (ACTION line stripped if the model left one).
    const cleanReply = action && action.rest ? action.rest : modelText;
    return { status: 200, body: {
      ok: true, reply: sanitizeTone(cleanReply), answer: sanitizeTone(cleanReply), actions_taken: [],
      fallback: false, usage: { used_today: newUsed, daily_limit: tierCfg.questionsPerDay, actions_today: actionsToday, actions_limit: tierCfg.actionsPerDay },
    } };
  } catch (error) {
    return { status: 500, body: { ok: false, message: "Something went wrong. Try again." } };
  }
}

// POST /api/ai/chat wrapper: authenticates, then runs the shared engine.
// The merged in-app chat (functions/api/chat/send.js) calls runKopaAiChat
// directly with an already verified auth context.
export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const body = await context.request.json().catch(() => ({}));
    const result = await runKopaAiChat(context, auth, body);
    return json(result.body, result.status || 200);
  } catch (error) {
    return json({ ok: false, message: "Something went wrong. Try again." }, 500);
  }
}
