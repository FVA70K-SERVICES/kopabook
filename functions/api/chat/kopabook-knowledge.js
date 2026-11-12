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

// A how-to question ("how do I remind a customer who owes me",
// "how do I send a receipt on WhatsApp") is platform help, not a
// business-data ask and not a shop command. Without this exemption
// the words "who owes me" inside a how-to question hit the lockdown
// answer, which is wrong: the visitor is asking how the feature
// works, not for any store's private data.
export function isHowToQuestion(message) {
  const lower = String(message || '').toLowerCase().trim();
  return /^(how do i|how can i|how to|how do you|can you show me how|show me how)\b/.test(lower);
}

export function isBusinessDataQuestion(message) {
  const lower = String(message || '').toLowerCase();
  if (isHowToQuestion(lower)) return false;
  if (BUSINESS_DATA_SIGNALS.some(s => lower.includes(s))) return true;
  // "how much is X" / "price of X" about a product, not about KopaBook plans
  if (/how much (is|are|does)/.test(lower) && !/kopabook|plan|subscription|starter|pro|solo|pricing|cost|start|free/.test(lower)) return true;
  if (/price of /.test(lower) && !/kopabook|plan|subscription|cost|start/.test(lower)) return true;
  return false;
}

export const KOPABOOK_KNOWLEDGE = [
  {
    // Debtor-reminder how-to. This entry MUST stay before the lockdown
    // entry below: the phrase "who owes me" inside a how-to question
    // would otherwise match the lockdown patterns and answer wrongly.
    // Kopa Support cannot see any shop's debtors, so it points to Ask
    // Kopa AI and the Debts page instead of naming anyone.
    patterns: ['how do i remind a customer', 'how to remind a customer', 'remind a customer who owes', 'remind a debtor', 'send a reminder to a customer', 'chase a debtor', 'payment reminder', 'remind customers who owe', 'how do i send a reminder'],
    answer: 'To remind a customer who owes you, open your KopaBook app, go to Debts, open the customer, and tap the WhatsApp reminder button: it sends them a polite message with what they owe. You can also switch to Ask Kopa AI here and say "remind Favour of the balance on WhatsApp" and it will draft the message for you. This Kopa Support chat cannot see your customers or what anyone owes.',
    quickReplies: ['Features', 'Talk to human']
  },
  {
    // Expense how-to. These two entries MUST stay before the generic
    // "how do I record" entry and the pay-with-card entry below: both
    // of those match on a shared word ("record", "payment") and would
    // answer a payment/expense how-to with the sale steps or the
    // subscription payment text instead. Bare "record an expense" is
    // a shop command and routes to Ask Kopa AI; only the "how do I"
    // phrasing reaches here.
    patterns: ['how do i record an expense', 'how to record an expense', 'how do i add an expense', 'how to add an expense', 'how do i log an expense', 'how to log an expense'],
    answer: 'To record an expense, open your KopaBook app, go to Expenses, tap New Expense, add what you spent on and the amount, and save it. Your expense shows on the Dashboard right away, and Ask Kopa AI here can record it for you too: switch to Ask Kopa AI and say "I spent 5,000 on transport today".',
    quickReplies: ['Features', 'How to start', 'Talk to human']
  },
  {
    // Payment-recording how-to: KopaBook records payments, it never
    // takes or collects them.
    patterns: ['how do i record a payment', 'how to record a payment', 'how do i record a customer payment', 'how to record a customer payment', 'how do i record payment'],
    answer: 'To record a payment from a customer, switch to Ask Kopa AI here and say who paid and how much, for example "Favour paid 10,000 today", then tap Confirm. Or open Debts in the app, open the customer, and record the payment there. KopaBook records the payment and updates what the customer owes. It never takes or collects money itself.',
    quickReplies: ['Features', 'How to start', 'Talk to human']
  },
  {
    // Lockdown entry (backup to the guard in send.js): never discuss private store data
    patterns: ['who owes me', 'debtors', 'my stock', 'my customers', 'my sales', 'find customer', 'my business', 'my inventory', 'my products'],
    answer: PUBLIC_LOCKDOWN_ANSWER,
    quickReplies: ['Pricing', 'Features', 'Talk to human']
  },
  {
    patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'],
    answer: 'Hello! I am Kopa Bot, your KopaBook assistant. I can help with pricing, features like sales and stock, staff and upgrades, or any problem you are having. What would you like to do first?',
    quickReplies: ['Pricing', 'Features', 'How to start', 'Talk to human']
  },
  {
    patterns: ['broken', 'phone broke', 'app broke', 'app is broken'],
    answer: 'Sorry about that. I have flagged this for our support team and someone will look into it. For the fastest help, WhatsApp us at +234 813 024 4617.',
    escalate: true,
    quickReplies: ['Talk to human']
  },
  {
    patterns: ['don\'t have money', 'dont have money', 'do not have money', 'no money', 'not have money', 'cannot afford', 'can\'t afford', 'cant afford', 'no cash', 'without money', 'zero money', 'i am broke', 'broke', 'free to start', 'start free', 'start for free', 'want to start', 'i want to start'],
    answer: 'Good news, you do not need money to start. KopaBook is free to start, and the Free plan is NGN 0, free forever, with 1 business, 100 products and 1 staff, and no card needed. Recording a sale is never blocked on any plan, and recording sales is unlimited, even on Free. Start today in three steps: 1. Create your free account. 2. Add your business. 3. Start recording sales. You only upgrade later, when you want more, Starter NGN 1,000 a month, Solo NGN 5,000 a month, Pro NGN 10,000 a month. Want me to guide you to start free?',
    quickReplies: ['How to start', 'Pricing', 'Talk to human']
  },
  {
    patterns: ['pay with card', 'can i pay', 'do you take payment', 'do you accept payment', 'card payment', 'how do i pay', 'pay for kopabook', 'pay for subscription', 'pay for a plan', 'payment'],
    answer: 'KopaBook records payments and never takes, processes, or collects payment, except its own Paystack subscription checkout. You pay for your KopaBook subscription securely by Paystack, and that checkout is only for your KopaBook plan. For money from your customers, KopaBook records the sale and the payment, it does not collect the money itself.',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
  },
  {
    patterns: ['loan', 'borrow money', 'lend me money'],
    answer: 'KopaBook does not give loans. KopaBook is a record book: it records sales, stock, debts, expenses, staff, and customers, so you can see who owes you clearly. If you need help with debt records, ask about features, or talk to a person on our team.',
    quickReplies: ['Features', 'Talk to human']
  },
  {
    patterns: ['cancel my subscription', 'cancel subscription', 'cancel my plan', 'cancel plan', 'stop my subscription', 'unsubscribe'],
    answer: 'To cancel, sign in, open Settings, open your plan card, and tap Cancel subscription. Your plan stays active until the end of the period you already paid for. Bank transfer and crypto payments do not renew, so there is nothing to cancel for those. If you need help, WhatsApp us at +234 813 024 4617 or email info@kopabook.com.',
    quickReplies: ['Pricing', 'Talk to human']
  },
  {
    patterns: ['delete my account', 'delete account', 'close my account'],
    answer: 'To delete your KopaBook account, contact our support team at info@kopabook.com or on WhatsApp at +234 813 024 4617 and ask for account deletion, with the email on the account. Our team will confirm with you before anything is deleted. There is no self delete button in the app to tap by mistake.',
    quickReplies: ['Talk to human']
  },
  {
    patterns: ['how do i record', 'how to record', 'how do i record a sale', 'how to record a sale'],
    answer: 'Recording a sale is simple:\n1. Open your KopaBook app\n2. Tap New Sale\n3. Add the product, quantity, and amount\n4. Save it\n\nYour sale shows on the Dashboard right away. Recording a sale is never blocked on any plan, even on Free. Want me to guide you?',
    quickReplies: ['How to start', 'Pricing', 'Talk to human']
  },
  {
    // Receipt how-to, before the generic WhatsApp/receipt entry below:
    // "how do I send a receipt on WhatsApp" must get steps, not the
    // one-line feature mention.
    patterns: ['how do i send a receipt', 'how to send a receipt', 'send a receipt', 'share a receipt', 'receipt on whatsapp', 'receipt by email', 'print a receipt', 'print receipt', 'email a receipt'],
    answer: 'To send a receipt, open your KopaBook app, go to Sales, open the sale, and tap Share. You can send it on WhatsApp, by email, or print it. The receipt shows your business name, the items, the total, and what was paid.',
    quickReplies: ['Features', 'How to start', 'Talk to human']
  },
  {
    // WhatsApp contact, before the generic WhatsApp entry below.
    patterns: ['whatsapp number', 'whatsapp us', 'chat on whatsapp', 'whatsapp contact', 'your whatsapp', 'whatsapp line'],
    answer: 'You can reach us on WhatsApp at +234 813 024 4617. We reply quickly!',
    quickReplies: ['Talk to human', 'Features']
  },
  {
    // A reminder for yourself: Ask Kopa AI sets it, Kopa Support cannot.
    patterns: ['set a reminder', 'remind me', 'remind me to', 'set reminder'],
    answer: 'To set a reminder for yourself, switch to Ask Kopa AI here and say "remind me to ..." with what you want to be reminded about. Ask Kopa AI works with your own shop and keeps your reminders. Kopa Support cannot set reminders for you.',
    quickReplies: ['Features', 'Talk to human']
  },
  {
    // Product and stock how-to, before the generic stock entry below.
    patterns: ['how do i add a product', 'how to add a product', 'how do i add stock', 'how to add stock', 'how do i restock', 'how to restock', 'low stock alert', 'how do i set a low stock alert'],
    answer: 'To add a product, open your KopaBook app, go to Products, tap New Product, add the name, price and opening stock, and save it. To add stock later, open the product and tap Add Stock. When stock runs low, KopaBook alerts you before it runs out. Free plan handles 100 products, Starter 1,000, Solo 500, Pro unlimited.',
    quickReplies: ['Features', 'Pricing', 'Talk to human']
  },
  {
    // Customer how-to.
    patterns: ['how do i add a customer', 'how to add a customer', 'how do i find a customer', 'how to find a customer'],
    answer: 'To add a customer, open your KopaBook app, go to Customers, tap New Customer, add the name and phone number, and save it. To find one later, open Customers and search by name. When you record a sale, you can pick the customer so their debt is tracked.',
    quickReplies: ['Features', 'How to start', 'Talk to human']
  },
  {
    // Staff how-to, before the generic staff entry below: "how do I add
    // staff" must get steps and plan limits, not the one-line mention.
    patterns: ['how do i add staff', 'how to add staff', 'how do i add a staff member', 'staff roles', 'staff permissions', 'staff role', 'what can staff do'],
    answer: 'To add staff, sign in, open Settings, open Staff accounts, and invite the person by name and phone number. You control what each person can see and do: owners see everything, staff see only what you allow, for that business only. Free plan allows 1 staff, Starter 5, Solo 3, Pro unlimited.',
    quickReplies: ['Pricing', 'Features', 'Talk to human']
  },
  {
    // Project how-to.
    patterns: ['how do i create a project', 'how to create a project', 'create a project', 'add a project', 'project'],
    answer: 'To create a project, open your KopaBook app, go to Projects, tap New Project, add the name and budget, and save it. You can record income and expenses against the project and see what it has spent and what is left. Ask Kopa AI here can also create and list your projects for you.',
    quickReplies: ['Features', 'How to start', 'Talk to human']
  },
  {
    // Plan specifics, before the generic price entry below: "what is
    // the Starter plan" must get the Starter answer, not the full
    // price list.
    patterns: ['what is starter', 'starter plan', 'what is the starter plan', 'what is pro', 'pro plan', 'what is the pro plan', 'free plan', 'what is the free plan', 'what is free plan'],
    answer: 'Free is NGN 0, free forever: 1 business, 100 products, 1 staff, Ask Kopa AI 5 questions a day, read-only. Starter is NGN 1,000 a month or NGN 10,000 a year: 5 businesses, 1,000 products, 5 staff, Ask Kopa AI 20 questions a day plus actions. Pro is NGN 10,000 a month or NGN 100,000 a year: unlimited businesses, products and staff, Ask Kopa AI 100 questions a day. Recording a sale is never blocked on any plan. Want help picking one?',
    quickReplies: ['Pricing', 'Start free', 'Talk to human']
  },
  {
    // Login help, before the generic support entry below ("sign in
    // problem" contains "problem", which that entry would match).
    patterns: ['forgot password', 'reset password', 'forgot my password', 'cannot log in', 'cant log in', "can't log in", 'can not log in', 'sign in problem', 'login problem', 'log in problem', 'i cannot sign in', 'i cant sign in', "i can't sign in", 'cannot sign in'],
    answer: 'If you forgot your password, open the KopaBook sign-in screen and tap Forgot password, then follow the link we send to your email to set a new one. If you still cannot sign in, WhatsApp us at +234 813 024 4617 with the email on the account and we will help you get back in.',
    quickReplies: ['Talk to human', 'How to start']
  },
  {
    // Stuck: loose phrasing for "I cannot do this". This is the
    // knowledge fallback for the same phrasing the shortcut answers
    // first in getKopaBookResponse.
    patterns: ["can't do", 'cant do', 'cannot do', 'can not do', 'stuck', 'confused', "don't understand", 'dont understand', 'do not understand', 'i cant do', 'i cannot do'],
    answer: 'No problem, let us take it one step at a time. Tell me what you were trying to do, in your own words, and I will walk you through it. Or tap Talk to human and a person from the FVA70K team will help you right away.',
    quickReplies: ['Talk to human', 'How to start', 'Features']
  },
  {
    // "Done, what next": the visitor finished a step and wants the
    // next one, not a repeat of the intro.
    patterns: ['done next', 'what next', 'what is next', 'whats next', "what's next", 'next step', 'next steps', 'what now'],
    answer: 'Good, here is what to do next: 1. Add your products, if you have not yet. 2. Record your first sale. 3. Check your Dashboard to see the day clearly. If you get stuck at any step, tell me which one and I will walk you through it.',
    quickReplies: ['How to start', 'Features', 'Talk to human']
  },
  {
    patterns: ['what is my balance', 'my balance', 'check my balance', 'balance'],
    answer: 'For your own shop balance, sign in to your KopaBook account, open Chat, and choose Ask Kopa AI: it works with your own shop records and can tell you your balance there. This public Kopa Support chat cannot see or change any shop records. If you are already signed in, switch to Ask Kopa AI and ask there.',
    quickReplies: ['Pricing', 'Talk to human']
  },
  {
    patterns: ['thank you', 'thanks', 'bye', 'goodbye'],
    answer: 'You are welcome! I am here whenever you need help with KopaBook. Have a great day with your business.',
    quickReplies: ['Pricing', 'Features', 'How to start']
  },
  {
    patterns: ['explain kopabook', 'tell me about kopabook'],
    answer: 'KopaBook is the free record book for Nigerian local businesses. It records sales, stock, debts, expenses, staff, and customers, all in one app. It is free to start, with no card needed, and recording a sale is never blocked on any plan. What would you like to know more about?',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
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
    patterns: ['how to start', 'how do i start', 'how can i start', 'how do i get started', 'how to begin', 'how do i begin', 'sign up', 'register', 'create account', 'get started'],
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
    patterns: ['team', 'upgrade', 'upgrading', 'renew', 'renewal', 'free pro', 'pro month', 'add staff', 'add worker', 'staff account'],
    answer: 'Good, team and upgrade is exactly what I can help with. For your team: Free plan allows 1 staff, Starter allows 5 staff, Solo allows 3 staff, and Pro allows unlimited staff. You add staff in Settings, under Staff accounts, and you control what each person can see and do. For upgrade: Starter is NGN 1,000 a month, Solo is NGN 5,000 a month, and Pro is NGN 10,000 a month or NGN 100,000 a year, with unlimited businesses, products and staff, and Ask Kopa AI 100 questions a day. You pay securely by Paystack for your KopaBook subscription only, and your plan activates immediately after payment. Recording a sale is never blocked on any plan, and recording sales is unlimited, even on Free. Nothing stops a sale from being recorded, on Free or on any paid plan. Want help picking a plan, or adding your first staff member?',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
  },
  {
    patterns: ['owner settings', 'business settings', 'settings', 'brand color', 'tagline', 'share card', 'business profile'],
    answer: 'Owner settings are in Settings, for the business owner only. There you can see your plan, price and renew date, how many businesses, products and staff you have used, and your store branding. Your brand color and tagline appear on the share cards you send on WhatsApp, so check the preview before you save. Only the owner can change plan, payment, branding and business profile. Staff can see only what the owner allows them to see, for that business only.',
    quickReplies: ['Pricing', 'Talk to human']
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
  if (isHowToQuestion(lower)) return false;
  if (/^(how|where|can i|can you show|what is|why)\b/.test(lower) && /record|add|use|find|see|remind|send|share/.test(lower) && !lower.includes('record it')) return false;
  if (isBusinessDataQuestion(lower)) return true;
  const patterns = [
    /\bi sold\b/, /\bsold\b.+\bto\b/, /\brecord (it|this|that|a|the)/, /\brecord (a |the |my )?(sale|expense|payment)/,
    /\b(add|log|enter|create|put)\b.+\b(sale|expense|product|stock|customer)\b/,
    /\bspent\b.+\bon\b/, /\bexpense of\b/, /\brestock\b/, /\badd stock\b/,
    /\bhow much did i (sell|make|spend)\b/, /\bhow many sales\b/, /\btoday'?s sales\b/, /\bsales today\b/,
    /\bhow much profit\b/, /\bmy profit\b/, /\bprofit (this|last) (year|month|week)\b/,
    /\bwho owes\b/, /\bwho is owing\b/, /\bowing me\b/, /\bdebtors?\b/, /\boutstanding balance\b/,
    /\bmy balance\b/, /\bbalance\b/, /\bsend (a )?reminder\b/, /\bremind\b.+\b(customer|debtor)\b/,
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
// Business planning is Ask Kopa AI's job, not Kopa Support's: "let's plan",
// "plan to improve the business", "business planning for next month".
// The bare word "plan" must not deflect those. A subscription tier
// ("my plan", "the pro plan", "how much does a plan cost") still
// deflects, so the exemption never applies when "plan" is named as a
// tier. The one exception is the current-plan question ("what plan am
// I on"): Ask Kopa AI answers that one itself from the snapshot tier,
// so it is exempted below and never deflects.
const BUSINESS_PLANNING_WORDS = /\b(improve|improvement|grow|growth|business|stock|sales?|profit|revenue|customers?|expenses?|marketing|strategy|debts?|next month|this month)\b/;
const SUBSCRIPTION_PLAN = /\b(my|your|the|this|that|a|an|what|which)\s+(pro\s+|starter\s+|solo\s+|free\s+)?plans?\b/;
// The one plan question Ask Kopa AI answers itself: which plan this
// business is on. The tier comes from the snapshot inside Ask Kopa AI,
// so it never deflects to Kopa Support. Every other plan question
// (change plan, plan prices, cancel plan) still deflects.
const CURRENT_PLAN_QUESTION = /\bwhat (plan|tier|subscription) (am i|are we) on\b|\bwhich (plan|tier) (am i|are we) on\b|\bwhat is my (plan|tier|subscription)\b|\bam i on (the )?(free|starter|solo|pro)( plan| tier)?\b|\bwhich plan do i have\b|\bmy current (plan|tier)\b/;

export function isPlatformQuestion(message) {
  const lower = String(message || '').toLowerCase();
  if (isBusinessActionCommand(lower) && !/kopabook|plan|subscription|upgrade|pricing/.test(lower)) return false;
  if (CURRENT_PLAN_QUESTION.test(lower)) return false;
  const isBusinessPlanning =
    /\blet'?s plan\b/.test(lower) ||
    /\blet us plan\b/.test(lower) ||
    (/\b(plan|planning)\b/.test(lower) && BUSINESS_PLANNING_WORDS.test(lower));
  if (isBusinessPlanning && !SUBSCRIPTION_PLAN.test(lower)) return false;
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

// ---------------------------------------------------------------------------
// Support shortcuts (round 9). The chips the bot shows (1 Pricing, 2
// Features, 3 How to start, 4 Talk to human) are only useful if a bare
// number answers them, and loose phrasing ("I can't do some more",
// "Done next") must be understood the way a person would understand
// it. These run before knowledge matching in getKopaBookResponse, so a
// bare number never repeats the intro and a stuck visitor never gets
// the failure line when the knowledge base can answer.
// ---------------------------------------------------------------------------

// Word-boundary matcher, same rule as send.js: bare substrings caused
// live false hits ('hi' in 'this', 'fee' in 'feel').
function matchesKnowledgePattern(lower, pattern) {
  const p = String(pattern || '').toLowerCase().trim();
  if (!p) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped + '\\b').test(lower);
}

function findKnowledgeAnswer(pattern) {
  const entry = KOPABOOK_KNOWLEDGE.find((e) => (e.patterns || []).includes(pattern));
  if (!entry) return null;
  return {
    answer: entry.answer,
    quickReplies: entry.quickReplies ? [...entry.quickReplies] : [],
    escalate: entry.escalate || false,
    confidence: 'high',
  };
}

function nextStepsReply() {
  const r = findKnowledgeAnswer('done next');
  return r || {
    answer: 'Good, here is what to do next: 1. Add your products, if you have not yet. 2. Record your first sale. 3. Check your Dashboard to see the day clearly. If you get stuck at any step, tell me which one and I will walk you through it.',
    quickReplies: ['How to start', 'Features', 'Talk to human'],
    escalate: false,
    confidence: 'high',
  };
}

function stuckReply() {
  const r = findKnowledgeAnswer("can't do");
  return r || {
    answer: 'No problem, let us take it one step at a time. Tell me what you were trying to do, in your own words, and I will walk you through it. Or tap Talk to human and a person from the FVA70K team will help you right away.',
    quickReplies: ['Talk to human', 'How to start', 'Features'],
    escalate: false,
    confidence: 'high',
  };
}

// A bare chip number (1 Pricing, 2 Features, 3 How to start, 4 Talk to
// human) answers with that chip's content, never the intro again.
export function supportChipReply(n) {
  if (n === 1) return findKnowledgeAnswer('pricing');
  if (n === 2) return findKnowledgeAnswer('features');
  if (n === 3) return findKnowledgeAnswer('how to start');
  if (n === 4) return getEscalationResponse('talk to human');
  return null;
}

export function resolveSupportShortcut(message) {
  const lower = String(message || '').toLowerCase().trim();
  if (!lower) return null;
  const num = lower.match(/^(\d)\s*[.!?]*$/);
  if (num) return supportChipReply(Number(num[1]));
  if (lower === 'done' || lower === 'done.' || /\b(done next|what next|what is next|whats next|what's next|next steps?|what now)\b/.test(lower)) return nextStepsReply();
  if (/\b(can't do|cant do|cannot do|can not do|stuck|confused|don't understand|dont understand|do not understand)\b/.test(lower)) return stuckReply();
  if (lower === 'start free' || lower === 'start for free') return findKnowledgeAnswer('how to start');
  return null;
}

// True when the knowledge base answers this message deterministically
// (a shortcut, or any hardcoded entry). bot-ai.js uses this to skip
// the model for questions the rules already answer.
export function isSupportDeterministic(message) {
  if (resolveSupportShortcut(message)) return true;
  const lower = String(message || '').toLowerCase().trim();
  if (!lower) return false;
  for (const entry of KOPABOOK_KNOWLEDGE) {
    for (const pattern of (entry.patterns || [])) {
      if (pattern && matchesKnowledgePattern(lower, pattern)) return true;
    }
  }
  return false;
}
