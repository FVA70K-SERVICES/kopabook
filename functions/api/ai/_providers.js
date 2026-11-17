// Kopa AI — Gemini providers (paid keys only) and generateText.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Behaviour is unchanged: code moved verbatim; only imports/exports
// were added at the module boundary.

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
export const MODEL_UNAVAILABLE_LINE = "Kopa AI could not reach the AI just now. Your books are fine. Try again, or ask me for today's sales or who owes you.";
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
