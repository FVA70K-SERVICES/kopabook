// Kopa Bot AI Brain - connects to Cloudflare Workers AI (Llama)
// This makes the bot actually understand and think, not just match patterns

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function buildSystemPrompt(siteConfig, ownerCtx, history) {
  const botName = siteConfig.botName || 'Kopa Bot';
  const business = siteConfig.businessName || 'KopaBook';

  let prompt = `You are ${botName}, the friendly AI assistant for ${business}. `;

  if (siteConfig.isKopaBook) {
    prompt += `KopaBook is the best free record book for Nigerian local businesses. It helps track sales, stock, debts, expenses, staff, and customers.

Plans:
- Free: NGN 0, free forever (1 business, 100 products, 1 staff). Ask Kopa AI: 5 questions a day, read-only
- Starter: NGN 1,000/month or NGN 10,000/year (5 businesses, 1,000 products, 5 staff). Ask Kopa AI: 20 questions a day plus 10 actions a day
- Solo: NGN 5,000/month or NGN 50,000/year (1 business, 500 products, 3 staff, plus an AI worker: morning briefings, stock alerts, reminders, target tracking). Ask Kopa AI: 50 questions a day
- Pro: NGN 10,000/month or NGN 100,000/year (unlimited businesses, products and staff). Ask Kopa AI: 100 questions a day

Rules:
- Be warm, helpful, and conversational like a friendly Nigerian support agent
- Keep answers short (2-3 sentences max) unless explaining steps
- NEVER guess. If unsure, ask a clarifying question
- If the user is frustrated or asks for a human, offer to connect them
- Use naira (₦) for prices, be specific with numbers
- Don't use em dashes or asterisks for formatting
- PUBLIC SCOPE: you only talk about KopaBook the product. Never discuss any store's private business data (their products, prices, stock, customers, sales or debts)`;
  }

  if (ownerCtx && ownerCtx.userName) {
    prompt += `\n\nYou are talking to ${ownerCtx.userName}, the business owner (${ownerCtx.userRole}). Be extra helpful, like a trusted business partner.`;
  }

  return prompt;
}

function buildMessages(history, currentMessage, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];

  // Add recent conversation for context (last 6 messages)
  const recent = (history || []).slice(-6);
  for (const m of recent) {
    if (m.sender === 'visitor') {
      messages.push({ role: 'user', content: m.message });
    } else if (m.sender === 'bot' || m.sender === 'agent') {
      messages.push({ role: 'assistant', content: m.message });
    }
  }

  // Add current message if not already in history
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser || lastUser.content !== currentMessage) {
    messages.push({ role: 'user', content: currentMessage });
  }

  return messages;
}

export async function getAIResponse(message, { env, siteConfig, ownerCtx, history }) {
  // Workers AI binding must be configured as "AI" in Pages settings
  if (!env.AI) {
    return null; // Fall back to rule-based
  }

  try {
    const systemPrompt = buildSystemPrompt(siteConfig, ownerCtx, history);
    const messages = buildMessages(history, message, systemPrompt);

    const response = await env.AI.run(AI_MODEL, {
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    let answer = '';
    if (typeof response === 'string') {
      answer = response;
    } else if (response.response) {
      answer = response.response;
    } else {
      return null;
    }

    answer = answer.trim();
    if (!answer || answer.length < 5) return null;

    // Detect if AI wants to escalate
    const escalate = /human|agent|team member|support team/i.test(answer) &&
                     /connect|transfer|escalate|bring in/i.test(answer);

    // Generate contextual quick replies
    const quickReplies = getContextualReplies(message, answer);

    return {
      answer,
      quickReplies,
      escalate,
      confidence: 'ai',
      source: 'ai'
    };
  } catch (e) {
    return null; // Fall back to rule-based on any error
  }
}

function getContextualReplies(message, answer) {
  const lower = (message + ' ' + answer).toLowerCase();
  const replies = [];

  if (lower.match(/pric|plan|cost/)) replies.push('What is Solo?');
  if (lower.match(/start|begin|new/)) replies.push('Yes, guide me');
  if (lower.match(/stock|inventory|product/)) replies.push('Check stock');
  if (lower.match(/sale|sell/)) replies.push('Record a sale');
  if (lower.match(/thank/)) replies.push('You are welcome');

  // Default options
  if (replies.length === 0) {
    replies.push('Pricing', 'Talk to human');
  }

  return replies.slice(0, 3);
}

// Check if AI should handle this (vs rule-based)
// Rules handle: owner commands, follow-ups, exact knowledge matches
// AI handles: everything else (open conversation)
export function shouldUseAI(message, ruleResult) {
  // If rules gave a high-confidence answer, use it
  if (ruleResult && ruleResult.confidence === 'high') return false;
  // If it's a follow-up ("yes"/"no"), rules handle it
  if (ruleResult && ruleResult.isFollowUp) return false;
  // Otherwise, let AI think
  return true;
}
