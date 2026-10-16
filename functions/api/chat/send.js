// POST /api/chat/send - visitor, agent, or bot sends a message
import { getBotResponse, shouldEscalate } from './fvabot.js';
import { handleOrderMessage } from './order-flow.js';
import { handleBookingMessage } from './booking-flow.js';
import { DEFAULT_MEMORY } from './business-memory.js';
import { KOPABOOK_KNOWLEDGE, KOPABOOK_MEMORY } from './kopabook-knowledge.js';
import { handleOwnerCommand } from './bot-owner.js';
import { handleFollowUp } from './bot-memory.js';
import { getAIResponse, shouldUseAI } from './bot-ai.js';

function getKopaBookResponse(message) {
  const lower = message.toLowerCase().trim();
  for (const entry of KOPABOOK_KNOWLEDGE) {
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern)) {
        return {
          answer: entry.answer,
          quickReplies: entry.quickReplies || [],
          escalate: entry.escalate || false,
          confidence: 'high'
        };
      }
    }
  }
  // No KopaBook match - ask, don't guess
  const clarifiers = [
    `I don't want to guess wrong. Are you asking about pricing, features, or how to get started with KopaBook?`,
    `Could you tell me a bit more? I can help with pricing, features, stock, or any problem you're having.`,
    `I want to give you the right answer. Is this about your business, our plans, or something else?`,
  ];
  return {
    answer: clarifiers[Math.floor(Math.random() * clarifiers.length)],
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

        // Owner/staff mode: try business commands first
        if (ownerCtx && ownerCtx.businessId && ownerCtx.userId) {
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
        // KopaBook-specific knowledge
        if (!result && siteConfig.isKopaBook) result = getKopaBookResponse(clean);
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
