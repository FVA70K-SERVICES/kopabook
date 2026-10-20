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

// PUBLIC BOT LOCKDOWN: the public bot (kopabook.com site) talks ONLY about
// KopaBook the product (pricing, features, how to start, support contact).
// It must never answer about any store's private business data
// (products, prices, stock, customers, sales, debts).
export const PUBLIC_LOCKDOWN_ANSWER = 'I can only tell you about KopaBook itself, not any store\'s private business. For product prices, please check with the store directly.';

const BUSINESS_DATA_SIGNALS = [
  'who owes me', 'debtors', 'my stock', 'my customers', 'my sales',
  'find customer', 'my business', 'my inventory', 'my products',
  'customer owes', 'stock level', 'my expenses', 'my staff', 'my debts'
];

export function isBusinessDataQuestion(message) {
  const lower = String(message || '').toLowerCase();
  if (BUSINESS_DATA_SIGNALS.some(s => lower.includes(s))) return true;
  // "how much is X" / "price of X" about a product, not about KopaBook plans
  if (/how much (is|are|does)/.test(lower) && !/kopabook|plan|subscription|starter|pro|solo|pricing/.test(lower)) return true;
  if (/price of /.test(lower) && !/kopabook|plan|subscription/.test(lower)) return true;
  return false;
}

export const KOPABOOK_KNOWLEDGE = [
  {
    // Lockdown entry (backup to the guard in send.js): never discuss private store data
    patterns: ['who owes me', 'debtors', 'my stock', 'my customers', 'my sales', 'find customer', 'my business', 'my inventory', 'my products'],
    answer: PUBLIC_LOCKDOWN_ANSWER,
    quickReplies: ['Pricing', 'Features', 'Talk to human']
  },
  {
    patterns: ['price', 'cost', 'how much', 'pricing', 'fee', 'subscription', 'plan'],
    answer: 'KopaBook is free to start! Here are the plans:\n\n- Free: NGN 0, free forever (1 business, 100 products, 1 staff). Ask Kopa AI: 5 questions a day, read-only\n- Starter: NGN 1,000/month or NGN 10,000/year (5 businesses, 1,000 products, 5 staff). Ask Kopa AI: 20 questions a day plus actions\n- Solo: NGN 5,000/month or NGN 50,000/year (1 business, 500 products, 3 staff, plus an AI worker). Ask Kopa AI: 50 questions a day\n- Pro: NGN 10,000/month or NGN 100,000/year (unlimited businesses, products and staff). Ask Kopa AI: 100 questions a day\n\nYearly plans save you 2 months! Sales are never blocked on any plan. Want help picking one?',
    quickReplies: ['Start free', 'What is Solo?', 'Talk to human']
  },
  {
    patterns: ['what is solo', 'solo plan', 'solo tier', 'ai worker'],
    answer: 'Solo is for single-shop owners who want an AI assistant. For NGN 5,000/month or NGN 50,000/year, Kopa Bot becomes your worker: it briefs you every morning, alerts you when stock runs low, reminds you of tasks, and tracks your targets. Like having staff without the salary!',
    quickReplies: ['Pricing', 'Start free', 'Talk to human']
  },
  {
    patterns: ['what is kopabook', 'about kopabook', 'what does', 'features'],
    answer: 'KopaBook is the best free record book for Nigerian local businesses. Track sales, stock, debts, expenses, staff, and customers, all in one app. What would you like to know more about?',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
  },
  {
    patterns: ['how to start', 'sign up', 'register', 'create account', 'get started'],
    answer: 'Getting started is easy:\n1. Create your free account\n2. Add your business\n3. Start recording sales\n\nNo card needed for the free plan. Want me to guide you?',
    quickReplies: ['Yes, guide me', 'Pricing', 'Talk to human']
  },
  {
    patterns: ['how it works', 'how does it work', 'how do i use', 'tutorial', 'demo', 'show me how', 'guide me'],
    answer: 'KopaBook is simple. First, add your products once. Then record sales as they happen. Then see your whole day clearly on one dashboard. Watch the full 3-minute tour here: https://youtu.be/nJeMpDLDKUo and part 2 here: https://youtu.be/ZlytQSNBwnk',
    quickReplies: ['How to start', 'Pricing', 'Talk to human']
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
    patterns: ['connect website', 'connect my website', 'link website', 'website connect', 'my website'],
    answer: 'You can link your website to KopaBook in Settings, under Connected websites (on desktop). Add your website name and URL, copy the API key, and paste our small snippet on your site. Your website can then show live products, stock, and sales from KopaBook. It is read-only, so your records are always safe.',
    quickReplies: ['Pricing', 'Talk to human']
  },
  {
    patterns: ['hotel', 'rooms', 'guest house', 'booking'],
    answer: 'KopaBook has a hotel section for guest houses: manage rooms and bookings right inside the app. It appears automatically when your business type is set to Hotel or Guest House.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['offline', 'no network', 'internet'],
    answer: 'KopaBook is an online app, so you need an internet connection to record sales and see your latest figures. The good news: the app is light and fast, even on a small data connection.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['whatsapp', 'receipt'],
    answer: 'KopaBook can send receipts and payment reminders via WhatsApp! Keep your customers updated without extra effort.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['staff', 'employee', 'role'],
    answer: 'KopaBook has best-in-class staff roles. Add your staff and control what each person can see and do. Free plan: 1 staff, Starter: 5 staff, Solo: 3 staff, Pro: unlimited.',
    quickReplies: ['Pricing', 'Features']
  },
  {
    patterns: ['debt', 'owing', 'credit', 'customer owing'],
    answer: 'Track who owes you with debt tracking. See all outstanding debts in one list, send reminders on WhatsApp, and record repayments. Never lose track of customer debts again!',
    quickReplies: ['Features', 'Start free']
  },
  {
    patterns: ['stock', 'inventory'],
    answer: 'KopaBook tracks your stock levels automatically. When you make a sale, stock reduces. You get alerts before items run out. Free plan handles 100 products and services, Starter 1,000, Solo 500, Pro unlimited.',
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
    { q: 'Is KopaBook really free?', a: 'Yes! The free plan is free forever. 1 business, 100 products, 1 staff. No card required.' },
    { q: 'Does it work offline?', a: 'KopaBook is an online app and needs an internet connection to save your records. It is light and fast, even on a small data connection.' },
    { q: 'Can I use it for multiple businesses?', a: 'Free: 1 business. Starter: 5. Solo: 1. Pro: unlimited.' },
  ],
  ordering: { enabled: false },
  booking: { enabled: false }
};

// ---------------------------------------------------------------------------
// Merged in-app chat helpers (Ask Kopa AI + Kopa Support, one thread).
// Used only for verified signed-in users on site 'kopabook'. The public
// signed-out bot keeps the lockdown behaviour above.
// ---------------------------------------------------------------------------

// A shop command or business-data ask: recording and reading the shop's own
// records. How-to questions ("how do I record a sale") are platform help,
// not commands, and stay with Kopa Support.
export function isBusinessActionCommand(message) {
  const lower = String(message || '').toLowerCase().trim();
  if (!lower) return false;
  if (/^(how|where|can i|can you show|what is|why)\b/.test(lower) && /record|add|use|find|see/.test(lower) && !lower.includes('record it')) return false;
  if (isBusinessDataQuestion(lower)) return true;
  const patterns = [
    /\bi sold\b/, /\bsold\b.+\bto\b/, /\brecord (it|this|that|a|the)/, /\brecord (a |the |my )?(sale|expense|payment)/,
    /\b(add|log|enter|create|put)\b.+\b(sale|expense|product|stock|customer)\b/,
    /\bspent\b.+\bon\b/, /\bexpense of\b/, /\brestock\b/, /\badd stock\b/,
    /\bhow much did i (sell|make|spend)\b/, /\bhow many sales\b/, /\btoday'?s sales\b/, /\bsales today\b/,
    /\bwho owes\b/, /\bwho is owing\b/, /\bowing me\b/, /\bdebtors?\b/, /\boutstanding balance\b/,
    /\bmy (sales|expenses|profit|stock|products|customers|debts|records)\b/,
    /\bstock (level|count|remaining)\b/, /\bwhat (do i|did i) (have|sell|sold)\b/,
  ];
  return patterns.some((re) => re.test(lower));
}

// A question about KopaBook the platform itself: plans, billing for the app,
// login, bugs, features, how the app works.
const PLATFORM_SIGNALS = [
  'kopabook', 'pricing', 'price of the plan', 'plan', 'subscription', 'upgrade', 'downgrade',
  'billing', 'paystack', 'login', 'log in', 'sign in', 'password', 'forgot',
  'not working', 'bug', 'error message', 'app is', 'the app', 'feature', 'how do i use',
  'how does kopabook', 'refund', 'cancel my', 'delete my account', 'support',
];
export function isPlatformQuestion(message) {
  const lower = String(message || '').toLowerCase();
  if (isBusinessActionCommand(lower) && !/kopabook|plan|subscription|upgrade|pricing/.test(lower)) return false;
  return PLATFORM_SIGNALS.some((s) => lower.includes(s));
}

const FRUSTRATION_PATTERNS = [
  'frustrated', 'frustrating', 'i am angry', "i'm angry", 'this is useless', 'you are useless',
  'not helping', 'waste of time', 'stupid bot', 'rubbish', 'nonsense', 'fed up',
  'you don\'t understand', 'you do not understand', 'for the third time', 'again and again',
];
export function isFrustrated(message) {
  const lower = String(message || '').toLowerCase();
  return FRUSTRATION_PATTERNS.some((p) => lower.includes(p));
}

// Support side answer when a shop command lands there: a clear pointer, with
// a switch action the widget renders as a one-tap button. Never a deflection.
export const BUSINESS_ACTION_POINTER = 'That is a job for Ask Kopa AI, not Kopa Support. Ask Kopa AI works with your shop records: it can record sales and expenses and answer from your own books. Kopa Support is only for questions about KopaBook itself and cannot see or change shop records. Tap Switch to Ask Kopa AI below and send your message there.';

// AI side answer when a platform question lands there: a gentle suggestion,
// never a silent switch.
export const PLATFORM_SUPPORT_SUGGESTION = 'That sounds like a question about KopaBook itself, so Kopa Support is the right side for it. Kopa Support answers platform questions right away, and a person from the FVA70K team can join there when you need one. Tap Switch to Kopa Support below to continue there. Your conversation stays with you.';

// Signed-out pointer: the public bot can never touch shop records.
export const SIGNED_OUT_ACTION_POINTER = 'That is a job for Ask Kopa AI inside the app. Sign in to your KopaBook account, open Chat, and choose Ask Kopa AI: it works with your own shop records and can record sales and expenses for you. This public Kopa Support chat cannot see or change any shop\'s records.';

export function ownerWelcome(fullName) {
  const first = fullName ? String(fullName).split(' ')[0] : 'there';
  return `Welcome back, ${first}. This is one chat with two clear doors. Ask Kopa AI works with your shop: it records sales and expenses and answers from your own records. Kopa Support is for questions about KopaBook itself, with a person from the FVA70K team when you need one. Pick a door below to start. Ask Kopa AI keeps the last 24 hours. Kopa Support conversations are kept as a record, so you and the FVA70K team can always look back at what was said.`;
}

export const SUPPORT_WELCOME = 'Welcome to Kopa Support. This side is for questions about KopaBook itself: pricing, features and problems. A person from the FVA70K team gives the human help here, by hand. Kopa Support cannot see or change your shop records. For sales, expenses and business questions, switch to Ask Kopa AI.';
