// POST /api/chat/send - visitor, agent, or bot sends a message
import { getBotResponse, shouldEscalate } from './fvabot.js';
import { handleOrderMessage } from './order-flow.js';
import { handleBookingMessage } from './booking-flow.js';
import { DEFAULT_MEMORY } from './business-memory.js';
import { KOPABOOK_KNOWLEDGE, KOPABOOK_MEMORY, getEscalationResponse, detectName, nameWelcome, WARM_CLARIFIERS, isBusinessDataQuestion, PUBLIC_LOCKDOWN_ANSWER, isBusinessActionCommand, isPlatformQuestion, isFrustrated, BUSINESS_ACTION_POINTER, PLATFORM_SUPPORT_SUGGESTION, SIGNED_OUT_ACTION_POINTER } from './kopabook-knowledge.js';
import { getAuthContext } from '../_utils.js';
import { runKopaAiChat } from '../ai/chat.js';
import { handleOwnerCommand } from './bot-owner.js';
import { handleFollowUp } from './bot-memory.js';
import { getAIResponse, shouldUseAI } from './bot-ai.js';
import { maybeAutoClearChat, clearExpiredMergedChat } from './_auto_clear.js';
import { caseForSupportMessage, mirrorCaseMessage } from './_cases.js';

// D1-backed bot knowledge: the bot's BRAIN. Rows in `bot_knowledge` win over
// the hardcoded fallback, so new features can be taught without a deploy.
let KNOWLEDGE_CACHE = { at: 0, rows: [] };
async function loadD1Knowledge(db) {
  const now = Date.now();
  if (now - KNOWLEDGE_CACHE.at < 5 * 60 * 1000) return KNOWLEDGE_CACHE.rows;
  try {
    const r = await db.prepare(
      'SELECT topic, patterns, answer, quick_replies FROM bot_knowledge ORDER BY priority DESC'
    ).all();
    const rows = (r.results || []).map((row) => {
      let patterns = [], quickReplies = [];
      try { patterns = JSON.parse(row.patterns || '[]'); } catch (e) {}
      try { quickReplies = JSON.parse(row.quick_replies || '[]'); } catch (e) {}
      return { topic: row.topic, patterns, answer: row.answer, quickReplies };
    });
    KNOWLEDGE_CACHE = { at: now, rows };
  } catch (e) {
    KNOWLEDGE_CACHE = { at: now, rows: [] }; // table missing -> fallback below
  }
  return KNOWLEDGE_CACHE.rows;
}

function matchKnowledge(message, entries) {
  const lower = message.toLowerCase().trim();
  for (const entry of entries) {
    for (const pattern of (entry.patterns || [])) {
      if (pattern && lower.includes(String(pattern).toLowerCase())) {
        return {
          answer: entry.answer,
          quickReplies: entry.quickReplies || entry.quick_replies || [],
          escalate: entry.escalate || false,
          confidence: 'high',
          source: entry.topic ? 'd1' : 'builtin',
        };
      }
    }
  }
  return null;
}

async function getKopaBookResponse(message, db) {
  // D1 knowledge first (fresh), hardcoded second (fallback)
  const d1rows = await loadD1Knowledge(db);
  const hit = matchKnowledge(message, d1rows) || matchKnowledge(message, KOPABOOK_KNOWLEDGE);
  if (hit) return hit;
  // No match - ask warmly, don't guess (the bot's HEART)
  return {
    answer: WARM_CLARIFIERS[Math.floor(Math.random() * WARM_CLARIFIERS.length)],
    quickReplies: ['Pricing', 'Features', 'How to start', 'Talk to human'],
    escalate: false,
    confidence: 'low'
  };
}

async function getSiteMemory(env, siteId) {
  // KopaBook uses built-in knowledge
  if (siteId === 'kopabook') {
    return { memory: { ...KOPABOOK_MEMORY }, plan: 'internal', botEnabled: true, isKopaBook: true };
  }
  // Try to load from D1
  try {
    const site = await env.KOPABOOK_DB.prepare(
      'SELECT business_name, bot_name, bot_enabled, memory_json, plan FROM chat_sites WHERE site_id = ?'
    ).bind(siteId).first();
    if (site) {
      let memory = { ...DEFAULT_MEMORY };
      if (site.memory_json) {
        try { memory = { ...memory, ...JSON.parse(site.memory_json) }; } catch (e) {}
      }
      memory.businessName = site.business_name || memory.businessName;
      memory.botName = site.bot_name || memory.botName;
      return { memory, plan: site.plan || 'free', botEnabled: site.bot_enabled !== 0 };
    }
  } catch (e) {}
  return { memory: { ...DEFAULT_MEMORY }, plan: 'free', botEnabled: true };
}

// Handoff transcript snapshot. When a chat is escalated to a human, the full
// transcript is copied into support_handoffs, a table the 24-hour chat
// auto-clear never touches, so the support case keeps the whole story even
// after the live chat window clears. Refreshed on every escalation.
async function saveHandoffSnapshot(db, sessionId, siteId, visitorName) {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS support_handoffs (
      session_id TEXT PRIMARY KEY, site_id TEXT, visitor_name TEXT,
      transcript TEXT, created_at INTEGER, updated_at INTEGER
    )`).run();
    let rows = [];
    try {
      const r = await db.prepare(
        'SELECT sender, sender_name, message FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500'
      ).bind(sessionId).all();
      rows = r.results || [];
    } catch (e) {
      const r = await db.prepare(
        'SELECT sender, message FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500'
      ).bind(sessionId).all();
      rows = r.results || [];
    }
    const lines = rows.map((m) => `${m.sender}${m.sender_name ? ' (' + m.sender_name + ')' : ''}: ${m.message}`);
    const nowMs = Date.now();
    await db.prepare(
      `INSERT INTO support_handoffs (session_id, site_id, visitor_name, transcript, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET transcript = excluded.transcript, updated_at = excluded.updated_at`
    ).bind(sessionId, siteId, visitorName || '', lines.join('\n'), nowMs, nowMs).run();
  } catch (e) { /* snapshot is best effort; the escalation itself already saved */ }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { sessionId, sender, message, siteId, ownerCtx, mode } = await request.json();
    if (!sessionId || !message || !message.trim()) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }
    if (!['visitor', 'agent', 'bot'].includes(sender)) {
      return Response.json({ error: 'Invalid sender' }, { status: 400 });
    }
    const now = Date.now();
    const clean = message.trim().slice(0, 2000);
    const sid = siteId || 'fva70k-main';

    await env.KOPABOOK_DB.prepare(
      'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, sender, clean, now).run();

    await env.KOPABOOK_DB.prepare(
      'UPDATE chat_sessions SET last_activity = ?, status = ? WHERE id = ?'
    ).bind(now, 'active', sessionId).run();

    // Lazy auto-clear of old chat history (per-business setting, best effort).
    maybeAutoClearChat(env.KOPABOOK_DB, sid).catch(() => {});
    // Merged in-app chat: rolling 24-hour window for this session's thread.
    if (sid === 'kopabook') {
      clearExpiredMergedChat(env.KOPABOOK_DB, sessionId).catch(() => {});
    }

    // Track conversation count for plan limits
    if (sender === 'visitor') {
      trackConversation(env, sid).catch(() => {});
    }

    // FVA Bot auto-response
    let botReply = null;
    if (sender === 'visitor') {
      const { memory, plan, botEnabled, isKopaBook } = await getSiteMemory(env, sid);
      const siteConfig = { businessName: memory.businessName, botName: memory.botName, isKopaBook: !!isKopaBook };
      if (!botEnabled) {
        return Response.json({ ok: true, at: now });
      }

      // Merged in-app chat: verify the claimed owner context against the
      // signed-in session cookie. The widget's ownerCtx alone is NEVER
      // trusted: the session must belong to the same user and its active
      // business must be the claimed business. Unverified requests keep
      // the public pipeline below, exactly as before.
      let verifiedOwner = false;
      let ownerAuth = null;
      let activeMode = null;
      let supportCase = null;
      if (sid === 'kopabook' && ownerCtx && ownerCtx.businessId && ownerCtx.userId) {
        try {
          const auth = await getAuthContext(context);
          if (auth && auth.user && auth.business &&
              String(auth.user.id) === String(ownerCtx.userId) &&
              String(auth.business.id) === String(ownerCtx.businessId)) {
            verifiedOwner = true;
            ownerAuth = auth;
            activeMode = mode === 'ai' ? 'ai' : 'support';
          }
        } catch (e) { /* stay on the public pipeline */ }
      }

      // Kopa Support case record: for a verified owner on the support
      // side, the exchange is kept as a case (see _cases.js). The case
      // record is never touched by the 24-hour chat window sweep, so the
      // support story survives for the client and the FVA70K team. Ask
      // Kopa AI messages never create or touch a case. Best effort: a
      // case failure must never break the chat.
      if (verifiedOwner && activeMode === 'support') {
        try {
          const cr = await caseForSupportMessage(env.KOPABOOK_DB, {
            sessionId,
            businessId: ownerAuth.business.id,
            businessName: ownerAuth.business.name,
            userId: ownerAuth.user.id,
            clientName: ownerAuth.user.fullName || ownerCtx.userName || '',
            firstMessageText: clean,
          });
          supportCase = cr.kase;
          await mirrorCaseMessage(env.KOPABOOK_DB, supportCase, { sender: 'visitor', message: clean, at: now });
        } catch (e) { supportCase = null; }
      }

      // Check if agent is already handling (don't bot over human).
      // The Ask Kopa AI side is fully automated, so a recent human reply on
      // the support side never silences it.
      const recentAgent = await env.KOPABOOK_DB.prepare(
        'SELECT id FROM chat_messages WHERE session_id = ? AND sender = ? AND created_at > ? LIMIT 1'
      ).bind(sessionId, 'agent', now - 5 * 60 * 1000).first();

      if (!recentAgent || (verifiedOwner && activeMode === 'ai')) {
        let result = null;

        // Load recent conversation for context (bot memory)
        let recentMessages = [];
        try {
          const hist = await env.KOPABOOK_DB.prepare(
            'SELECT sender, message FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6'
          ).bind(sessionId).all();
          recentMessages = (hist.results || []).reverse();
        } catch {}

        // Visitor name memory: learn it once, use it warmly
        let visitorName = 'Visitor';
        try {
          const s = await env.KOPABOOK_DB.prepare(
            'SELECT visitor_name FROM chat_sessions WHERE id = ?'
          ).bind(sessionId).first();
          if (s && s.visitor_name) visitorName = s.visitor_name;
        } catch {}

        // Merged in-app chat routing for a VERIFIED signed-in user.
        // One thread, two doors. Ask Kopa AI runs on the real AI engine
        // with this business's own data. Kopa Support answers platform
        // questions from support knowledge and escalates to a human.
        if (verifiedOwner) {
          if (ownerAuth.user.fullName) visitorName = ownerAuth.user.fullName;
          result = getEscalationResponse(clean, visitorName);
          if (!result && isFrustrated(clean)) {
            result = {
              answer: 'I am sorry this has been frustrating. I have flagged this chat for a person on the FVA70K team, and they will join here. The full conversation goes with it, so you will not have to repeat yourself.',
              quickReplies: [],
              escalate: true,
              confidence: 'high'
            };
          }
          if (!result && activeMode === 'ai') {
            if (isPlatformQuestion(clean)) {
              result = {
                answer: PLATFORM_SUPPORT_SUGGESTION,
                quickReplies: [],
                action: { type: 'switch', mode: 'support', label: 'Switch to Kopa Support' },
                confidence: 'high'
              };
            } else {
              try {
                // Working memory: this thread's last 24 hours, shared with
                // the support side, minus the message just stored.
                let histRows = recentMessages;
                try {
                  const hr = await env.KOPABOOK_DB.prepare(
                    'SELECT sender, message FROM chat_messages WHERE session_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 21'
                  ).bind(sessionId, now - 24 * 3600000).all();
                  histRows = (hr.results || []).reverse();
                } catch (e) {}
                const hist = [...histRows];
                if (hist.length && hist[hist.length - 1].sender === 'visitor' && hist[hist.length - 1].message === clean) hist.pop();
                const history = hist
                  .filter((m) => m.sender === 'visitor' || m.sender === 'bot' || m.sender === 'agent')
                  .map((m) => ({ role: m.sender === 'visitor' ? 'user' : 'assistant', content: String(m.message || '').slice(0, 1000) }))
                  .slice(-20);
                const aiRes = await runKopaAiChat(context, ownerAuth, { message: clean, history, sessionId });
                const b = aiRes.body || {};
                const answer = b.reply || b.answer || b.message || 'Ask Kopa AI could not answer just now. Please try again.';
                result = { answer, quickReplies: [], confidence: 'high', proposal: b.proposal || null, clearChat: b.clear_chat || false };
              } catch (e) {
                result = {
                  answer: 'Ask Kopa AI is resting at the moment. Your records are safe. Please try again in a bit, or switch to Kopa Support if you need a person.',
                  quickReplies: [],
                  confidence: 'low'
                };
              }
            }
          }
          if (!result && activeMode === 'support') {
            if (isBusinessActionCommand(clean)) {
              result = {
                answer: BUSINESS_ACTION_POINTER,
                quickReplies: [],
                action: { type: 'switch', mode: 'ai', label: 'Switch to Ask Kopa AI' },
                confidence: 'high'
              };
            } else {
              result = await getKopaBookResponse(clean, env.KOPABOOK_DB);
              if (result && result.answer === PUBLIC_LOCKDOWN_ANSWER) {
                result = {
                  answer: BUSINESS_ACTION_POINTER,
                  quickReplies: [],
                  action: { type: 'switch', mode: 'ai', label: 'Switch to Ask Kopa AI' },
                  confidence: 'high'
                };
              }
            }
          }
        }

        // 1) Name capture: "my name is Ada"
        const saidName = verifiedOwner ? null : detectName(clean);
        if (saidName) {
          try {
            await env.KOPABOOK_DB.prepare(
              'UPDATE chat_sessions SET visitor_name = ? WHERE id = ?'
            ).bind(saidName.slice(0, 60), sessionId).run();
          } catch {}
          result = nameWelcome(saidName);
          visitorName = saidName;
        }

        // 2) Escalation FIRST: "talk to human" must always work
        if (!result) {
          result = getEscalationResponse(clean, visitorName);
        }

        // 2a) Signed-out shop commands get a clear pointer to Ask Kopa AI
        // inside the app, never a generic deflection.
        if (!result && sid === 'kopabook' && !verifiedOwner && isBusinessActionCommand(clean)) {
          result = {
            answer: SIGNED_OUT_ACTION_POINTER,
            quickReplies: ['Pricing', 'Features', 'Talk to human'],
            escalate: false,
            confidence: 'high'
          };
        }

        // 2b) PUBLIC BOT LOCKDOWN: on the public marketing site (siteId
        // 'kopabook'), business-data questions get the lockdown answer
        // immediately, before AI or knowledge, so no path can leak a
        // store's private business info on the public site.
        if (!result && sid === 'kopabook' && !verifiedOwner && isBusinessDataQuestion(clean)) {
          result = {
            answer: PUBLIC_LOCKDOWN_ANSWER,
            quickReplies: ['Pricing', 'Features', 'Talk to human'],
            escalate: false,
            confidence: 'high'
          };
        }

        // Owner/staff mode: try business commands first.
        // PUBLIC BOT SCOPE: the public marketing site (siteId 'kopabook')
        // is a product-info bot ONLY. Its job: answer questions about
        // KopaBook the product (pricing, features, how to start, support).
        // It must NEVER touch any business's private data, so ownerCtx is
        // ignored entirely for that site, even if one is present.
        if (!result && ownerCtx && ownerCtx.businessId && ownerCtx.userId && sid !== 'kopabook') {
          try {
            const ownerResult = await handleOwnerCommand(clean, {
              db: env.KOPABOOK_DB,
              businessId: ownerCtx.businessId,
              userId: ownerCtx.userId,
              userName: ownerCtx.userName,
              userRole: ownerCtx.userRole || 'owner',
              tier: plan || 'free',
              sessionId,
              history: recentMessages
            });
            if (ownerResult) result = ownerResult;
          } catch (e) {}
        }

        // Handle follow-ups ("yes", "no", "ok") using conversation context
        if (!result && !verifiedOwner) {
          result = handleFollowUp(clean, recentMessages, siteConfig);
          if (result) result.isFollowUp = true;
        }

        // Try AI brain for open conversation (thinks like Muse)
        if (!result && !verifiedOwner && shouldUseAI(clean, result)) {
          try {
            const aiResult = await getAIResponse(clean, {
              env, siteConfig, ownerCtx, history: recentMessages
            });
            if (aiResult) result = aiResult;
          } catch (e) {}
        }

        // Try order flow first, then booking flow, then knowledge
        if (!verifiedOwner) result = result || handleOrderMessage(clean, memory, sessionId, plan);
        if (!result && !verifiedOwner) result = handleBookingMessage(clean, memory, sessionId, plan);
        // KopaBook-specific knowledge (D1 brain + builtin fallback)
        if (!result && !verifiedOwner && siteConfig.isKopaBook) result = await getKopaBookResponse(clean, env.KOPABOOK_DB);
        if (!result) {
          const botResult = getBotResponse(clean, siteConfig);
          result = {
            answer: botResult.answer,
            quickReplies: botResult.quickReplies,
            escalate: botResult.escalate
          };
        }

        // Clear chat (Ask Kopa AI): wipe this session's thread first, so it
        // ends with only the confirmation line inserted below. Support case
        // tables are separate and are never touched here; in ai mode
        // supportCase is null, so nothing is mirrored from a cleared thread.
        if (result.clearChat) {
          try {
            await env.KOPABOOK_DB.prepare(
              'DELETE FROM chat_messages WHERE session_id = ?'
            ).bind(sessionId).run();
          } catch (e) { /* the confirmation line below still goes out */ }
        }

        const botNow = Date.now();
        await env.KOPABOOK_DB.prepare(
          'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
        ).bind(sessionId, 'bot', result.answer, botNow).run();

        // Keep the support case record in step with the live thread.
        if (supportCase) {
          try {
            await mirrorCaseMessage(env.KOPABOOK_DB, supportCase, { sender: 'bot', message: result.answer, at: botNow });
          } catch (e) { /* the live reply already saved */ }
        }

        if (result.escalate || shouldEscalate(clean)) {
          await env.KOPABOOK_DB.prepare(
            'UPDATE chat_sessions SET needs_human = 1 WHERE id = ?'
          ).bind(sessionId).run().catch(() => {});
          // The transcript snapshot survives the 24-hour chat clear.
          saveHandoffSnapshot(env.KOPABOOK_DB, sessionId, sid, visitorName).catch(() => {});
        }

        botReply = {
          answer: result.answer,
          quickReplies: result.quickReplies || [],
          escalate: result.escalate || false,
          action: result.action || null,
          isOrderFlow: result.isOrderFlow || false,
          isBookingFlow: result.isBookingFlow || false,
          proposal: result.proposal || null,
        };
      }
    }

    return Response.json({ ok: true, at: now, botReply });
  } catch (e) {
    return Response.json({ error: 'Failed to send' }, { status: 500 });
  }
}

async function trackConversation(env, siteId) {
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  try {
    await env.KOPABOOK_DB.prepare(`
      INSERT INTO chat_usage (site_id, month, conversations) VALUES (?, ?, 1)
      ON CONFLICT(site_id, month) DO UPDATE SET conversations = conversations + 1
    `).bind(siteId, monthKey).run().catch(async () => {
      await env.KOPABOOK_DB.prepare(
        'CREATE TABLE IF NOT EXISTS chat_usage (site_id TEXT, month TEXT, conversations INTEGER DEFAULT 0, PRIMARY KEY (site_id, month))'
      ).run().catch(() => {});
      await env.KOPABOOK_DB.prepare(
        'INSERT OR IGNORE INTO chat_usage (site_id, month, conversations) VALUES (?, ?, 0)'
      ).bind(siteId, monthKey).run();
      await env.KOPABOOK_DB.prepare(
        'UPDATE chat_usage SET conversations = conversations + 1 WHERE site_id = ? AND month = ?'
      ).bind(siteId, monthKey).run();
    });
  } catch (e) {}
}
