// POST /api/chat/send - visitor, agent, or bot sends a message
import { getBotResponse, shouldEscalate } from './fvabot.js';
import { handleOrderMessage } from './order-flow.js';
import { handleBookingMessage } from './booking-flow.js';
import { DEFAULT_MEMORY } from './business-memory.js';
import { KOPABOOK_KNOWLEDGE, KOPABOOK_MEMORY, getEscalationResponse, detectName, nameWelcome, WARM_CLARIFIERS } from './kopabook-knowledge.js';
import { handleOwnerCommand } from './bot-owner.js';
import { handleFollowUp } from './bot-memory.js';
import { getAIResponse, shouldUseAI } from './bot-ai.js';

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

export async function onRequestPost({ request, env }) {
  try {
    const { sessionId, sender, message, siteId, ownerCtx } = await request.json();
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

      // Check if agent is already handling (don't bot over human)
      const recentAgent = await env.KOPABOOK_DB.prepare(
        'SELECT id FROM chat_messages WHERE session_id = ? AND sender = ? AND created_at > ? LIMIT 1'
      ).bind(sessionId, 'agent', now - 5 * 60 * 1000).first();

      if (!recentAgent) {
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

        // 1) Name capture: "my name is Ada"
        const saidName = detectName(clean);
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

        // Owner/staff mode: try business commands first
        if (!result && ownerCtx && ownerCtx.businessId && ownerCtx.userId) {
          try {
            const ownerResult = await handleOwnerCommand(clean, {
              db: env.KOPABOOK_DB,
              businessId: ownerCtx.businessId,
              userId: ownerCtx.userId,
              userName: ownerCtx.userName,
              userRole: ownerCtx.userRole || 'owner',
              tier: plan || 'free',
              history: recentMessages
            });
            if (ownerResult) result = ownerResult;
          } catch (e) {}
        }

        // Handle follow-ups ("yes", "no", "ok") using conversation context
        if (!result) {
          result = handleFollowUp(clean, recentMessages, siteConfig);
          if (result) result.isFollowUp = true;
        }

        // Try AI brain for open conversation (thinks like Muse)
        if (!result && shouldUseAI(clean, result)) {
          try {
            const aiResult = await getAIResponse(clean, {
              env, siteConfig, ownerCtx, history: recentMessages
            });
            if (aiResult) result = aiResult;
          } catch (e) {}
        }

        // Try order flow first, then booking flow, then knowledge
        result = result || handleOrderMessage(clean, memory, sessionId, plan);
        if (!result) result = handleBookingMessage(clean, memory, sessionId, plan);
        // KopaBook-specific knowledge (D1 brain + builtin fallback)
        if (!result && siteConfig.isKopaBook) result = await getKopaBookResponse(clean, env.KOPABOOK_DB);
        if (!result) {
          const botResult = getBotResponse(clean, siteConfig);
          result = {
            answer: botResult.answer,
            quickReplies: botResult.quickReplies,
            escalate: botResult.escalate
          };
        }

        const botNow = Date.now();
        await env.KOPABOOK_DB.prepare(
          'INSERT INTO chat_messages (session_id, sender, message, created_at) VALUES (?, ?, ?, ?)'
        ).bind(sessionId, 'bot', result.answer, botNow).run();

        if (result.escalate || shouldEscalate(clean)) {
          await env.KOPABOOK_DB.prepare(
            'UPDATE chat_sessions SET needs_human = 1 WHERE id = ?'
          ).bind(sessionId).run().catch(() => {});
        }

        botReply = {
          answer: result.answer,
          quickReplies: result.quickReplies || [],
          escalate: result.escalate || false,
          action: result.action || null,
          isOrderFlow: result.isOrderFlow || false,
          isBookingFlow: result.isBookingFlow || false,
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
