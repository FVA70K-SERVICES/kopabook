// FVA Bot - intelligent auto-responder for FVAChat
// Handles common questions automatically, escalates to humans when needed

const KNOWLEDGE = [
  {
    patterns: ['price', 'cost', 'how much', 'pricing', 'fee', 'charge'],
    answer: 'Our Premium Website package is NGN 350,000 for the first year (domain + hosting + build + 12 months maintenance). Right now there\'s a 40% first-purchase discount, so it\'s NGN 210,000. We also have a Starter Website at NGN 99,000. Want a detailed quote?',
    quickReplies: ['Get a quote', 'What\'s included?', 'Talk to human']
  },
  {
    patterns: ['what is included', 'what\'s included', 'include', 'package'],
    answer: 'Every Premium Website includes: custom design, mobile-responsive pages, domain registration, fast hosting, professional email, contact forms, WhatsApp integration, Google Maps, SEO setup, and 12 months of FVA70K Care (monitoring, updates, security, support).',
    quickReplies: ['Get a quote', 'See our work', 'Talk to human']
  },
  {
    patterns: ['how long', 'timeline', 'duration', 'when will', 'delivery'],
    answer: 'A standard website takes 2-3 weeks from when we receive your content. We also offer a free 5-day demo so you can see your website before committing.',
    quickReplies: ['Get free demo', 'Start project', 'Talk to human']
  },
  {
    patterns: ['demo', 'sample', 'preview', 'try'],
    answer: 'We offer a free 5-working-day demo! We\'ll build a preview of your website so you can see exactly what you\'re getting. No payment needed for the demo. Want to start one?',
    quickReplies: ['Yes, start demo', 'Get a quote', 'Talk to human']
  },
  {
    patterns: ['book', 'call', 'appointment', 'meeting', 'speak'],
    answer: 'You can book a free consultation call with us. We\'ll discuss your project, answer questions, and give you a clear plan. Want me to direct you to the booking page?',
    quickReplies: ['Book a call', 'Get a quote', 'Talk to human']
  },
  {
    patterns: ['email', 'fvamail', 'mail'],
    answer: 'FVAMail is our professional email service. You get you@yourbusiness.com addresses with generous storage, accessible anywhere. Plans start at NGN 1,500/month. Every website client gets professional email included.',
    quickReplies: ['See FVAMail plans', 'Get a quote', 'Talk to human']
  },
  {
    patterns: ['hosting', 'host', 'domain'],
    answer: 'We handle domain registration and fast, secure hosting for you. Your website loads quickly and stays online. Hosting is included in all our packages for the first year.',
    quickReplies: ['Get a quote', 'Talk to human']
  },
  {
    patterns: ['maintenance', 'care', 'support', 'update'],
    answer: 'FVA70K Care is our maintenance and support plan. It includes 24/7 monitoring, security updates, regular backups, content updates, and priority support. Tier 1 is included for 12 months with every Premium Website.',
    quickReplies: ['See Care plans', 'Get a quote', 'Talk to human']
  },
  {
    patterns: ['human', 'agent', 'person', 'real', 'someone', 'talk to'],
    answer: 'Of course! I\'ve notified our team. Someone will join this chat shortly. In the meantime, you can also reach us on WhatsApp at +234 813 024 4617.',
    escalate: true,
    quickReplies: []
  },
  {
    patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'],
    answer: 'Hello! Welcome to FVA70K Services. I\'m FVA Bot. I can help you with pricing, our services, booking a demo, or connecting you with our team. What would you like to know?',
    quickReplies: ['Pricing', 'Our services', 'Free demo', 'Talk to human']
  },
  {
    patterns: ['thank', 'thanks', 'great', 'awesome', 'perfect'],
    answer: 'You\'re welcome! Is there anything else I can help you with?',
    quickReplies: ['Get a quote', 'Book a call', 'Talk to human']
  },
  {
    patterns: ['bye', 'goodbye', 'see you', 'later'],
    answer: 'Goodbye! Thanks for chatting with FVA70K Services. If you need anything, we\'re always here. Have a great day!',
    quickReplies: []
  },
  {
    patterns: ['work', 'portfolio', 'project', 'client', 'built'],
    answer: 'We\'ve built websites and platforms including FixPro Hub (Nigeria\'s technician marketplace), Global Open University (online education), and KopaBook (business record app). You can see our work on the Our Work page.',
    quickReplies: ['See our work', 'Get a quote', 'Talk to human']
  },
  {
    patterns: ['location', 'where', 'based', 'office', 'address'],
    answer: 'We\'re based in Asaba, Delta State, Nigeria, but we serve clients across Nigeria, Africa, and internationally. All our work is done remotely with excellent communication.',
    quickReplies: ['Book a call', 'Get a quote']
  },
  {
    patterns: ['payment', 'pay', 'deposit', 'installment'],
    answer: 'We accept bank transfers and Paystack payments. Our standard terms are 50% deposit to start and 50% on completion before handover. Receipts are issued for all payments.',
    quickReplies: ['Get a quote', 'Talk to human']
  },
];

const CLARIFYING_RESPONSES = [
  // Instead of guessing, ask what they mean
  (msg) => `I want to make sure I understand you correctly. Are you asking about our pricing, features, or something else?`,
  (msg) => `Hmm, I don't want to guess wrong. Could you tell me a bit more about what you need help with?`,
  (msg) => `I want to give you the right answer. Is this about getting started, pricing, or a problem you're having?`,
];

export function getBotResponse(message, siteConfig = {}) {
  const lower = message.toLowerCase().trim();
  const businessName = siteConfig.businessName || 'FVA70K Services';
  const botName = siteConfig.botName || 'FVA Bot';

  // Check each knowledge entry
  for (const entry of KNOWLEDGE) {
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern)) {
        let answer = entry.answer;
        // Replace business name if custom site
        if (siteConfig.businessName && siteConfig.businessName !== 'FVA70K Services') {
          answer = answer.replace(/FVA70K Services/g, siteConfig.businessName);
        }
        return {
          answer,
          quickReplies: entry.quickReplies || [],
          escalate: entry.escalate || false,
          confidence: 'high'
        };
      }
    }
  }

  // No match - ASK, don't guess. Never escalate on first unclear message.
  const clarifier = CLARIFYING_RESPONSES[Math.floor(Math.random() * CLARIFYING_RESPONSES.length)];
  return {
    answer: clarifier(message),
    quickReplies: ['Pricing', 'Features', 'How to start', 'Talk to human'],
    escalate: false,
    confidence: 'low'
  };
}

export function shouldEscalate(message) {
  const lower = message.toLowerCase();
  const escalationTriggers = [
    'human', 'agent', 'person', 'real person', 'someone real',
    'angry', 'frustrated', 'terrible', 'awful', 'complaint',
    'refund', 'cancel', 'lawyer', 'sue'
  ];
  return escalationTriggers.some(t => lower.includes(t));
}
