// Smart Reply Suggestions - AI assistant for human agents
// GET /api/chat/admin/suggest?session_id=xxx
// Reads the conversation, understands the question, suggests 3 human-like replies

import { getAuthContext } from '../../_utils.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = await getAuthContext(request, env);
    if (!auth || !auth.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 });

    const db = env.KOPABOOK_DB;

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

    // Get session info + business context
    const session = await db.prepare(
      'SELECT visitor_name, site_id, memory_summary FROM chat_sessions WHERE id = ?'
    ).bind(sessionId).first();

    // Get business info if this is kopabook
    let bizContext = '';
    try {
      const biz = await db.prepare(
        'SELECT name FROM businesses WHERE id = (SELECT business_id FROM business_members WHERE user_id = ? LIMIT 1)'
      ).bind(auth.user.id).first();
      if (biz) bizContext = ` Business: ${biz.name}.`;
    } catch {}

    // Analyze the last visitor message
    const lastVisitor = [...messages].reverse().find(m => m.sender === 'visitor');
    const lastMsg = lastVisitor?.message || '';
    const lower = lastMsg.toLowerCase();

    const suggestions = generateSuggestions(lower, lastMsg, messages, session, bizContext);

    // Detect intent for memory
    const intent = detectIntent(lower);
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
      `Hi ${name}! Our plans are: Free (2 businesses), Starter at ₦1,000/month (5 businesses), and Pro at ₦2,500/month (unlimited). Which one sounds right for you?`,
      `Good question! KopaBook is free to start. The paid plans unlock more businesses, products, and staff. Want me to walk you through which fits best?`,
      `I can help with that! Are you running one shop or multiple businesses? That will help me recommend the right plan.`
    );
  }
  // Stock / product questions
  else if (lower.match(/stock|inventory|available|in stock|do you have/)) {
    suggestions.push(
      `Let me check that for you right now, ${name}. One moment...`,
      `Good news, I can look that up! What is the exact product name?`,
      `I will verify our current stock levels for you. Is there anything else you need while I check?`
    );
  }
  // Complaints
  else if (lower.match(/return|refund|exchange|broken|damaged|wrong|complaint|angry|disappointed|bad/)) {
    suggestions.push(
      `I am really sorry about that, ${name}. That is not the experience we want for you. Can you tell me exactly what happened so I can fix it?`,
      `I understand your frustration, and I want to make this right. Let me look into this immediately for you.`,
      `Thank you for telling me. I take this seriously. Can you share your order details so I can sort this out?`
    );
  }
  // Delivery
  else if (lower.match(/deliver|shipping|send|dispatch|when.*arrive|how long.*deliver/)) {
    suggestions.push(
      `Great question! Delivery usually takes 2-3 working days within the city. Where are you located?`,
      `I can arrange that for you, ${name}. What is your delivery address?`,
      `Let me check the delivery options for your area. One moment...`
    );
  }
  // Hours / location
  else if (lower.match(/hour|open|close|location|address|where.*you/)) {
    suggestions.push(
      `We are open Monday to Saturday, 8am to 6pm. Is there a specific time you want to visit?`,
      `You can find us at our store. Would you like me to share the exact address and directions?`,
      `We are available right now! How can I help you today, ${name}?`
    );
  }
  // Wants human (already human, reassure)
  else if (lower.match(/human|agent|person|real|someone|robot|bot/)) {
    suggestions.push(
      `You are speaking with a real person now, ${name}! I am here to help. What do you need?`,
      `No bots here, it is just me! How can I assist you today?`,
      `I am a real team member. Tell me what is on your mind and I will sort it out.`
    );
  }
  // Greeting
  else if (lower.match(/^(hello|hi|hey|good morning|good afternoon|good evening)/)) {
    suggestions.push(
      `Hello ${name}! Welcome. How can I help you today?`,
      `Hi there! Good to see you. What can I do for you?`,
      `Hey ${name}! What are you looking for today?`
    );
  }
  // Thanks
  else if (lower.match(/thank|thanks|great|perfect|awesome|nice/)) {
    suggestions.push(
      `You are very welcome, ${name}! Anything else I can help with?`,
      `Happy to help! Let me know if you need anything else.`,
      `My pleasure! We appreciate you.`
    );
  }
  // Order intent
  else if (lower.match(/order|buy|purchase|i want|i need/)) {
    suggestions.push(
      `Excellent choice, ${name}! Let me get that sorted for you. How many do you need?`,
      `I can help you with that order right away. What quantity are you looking for?`,
      `Perfect! Let me confirm the details. Which product exactly, and how many?`
    );
  }
  // Default: thoughtful generic that references their actual message
  else {
    const short = original.length > 60 ? original.slice(0, 60) + '...' : original;
    suggestions.push(
      `Thanks for asking about "${short}". Let me get you the right answer, ${name}. One moment...`,
      `Good question! I want to make sure I give you the correct information. Can you tell me a bit more about what you need?`,
      `I hear you, ${name}. Let me look into that for you right now.`
    );
  }

  return suggestions.slice(0, 3);
}
