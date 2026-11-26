// POST /api/ai/chat: Kopa, the KopaBook business assistant (paid Gemini keys only, no free chain).
// Llama shadow pilot (26 Nov 2026): on one business (FVA70K STORE) Llama
// runs beside Gemini and its answers are logged, never served. See
// functions/api/ai/_shadow.js. Gemini stays the only served provider.
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
// Phase 7.3: this file was one 4,268-line module. It is now only the route:
// it authenticates, runs the shared engine in ./_handler.js, and re-exports
// the public surface so existing importers keep working unchanged
// (functions/api/chat/send.js, functions/api/admin/ai/_engine.js,
// functions/api/ai/pa.js, local tests). The domains live in:
//   _providers.js  Gemini providers + generateText
//   _gating.js     tier limits, tool gating, roles, pure helpers
//   _snapshot.js   business snapshot, its text form, system prompt
//   _matchers.js   product/customer matching, reminders, business time
//   _executors.js  tool executors (the writes Kopa AI can perform)
//   _projects.js   project tools and project executors
//   _dispatch.js   TOOL_EXECUTORS (tool name -> executor)
//   _proposals.js  guardrails, confirm-before-action proposals, warnings
//   _assistant.js  assistant identity, language, PA settings
//   _briefing.js   briefing, end-of-day summary, reminders, action parsing
//   _handler.js    runKopaAiChat (the shared chat engine)
import { json, getAuthContext, requireAuth } from "../_utils";
import { runKopaAiChat } from "./_handler.js";
export { aiProviderAvailable, generateText } from "./_providers.js";
export { debtorDraftMatches, firstMissingProjectField, tierAllowsTool, toolAllowed } from "./_gating.js";
export { buildSnapshot, systemPrompt } from "./_snapshot.js";
export { formatBusinessTime, namesSimilar } from "./_matchers.js";
export {
  GUARDRAIL_UNUSUAL_MULTIPLIER,
  sanitizeTone,
  unknownFigureText,
  formatWarning,
  parseWarningAnswer,
  instructionGateRefusal,
  STAFF_ACTIVITY_NO_DATA,
  staffActivityAnswer,
  outOfScopeRefusal,
  amountsIn,
  debtorBalanceChanged,
  loadBusinessMemory,
  ensurePendingWarnings,
  storePendingWarning,
  loadPendingWarning,
  clearPendingWarnings,
  createAiProposal,
  runGuardrailChecks,
} from "./_proposals.js";
export {
  ASSISTANT_LANGUAGES,
  getAssistantSettings,
  setAssistantLanguage,
  getAssistantProfile,
  PROPOSAL_TEXT,
  LANGUAGE_SWITCH_REPLIES,
} from "./_assistant.js";
export { runKopaAiChat } from "./_handler.js";

// Exported for local tests (same convention as buildSnapshot): the Phase
// 4.1 server-flow tests exercise execRecordSale directly for the credit
// guard and the stock reserve, in dry-run and execute modes.
export { execRecordSale } from "./_executors.js";

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
