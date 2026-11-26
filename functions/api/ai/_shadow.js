// Kopa AI — Llama shadow pilot (26 Nov 2026).
// Shadow mode only: on ONE business (FVA70K STORE, business id 1) every
// model-called question also runs through Llama; Gemini's answer is
// served, Llama's is logged with cost and latency. Nothing is ever served
// from Llama, and no other business is affected: the flag is a server-side
// D1 row (migration 0065), there is no endpoint that flips it, and a
// missing row reads as off. The pilot never touches Paystack, pricing,
// plans, or customer-facing copy, and it never changes the proposal flow:
// the shadow runs beside the served Gemini call and its text is never
// parsed into an action, a proposal, or a reply.
import { estimateLlamaNeurons, generateLlamaText, llamaAvailable } from "./_providers.js";

// Free allowance is 10,000 Neurons/day account-wide; the pilot stops its
// own Llama calls at 9,000/day of logged use so the allowance is never
// exhausted by the pilot alone. Gemini does not use Neurons, so the guard
// can never starve a paying customer's served answer.
export const SHADOW_NEURON_BUDGET_PER_DAY = 9000;
const SHADOW_TEXT_CAP = 4000;
const SHADOW_ERROR_CAP = 200;
const SHADOW_QUESTION_CAP = 500;

// Amounts are extracted with the same pattern as amountsIn() in
// ./_proposals.js (numbers with optional thousand separators), so the
// figures check stays comparable with the guardrails' own reading.
function extractAmounts(text) {
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  const out = [];
  let m;
  while ((m = re.exec(String(text || "")))) out.push(Number(m[1].replace(/,/g, "")));
  return out;
}

// Heuristic figures check: every amount in the Llama text that does not
// appear in the reference text (the system prompt, which carries the live
// snapshot figures) is listed as unmatched. It is a HEURISTIC, not a
// verdict: a correct derived figure (a sum, a count, a percentage) can
// legitimately be absent from the snapshot, and the snapshot can contain
// figures the answer never uses. The two-week review reads the unmatched
// list by eye; nothing is auto-flagged as wrong and nothing is blocked.
export function checkFigures(llamaText, referenceText) {
  const amounts = extractAmounts(llamaText);
  const reference = new Set(extractAmounts(referenceText));
  const unmatched = [...new Set(amounts.filter((n) => !reference.has(n)))];
  return { amounts, unmatched };
}

// The flag is server-side only and owner-scoped by construction: the only
// writer is the migration seed, and the only reader is this function, run
// with the business_id from the authenticated session. A customer can
// never flip their own flag (no endpoint exists) and can never read
// another business's shadow log (the log is never returned by any route).
export async function isShadowPilotOn(db, businessId) {
  try {
    const row = await db.prepare(
      `SELECT shadow FROM ai_shadow_pilot WHERE business_id = ? LIMIT 1`
    ).bind(Number(businessId)).first();
    return !!(row && Number(row.shadow) === 1);
  } catch {
    return false; // Fail closed: no flag read, no shadow call.
  }
}

async function shadowNeuronsUsedToday(db, businessId, day) {
  try {
    const row = await db.prepare(
      `SELECT COALESCE(SUM(neurons_estimate), 0) AS used FROM ai_shadow_log WHERE business_id = ? AND day = ?`
    ).bind(Number(businessId), day).first();
    return Number((row && row.used) || 0);
  } catch {
    return SHADOW_NEURON_BUDGET_PER_DAY; // Fail closed: unknown spend, do not call.
  }
}

async function logShadowRow(db, row) {
  try {
    await db.prepare(
      `INSERT INTO ai_shadow_log (id, business_id, day, created_at, question, llama_ms, llama_ok, llama_status, llama_text, prompt_tokens, completion_tokens, total_tokens, neurons_estimate, figures_check_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.id, row.businessId, row.day, row.createdAt, row.question, row.llamaMs, row.llamaOk, row.llamaStatus, row.llamaText, row.promptTokens, row.completionTokens, row.totalTokens, row.neuronsEstimate, row.figuresCheckJson, row.error).run();
  } catch (e) {
    console.error("shadow log write failed: " + String((e && e.message) || e));
  }
}

// Runs the Llama shadow call and logs it. Never throws: any failure is
// logged as a failed row (or, if even the log write fails, to console)
// and the caller serves Gemini either way. `day` is the UTC date string
// the caller already computed; `referenceText` is the system prompt that
// carries the snapshot figures for the figures check. The question and
// the Llama text are the business's own data, stored per business_id in
// the same D1 as its chat history — never shared across businesses, and
// never returned by any route.
export async function runLlamaShadow(env, db, businessId, question, messages, day, referenceText) {
  const startedAt = Date.now();
  const id = "shd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const base = {
    id,
    businessId: Number(businessId),
    day,
    createdAt: Math.floor(Date.now() / 1000),
    question: String(question || "").slice(0, SHADOW_QUESTION_CAP),
  };
  const failRow = (status, error) => logShadowRow(db, {
    ...base,
    llamaMs: Date.now() - startedAt,
    llamaOk: 0,
    llamaStatus: status,
    llamaText: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    neuronsEstimate: null,
    figuresCheckJson: null,
    error: String(error || "").slice(0, SHADOW_ERROR_CAP),
  });
  if (!llamaAvailable(env)) {
    await failRow("not_configured", "Workers AI binding (env.AI) is not set on this deployment");
    return { ok: false, status: "not_configured" };
  }
  const used = await shadowNeuronsUsedToday(db, businessId, day);
  if (used >= SHADOW_NEURON_BUDGET_PER_DAY) {
    await failRow("skipped_budget", "daily Neuron budget reached (" + used + " logged)");
    return { ok: false, status: "skipped_budget" };
  }
  try {
    const result = await generateLlamaText(env, messages, {});
    const ms = Date.now() - startedAt;
    const usage = result.usage || {};
    const neurons = estimateLlamaNeurons(usage.prompt_tokens, usage.completion_tokens);
    const figures = checkFigures(result.text, referenceText);
    await logShadowRow(db, {
      ...base,
      llamaMs: ms,
      llamaOk: 1,
      llamaStatus: "ok",
      llamaText: result.text.slice(0, SHADOW_TEXT_CAP),
      promptTokens: usage.prompt_tokens || null,
      completionTokens: usage.completion_tokens || null,
      totalTokens: usage.total_tokens || null,
      neuronsEstimate: neurons,
      figuresCheckJson: JSON.stringify(figures),
      error: null,
    });
    return { ok: true, status: "ok", text: result.text, neuronsEstimate: neurons, latencyMs: ms };
  } catch (e) {
    await failRow("failed", String((e && e.message) || e));
    return { ok: false, status: "failed", error: String((e && e.message) || e) };
  }
}
