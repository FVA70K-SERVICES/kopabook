// Kopa Bot knowledge - trained on KopaBook
// The bot's SOUL lives here: who it is, how it speaks, what it knows.
// Knowledge also lives in the D1 table `bot_knowledge` (loaded at request
// time). D1 rows win over this file, so new features can be taught to the
// bot without a code deploy. This file is the fallback seed.

export const KOPA_SOUL = {
  name: 'Kopa Bot',
  role: 'the friendly assistant for KopaBook, the free record book for Nigerian local businesses',
  tone: 'Warm, simple, encouraging. Short answers in plain English with a light Nigerian flavor. Never cold, never robotic.',
  rules: [
    'Never guess. If unsure, ask a warm clarifying question.',
    'Keep answers short (2-3 sentences) unless explaining steps.',
    'Use naira amounts like NGN 1,000.',
    'No em dashes, no asterisks, no markdown formatting.',
    'If the visitor is upset or asks for a human, hand over kindly and fast.',
    'Remember the visitor name when they share it, and use it warmly.',
  ],
};

// Checked FIRST, before any knowledge matching. "Talk to human" must work.
const ESCALATION_PATTERNS = [
  'talk to human', 'talk to someone', 'speak to someone', 'speak to a human',
  'human', 'live agent', 'real person', 'someone real', 'real agent',
  'agent', 'support team', 'call me', 'phone me', 'contact you',
];

export function getEscalationResponse(message, visitorName) {
  const lower = String(message || '').toLowerCase();
  if (!ESCALATION_PATTERNS.some((p) => lower.includes(p))) return null;
  const name = visitorName && visitorName !== 'Visitor' ? ` ${visitorName}` : '';
  return {
    answer: `Of course${name}! I have let our team know and someone will join this chat shortly. For the fastest help, you can also WhatsApp us right now at +234 813 024 4617.`,
    quickReplies: ['Switch to WhatsApp'],
    escalate: true,
    confidence: 'high',
  };
}

// "my name is Ada", "i am Chidi", "call me Bola" -> "Ada"
export function detectName(message) {
  const m = String(message || '').trim().match(
    /^(?:my name is|i am|i'm|call me)\s+([a-zA-Z][a-zA-Z' -]{1,40})$/
  );
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, ' ');
}

export function nameWelcome(name) {
  return {
    answer: `Nice to meet you, ${name}! I am Kopa Bot, and I know KopaBook inside out. Ask me about pricing, features like sales and stock, or any problem you are having.`,
    quickReplies: ['Pricing', 'Features', 'How to start'],
    confidence: 'high',
  };
}

// Warm clarifiers: the bot's HEART when it does not understand.
export const WARM_CLARIFIERS = [
  'Hmm, I want to make sure I give you the right answer. Are you asking about our pricing, what KopaBook can do, or how to get started?',
  'Tell me a little more so I can help you well. I know all about pricing, features like sales and stock, or any problem you are having.',
  'I want to get this right for you. Is it about your business records, our plans, or something else?',
];

export const KOPABOOK_KNOWLEDGE = [
  {
    patterns: ['price', 'cost', 'how much', 'pricing', 'fee', 'subscription', 'plan'],
    answer: 'KopaBook is free to start! Here are the plans:\n\n- Free: 2 businesses, 100 products, 2 staff (free forever)\n- Starter: NGN 1,000/month (5 businesses, 1,000 products, 5 staff)\n- Solo: NGN 5,000/month (1 business plus an AI worker)\n- Pro: NGN 2,500/month (unlimited everything)\n\nYearly plans save you 2 months! Sales are never blocked on any plan. Want help picking one?',
    quickReplies: ['Start free', 'What is Solo?', 'Talk to human']
  },
  {
    patterns: ['what is solo', 'solo plan', 'solo tier', 'ai worker'],
    answer: 'Solo is for single-shop owners who want an AI assistant. For NGN 5,000/month, Kopa Bot becomes your worker: it briefs you every morning, alerts you when stock runs low, reminds you of tasks, and tracks your targets. Like having staff without the salary!',
    quickReplies: ['Pricing', 'Start free', 'Talk to human']
  },
  {
    patterns: ['what is kopabook', 'about kopabook', 'what does', 'features'],
    answer: 'KopaBook is the best free record book for Nigerian local businesses. Track sales, stock, debts, expenses, staff, and customers, all in one app. It works offline, so no network wahala! What would you like to know more about?',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
  },
  {
    patterns: ['how to start', 'sign up', 'register', 'create account', 'get started'],
    answer: 'Getting started is easy:\n1. Create your free account\n2. Add your business\n3. Start recording sales\n\nNo card needed for the free plan. Want me to guide you?',
    quickReplies: ['Yes, guide me', 'Pricing', 'Talk to human']
  },
  {
    patterns: ['notebook', 'notes', 'note '],
    answer: 'The Notebook (under Tools in the app) keeps your business thinking in one place. Give notes colors, pin important ones to the top, and search everything instantly. Private notes are only for your eyes, not even the business owner can see them. Shared notes everyone in the business can read, and owners or partners can edit them.',
    quickReplies: ['Features', 'How to start']
  },
  {
    patterns: ['calculator', 'change due'],
    answer: 'There is a built-in calculator under Tools in the app. It has a change-due helper: enter the total and what the customer gave you, and it tells you the exact change. No more wrong change at the till!',
    quickReplies: ['Features', 'How to start']
  },
  {
    patterns: ['api', 'developer', 'integration', 'api key'],
    answer: 'Yes! KopaBook has a developer API. Owners and partners can create API keys in Settings (on desktop). The API is read-only and lets your own apps or website read your sales, products, debts, and expenses securely.',
    quickReplies: ['Pricing', 'Talk to human']
  },
  {
    patterns: ['hotel', 'rooms', 'guest house', 'booking'],
    answer: 'KopaBook has a hotel section for guest houses: manage rooms and bookings right inside the app. It appears automatically when your business type is set to Hotel or Guest House.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['offline', 'no network', 'internet'],
    answer: 'Yes! KopaBook works offline. Record your sales even without network, and everything syncs when you are back online. Perfect for shops with unstable network.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['whatsapp', 'receipt'],
    answer: 'KopaBook can send receipts and payment reminders via WhatsApp! Keep your customers updated without extra effort.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['staff', 'employee', 'role'],
    answer: 'KopaBook has best-in-class staff roles. Add your staff and control what each person can see and do. Free plan: 2 staff, Starter: 5 staff, Pro: unlimited.',
    quickReplies: ['Pricing', 'Features']
  },
  {
    patterns: ['debt', 'owing', 'credit', 'customer owing'],
    answer: 'Track who owes you with debt tracking. See all outstanding debts in one list, send reminders on WhatsApp, and record repayments. Never lose track of customer debts again!',
    quickReplies: ['Features', 'Start free']
  },
  {
    patterns: ['stock', 'inventory'],
    answer: 'KopaBook tracks your stock levels automatically. When you make a sale, stock reduces. You get alerts before items run out. Free plan handles 100 products and services, Starter 1,000, Pro unlimited.',
    quickReplies: ['Pricing', 'Start free']
  },
  {
    patterns: ['refund'],
    answer: 'Paid plans come with a 7-day refund policy, no stories. If you are not happy within 7 days of paying, just ask and we will sort it out.',
    quickReplies: ['Pricing', 'Talk to human']
  },
  {
    patterns: ['contact', 'reach you', 'phone number', 'email address'],
    answer: 'You can reach us anytime at info@kopabook.com, or faster on WhatsApp at +234 813 024 4617. We reply quickly!',
    quickReplies: ['Talk to human', 'Features']
  },
  {
    patterns: ['support', 'help', 'problem', 'issue', 'not working', 'bug'],
    answer: 'Sorry you are having trouble! I have flagged this for our support team and someone will look into it. For the fastest help, WhatsApp us at +234 813 024 4617.',
    escalate: true,
    quickReplies: ['Talk to human']
  },
];

export const KOPABOOK_MEMORY = {
  businessName: 'KopaBook',
  botName: 'Kopa Bot',
  currency: 'NGN',
  hours: {
    monday: '24/7 (app always available)',
    tuesday: '24/7',
    wednesday: '24/7',
    thursday: '24/7',
    friday: '24/7',
    saturday: '24/7',
    sunday: '24/7'
  },
  products: [],
  services: [],
  faqs: [
    { q: 'Is KopaBook really free?', a: 'Yes! The free plan is free forever. 2 businesses, 100 products, 2 staff. No card required.' },
    { q: 'Does it work offline?', a: 'Yes, KopaBook works offline and syncs when you are back online.' },
    { q: 'Can I use it for multiple businesses?', a: 'Free: 2 businesses. Starter: 5. Pro: unlimited.' },
  ],
  ordering: { enabled: false },
  booking: { enabled: false }
};
