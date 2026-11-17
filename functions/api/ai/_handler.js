// Kopa AI — runKopaAiChat: the shared chat engine.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Split verbatim from chat.js; the dead "column not migrated yet"
// fallbacks were then removed (Phase 7.3: the columns are relied on
// directly — live D1 has them).
import { audit, toSqliteDate } from "../_utils";
import { checkRateLimit } from "../_webhook_security";
import { getBusinessOwnerTier } from "../billing";
import { resolveFastPath, isClearChatRequest, CLEAR_CHAT_QUESTION, CLEAR_CHAT_DECLINED, CLEAR_CHAT_DONE } from "./_fastpath.js";
import { LANGUAGE_SWITCH_REPLIES, PROPOSAL_TEXT, detectLanguageSwitch, getAssistantProfile, setAssistantLanguage } from "./_assistant.js";
import { buildBriefing, buildEodSummary, handleReminderDone, listDueReminders, parseAction } from "./_briefing.js";
import { TOOL_EXECUTORS } from "./_dispatch.js";
import { AI_TIER_LIMITS, FREE_PROJECT_ACTIONS_PER_DAY, FREE_PROJECT_CAP_MSG, PROJECT_WRITE_TOOLS, UPGRADE_NUDGE, fmt, tierAllowsTool, toolAllowed } from "./_gating.js";
import { matchCustomer } from "./_matchers.js";
import { CANCEL_RE, CHAT_CONFIRM_WORDS_RE, PROPOSAL_TTL_MS, STAFF_ACTIVITY_NO_DATA, WRITE_TOOLS, callWriteExecutor, clearPendingWarnings, countProjectActionsToday, createAiProposal, debtorBalanceChanged, ensurePendingProposals, formatWarning, instructionGateRefusal, intentMatches, loadBusinessMemory, loadPendingProposal, loadPendingProposalById, loadPendingWarning, normalizeIntentText, outOfScopeRefusal, parseWarningAnswer, runGuardrailChecks, sanitizeTone, staffActivityAnswer, storePendingWarning, updateProposalStatus } from "./_proposals.js";
import { MODEL_UNAVAILABLE_LINE, aiProviderAvailable, generateText } from "./_providers.js";
import { buildSnapshot, systemPrompt } from "./_snapshot.js";

const HISTORY_LIMIT = 20;

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
      // Phase 4.1: re-check the tool against the CONFIRMING user, not
      // the user who drafted the proposal. A proposal drafted while
      // privileged must not execute after demotion, and a staff member
      // who may only record sales must not execute another tool's
      // proposal. (The direct action path already checks toolAllowed
      // before drafting; this is the Confirm path's missing half.)
      if (!toolAllowed(auth, tapProposal.tool)) {
        const noPerm = "You no longer have permission to do that. Ask the owner.";
        await updateProposalStatus(db, businessId, tapProposal.id, "failed", noPerm);
        return { status: 200, body: { ok: true, reply: noPerm, answer: noPerm, actions_taken: [], fallback: false } };
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
    // Phase 7.3: the ai_memory table (migration 0050) is relied on
    // directly through the shared loadBusinessMemory read; the old inline
    // "table not migrated yet" skip is removed. (loadBusinessMemory still
    // degrades to no-memory when the read itself fails, the same
    // per-section guard the snapshot uses — the memory section is
    // non-essential, so one bad read must not break the chat.)
    let memorySection = "";
    const mems = ((await loadBusinessMemory(db, businessId)) || []).filter((r) => r && r.memory_value);
    if (mems.length) {
      memorySection = "What you remember about this business:\n" + mems.map((r) => `- ${r.memory_key}: ${r.memory_value}`).join("\n");
    }

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
