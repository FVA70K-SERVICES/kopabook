// Smart Reply Suggestions - AI assistant for human agents
// GET /api/chat/admin/suggest?session_id=xxx
// Uses Workers AI to draft 3 short, professional reply suggestions in an
// official, warm business tone, based on the last 10 messages. Falls back to
// template suggestions when AI is unavailable. Response shape is unchanged:
// { suggestions, intent, visitorName, context }.

import { getAuthContext } from '../../_utils.js';
import { canUseChatCenter, businessSiteId } from '../_access.js';

const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthContext(request, env);
    const db = env.KOPABOOK_DB;
    if (!auth || !(await canUseChatCenter(db, auth))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 });

    // Never suggest replies for another business's chats.
    const sess = await db.prepare('SELECT site_id FROM chat_sessions WHERE id = ?').bind(sessionId).first();
    if (!sess || sess.site_id !== businessSiteId(auth.business.id)) {
      return Response.json({ error: 'That conversation does not belong to this business.' }, { status: 403 });
    }

    // Get recent messages (last 10) for context
    const msgs = await db.prepare(`
      SELECT sender, sender_name, message, created_at
      FROM chat_messages WHERE session_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).bind(sessionId).all();

    const messages = (msgs.results || []).reverse();
    if (messages.length === 0) {
      return Response.json({ suggestions: [], reason: 'No messages yet' });
    }

    // Get session info
    const session = await db.prepare(
      'SELECT visitor_name, site_id, memory_summary FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

    // Business name: prefer the chat site's business (migration 0045), else
    // fall back to the agent's first business.
    let businessName = '';
    try {
      const site = await db.prepare(
        'SELECT business_id FROM chat_sites WHERE id = ?'
      ).bind(session && session.site_id).first().catch(() => null);
      const bizId = site && site.business_id;
      if (bizId) {
        const biz = await db.prepare('SELECT name FROM businesses WHERE id = ?').bind(bizId).first().catch(() => null);
        if (biz && biz.name) businessName = biz.name;
      }
      if (!businessName) {
        const biz = await db.prepare(
          'SELECT name FROM businesses WHERE id = (SELECT business_id FROM business_members WHERE user_id = ? LIMIT 1)'
        ).bind(auth.user.id).first().catch(() => null);
        if (biz && biz.name) businessName = biz.name;
      }
    } catch {}

    const contextLines = messages.map(m => `${m.sender === 'visitor' ? 'Customer' : 'Agent'}: ${m.message}`);
    const lastVisitor = [...messages].reverse().find(m => m.sender === 'visitor');
    const lastMsg = (lastVisitor && lastVisitor.message) || '';
    const visitorFirst = (session && session.visitor_name ? String(session.visitor_name).split(' ')[0] : 'there');

    let suggestions = null;
    const ai = env.AI;
    if (ai) {
      try {
        const prompt = `You are writing suggested replies for a human customer-support agent at a Nigerian business${businessName ? ` called "${businessName}"` : ''}. The human agent will tap one suggestion and send it to the customer, possibly editing it first.

RULES:
- Write exactly 3 short reply suggestions, each on its own line, numbered 1. 2. 3.
- Official, warm business tone: correct grammar, respectful, no slang, no emojis (unless the customer used emojis, then at most one).
- Each suggestion must directly address the customer's LATEST message below. Do not ask for information the conversation already has.
- Keep each under 40 words. Plain text only, no quotes.
- Address the customer as ${visitorFirst} where natural.

CONVERSATION (oldest to newest):
${contextLines.join('\n')}

Write the 3 suggestions now.`;
        const resp = await ai.run(AI_MODEL, {
          messages: [
            { role: 'system', content: 'You draft professional customer-support reply suggestions. Output exactly 3 numbered suggestions, nothing else.' },
            { role: 'user', content: prompt },
          ],
        });
        const text = resp && (resp.response || resp.answer || resp.text);
        if (text) {
          const lines = String(text).split('\n')
            .map(l => l.replace(/^\s*\d+[).\-:]\s*/, '').trim())
            .filter(l => l.length > 5 && l.length < 300);
          if (lines.length >= 2) suggestions = lines.slice(0, 3);
        }
      } catch (e) {
        suggestions = null; // fall through to templates
      }
    }

    if (!suggestions) {
      suggestions = generateSuggestions(lastMsg.toLowerCase(), lastMsg, messages, session, businessName ? ` Business: ${businessName}.` : '');
    }

    // Detect intent for memory
    const intent = detectIntent(lastMsg.toLowerCase());
    if (intent && sessionId) {
      await db.prepare(
        'UPDATE chat_sessions SET visitor_intent = ? WHERE id = ?'
      ).bind(intent, sessionId).run().catch(() => {});
    }

    return Response.json({
      suggestions,
      intent,
      visitorName: session?.visitor_name,
      context: messages.slice(-3).map(m => `${m.sender}: ${m.message.slice(0, 100)}`)
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function detectIntent(lower) {
  if (lower.match(/price|cost|how much|fee|charge|plan/)) return 'pricing';
  if (lower.match(/stock|inventory|available|in stock/)) return 'stock_inquiry';
  if (lower.match(/deliver|shipping|send|dispatch/)) return 'delivery';
  if (lower.match(/return|refund|exchange|broken|damaged|complaint/)) return 'complaint';
  if (lower.match(/hour|open|close|location|address|where/)) return 'location_hours';
  if (lower.match(/order|buy|purchase|want.*get/)) return 'order';
  if (lower.match(/thank|thanks|great|perfect|awesome/)) return 'satisfied';
  if (lower.match(/hello|hi\b|hey|good morning|good afternoon/)) return 'greeting';
  if (lower.match(/human|agent|person|real|someone/)) return 'wants_human';
  return 'general_question';
}

function generateSuggestions(lower, original, messages, session, bizContext) {
  const name = session?.visitor_name?.split(' ')[0] || 'there';
  const suggestions = [];

  // Pricing questions
  if (lower.match(/price|cost|how much|fee|charge|plan/)) {
    suggestions.push(
      `Hello ${name}, thank you for asking. Our plans are: Free, Starter at NGN 1,000 per month, Pro at NGN 10,000 per month, and Solo at NGN 5,000 per month. Which one would you like to know more about?`,
      `Good day! KopaBook is free to start, and you can upgrade when your business grows. May I know how many businesses you run so I can recommend the right plan?`,
      `Thank you for your interest, ${name}. Recording a sale is always free on every plan. Would you like me to walk you through the paid options?`
    );
  }
  // Stock / product questions
  else if (lower.match(/stock|inventory|available|in stock|do you have/)) {
    suggestions.push(
      `Let me check that for you right away, ${name}. One moment please.`,
      `Thank you for asking. Could you please confirm the exact product name so I check the correct item?`,
      `I will verify our current stock levels for you now, ${name}. Is there anything else you need in the meantime?`
    );
  }
  // Complaints
  else if (lower.match(/return|refund|exchange|broken|damaged|wrong|complaint|angry|disappointed|bad/)) {
    suggestions.push(
      `I am very sorry about that, ${name}. That is not the experience we want for you. Please tell me exactly what happened so I can make it right.`,
      `I understand your frustration, and I want to resolve this for you. Let me look into it immediately.`,
      `Thank you for bringing this to my attention. I take it seriously. Could you share your order details so I can sort it out?`
    );
  }
  // Delivery
  else if (lower.match(/deliver|shipping|send|dispatch|when.*arrive|how long.*deliver/)) {
    suggestions.push(
      `Good question. Delivery usually takes 2 to 3 working days within the city. May I know your location?`,
      `I can arrange that for you, ${name}. What is your delivery address?`,
      `Let me check the delivery options for your area now. One moment please.`
    );
  }
  // Hours / location
  else if (lower.match(/hour|open|close|location|address|where.*you/)) {
    suggestions.push(
      `We are open Monday to Saturday, 8am to 6pm. Is there a particular time you would like to visit?`,
      `Thank you for asking. Would you like me to share our exact address and directions?`,
      `We are available right now, ${name}. How may I help you today?`
    );
  }
  // Wants human (already human, reassure)
  else if (lower.match(/human|agent|person|real|someone|robot|bot/)) {
    suggestions.push(
      `You are speaking with a real person now, ${name}. I am here to help. What do you need?`,
      `No bots here, it is just me. How may I assist you today?`,
      `I am a real team member. Please tell me what is on your mind and I will sort it out.`
    );
  }
  // Greeting
  else if (lower.match(/^(hello|hi|hey|good morning|good afternoon|good evening)/)) {
    suggestions.push(
      `Hello ${name}, welcome. How may I help you today?`,
      `Good day! Thank you for contacting us. What can I do for you?`,
      `Hello ${name}. What are you looking for today?`
    );
  }
  // Thanks
  else if (lower.match(/thank|thanks|great|perfect|awesome|nice/)) {
    suggestions.push(
      `You are very welcome, ${name}. Is there anything else I can help with?`,
      `Happy to help. Please let me know if you need anything else.`,
      `It is my pleasure. We appreciate your patronage.`
    );
  }
  // Order intent
  else if (lower.match(/order|buy|purchase|i want|i need/)) {
    suggestions.push(
      `Excellent choice, ${name}. I will get that sorted for you. How many do you need?`,
      `I can help you with that order right away. What quantity are you looking for?`,
      `Certainly. Let me confirm the details: which product exactly, and how many?`
    );
  }
  // Default: thoughtful generic that references their actual message
  else {
    const short = original.length > 60 ? original.slice(0, 60) + '...' : original;
    suggestions.push(
      `Thank you for asking about "${short}", ${name}. Let me get you the correct answer. One moment please.`,
      `Good question. I want to make sure I give you accurate information. Could you tell me a little more about what you need?`,
      `I understand, ${name}. Let me look into that for you right now.`
    );
  }

  return suggestions.slice(0, 3);
}
