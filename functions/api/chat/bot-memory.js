// Conversation memory - understands follow-ups like "yes", "no", "ok"
// by reading what the bot just asked

export function handleFollowUp(message, history, siteConfig) {
  const lower = message.toLowerCase().trim();

  // Only handle short follow-up responses
  const isFollowUp = /^(yes|yeah|yep|ok|okay|sure|no|nope|nah|maybe|alright)$/i.test(lower);
  if (!isFollowUp) return null;

  // Find the last bot message to understand context
  const lastBot = [...history].reverse().find(m => m.sender === 'bot');
  if (!lastBot) return null;

  const botText = lastBot.message.toLowerCase();
  const isYes = /^(yes|yeah|yep|ok|okay|sure|alright)$/i.test(lower);

  // Bot asked "Want me to guide you?" / "Want me to walk you through?"
  if (botText.match(/guide you|walk you through|help you (get started|with that)|show you how/)) {
    if (isYes) {
      return {
        answer: `Great! Here is how to get started:\n\n1. Go to Products and add your items with prices\n2. Tap "New Sale" to record your first sale\n3. Check the Dashboard to see your money at a glance\n\nWhat would you like to do first?`,
        quickReplies: ['Record a sale', 'Add a product', 'Pricing']
      };
    } else {
      return {
        answer: `No problem! Take your time exploring. I am here whenever you need help.`,
        quickReplies: ['Pricing', 'Our services', 'Talk to human']
      };
    }
  }

  // Bot asked about pricing/plans
  if (botText.match(/which (one|plan)|sounds right|recommend/)) {
    if (isYes) {
      return {
        answer: `Perfect! You can upgrade anytime from Settings > Subscription. The Solo plan at ₦5,000/month gives you the full AI worker. Want me to explain what is included?`,
        quickReplies: ['What is included?', 'Talk to human']
      };
    } else {
      return {
        answer: `No worries! The Free plan is great to start with. You can always upgrade later when you are ready.`,
        quickReplies: ['Our services', 'Talk to human']
      };
    }
  }

  // Bot offered to connect to human
  if (botText.match(/connect you|team member|someone will/)) {
    if (isYes) {
      return {
        answer: `I have notified our team. Someone will join this chat shortly. You can also reach us on WhatsApp at +234 813 024 4617 for faster help.`,
        quickReplies: [],
        escalate: true
      };
    } else {
      return {
        answer: `OK! I will keep helping you. What else would you like to know?`,
        quickReplies: ['Pricing', 'Our services']
      };
    }
  }

  // Bot asked "anything else" / "what else"
  if (botText.match(/anything else|what else|more help/)) {
    if (isYes) {
      return {
        answer: `Sure! What would you like to know more about?`,
        quickReplies: ['Pricing', 'Features', 'Talk to human']
      };
    } else {
      return {
        answer: `You are welcome! Have a great day. I am here if you need anything.`,
        quickReplies: []
      };
    }
  }

  // Generic yes/no without clear context
  if (isYes) {
    return {
      answer: `Got it! How else can I help you?`,
      quickReplies: ['Pricing', 'Features', 'Talk to human']
    };
  } else {
    return {
      answer: `No problem. Let me know if you need anything else!`,
      quickReplies: ['Pricing', 'Our services']
    };
  }
}

// Check if a message needs the bot to remember previous context
export function needsContext(message) {
  const lower = message.toLowerCase().trim();
  return /^(yes|no|yeah|yep|ok|okay|sure|nope|nah|maybe|alright|it|that|this|those|them)$/i.test(lower) ||
    lower.match(/^(what about|how about|and |but )/);
}
