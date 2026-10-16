// KopaBook bot knowledge - FVA Bot trained on KopaBook
// This extends the base knowledge with KopaBook-specific answers

export const KOPABOOK_KNOWLEDGE = [
  {
    patterns: ['price', 'cost', 'how much', 'pricing', 'fee', 'subscription', 'plan'],
    answer: 'KopaBook is free to start! Here are the plans:\n\n• Free: 2 businesses, 100 products, 2 staff\n• Starter: NGN 1,000/month or NGN 10,000/year (5 businesses, 1,000 products, 5 staff)\n• Pro: NGN 2,500/month or NGN 25,000/year (unlimited everything)\n\nYearly plans save you 2 months! Sales are never blocked on any plan.',
    quickReplies: ['Start free', 'See features', 'Talk to human']
  },
  {
    patterns: ['what is kopabook', 'about kopabook', 'what does', 'features'],
    answer: 'KopaBook is the best free record book for Nigerian local businesses. Track sales, stock, debts, expenses, staff, and customers, all in one app. It works offline, so no network wahala!',
    quickReplies: ['Pricing', 'How to start', 'Talk to human']
  },
  {
    patterns: ['how to start', 'sign up', 'register', 'create account', 'get started'],
    answer: 'Getting started is easy:\n1. Create your free account\n2. Add your business\n3. Start recording sales\n\nNo card needed for the free plan. Want me to guide you?',
    quickReplies: ['Pricing', 'Features', 'Talk to human']
  },
  {
    patterns: ['offline', 'no network', 'internet'],
    answer: 'Yes! KopaBook works offline. Record your sales even without network, and everything syncs when you\'re back online. Perfect for shops with unstable network.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['whatsapp', 'receipt'],
    answer: 'KopaBook can send receipts and payment reminders via WhatsApp! Keep your customers updated without extra effort.',
    quickReplies: ['Features', 'Pricing']
  },
  {
    patterns: ['staff', 'employee', 'role'],
    answer: 'KopaBook has best-in-class staff roles. Add your staff, control what each person can see and do. Free plan: 2 staff, Starter: 5 staff, Pro: unlimited.',
    quickReplies: ['Pricing', 'Features']
  },
  {
    patterns: ['debt', 'owing', 'credit', 'customer owing'],
    answer: 'Track who owes you with KopaBook\'s debt tracking. See all outstanding debts, send reminders, and record repayments. Never lose track of customer debts again!',
    quickReplies: ['Features', 'Start free']
  },
  {
    patterns: ['stock', 'inventory'],
    answer: 'KopaBook tracks your stock levels automatically. When you make a sale, stock reduces. Get alerts when items run low. Free plan handles 100 products+services, Starter 1,000, Pro unlimited.',
    quickReplies: ['Pricing', 'Start free']
  },
  {
    patterns: ['support', 'help', 'problem', 'issue', 'not working', 'bug'],
    answer: 'Sorry you\'re having trouble! I\'ve flagged this for our support team. You can also reach us on WhatsApp at +234 813 024 4617 for faster help.',
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
    { q: 'Does it work offline?', a: 'Yes, KopaBook works offline and syncs when you\'re back online.' },
    { q: 'Can I use it for multiple businesses?', a: 'Free: 2 businesses. Starter: 5. Pro: unlimited.' },
  ],
  ordering: { enabled: false },
  booking: { enabled: false }
};
