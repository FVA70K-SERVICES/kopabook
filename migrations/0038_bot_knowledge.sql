-- 0038: Kopa Bot D1 knowledge base.
-- The bot reads this table on every message (cached 5 minutes per isolate).
-- Rows here WIN over the hardcoded fallback in kopabook-knowledge.js,
-- so new features and changes can be taught to the bot with a simple
-- INSERT/UPDATE, no code deploy needed.
CREATE TABLE IF NOT EXISTS bot_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  patterns TEXT NOT NULL,        -- JSON array of match phrases (lowercase matching)
  answer TEXT NOT NULL,
  quick_replies TEXT,            -- JSON array of quick-reply button labels
  priority INTEGER DEFAULT 0,    -- higher = checked first
  updated_at INTEGER NOT NULL
);

-- Seed: mirrors the builtin knowledge so D1 is the source of truth.
INSERT OR IGNORE INTO bot_knowledge (topic, patterns, answer, quick_replies, priority, updated_at) VALUES
('pricing', '["price","cost","how much","pricing","fee","subscription","plan"]',
 'KopaBook is free to start! Here are the plans:\n\n- Free: 2 businesses, 100 products, 2 staff (free forever)\n- Starter: NGN 1,000/month (5 businesses, 1,000 products, 5 staff)\n- Solo: NGN 5,000/month (1 business plus an AI worker)\n- Pro: NGN 2,500/month (unlimited everything)\n\nYearly plans save you 2 months! Sales are never blocked on any plan. Want help picking one?',
 '["Start free","What is Solo?","Talk to human"]', 100, unixepoch()),
('solo', '["what is solo","solo plan","solo tier","ai worker"]',
 'Solo is for single-shop owners who want an AI assistant. For NGN 5,000/month, Kopa Bot becomes your worker: it briefs you every morning, alerts you when stock runs low, reminds you of tasks, and tracks your targets. Like having staff without the salary!',
 '["Pricing","Start free","Talk to human"]', 95, unixepoch()),
('about', '["what is kopabook","about kopabook","what does","features"]',
 'KopaBook is the best free record book for Nigerian local businesses. Track sales, stock, debts, expenses, staff, and customers, all in one app. It works offline, so no network wahala! What would you like to know more about?',
 '["Pricing","How to start","Talk to human"]', 90, unixepoch()),
('getting-started', '["how to start","sign up","register","create account","get started"]',
 'Getting started is easy:\n1. Create your free account\n2. Add your business\n3. Start recording sales\n\nNo card needed for the free plan. Want me to guide you?',
 '["Yes, guide me","Pricing","Talk to human"]', 90, unixepoch()),
('notebook', '["notebook","notes","note "]',
 'The Notebook (under Tools in the app) keeps your business thinking in one place. Private notes are only for your eyes, not even the business owner can see them. Shared notes everyone in the business can read, and owners or partners can edit them.',
 '["Features","How to start"]', 80, unixepoch()),
('calculator', '["calculator","change due"]',
 'There is a built-in calculator under Tools in the app. It has a change-due helper: enter the total and what the customer gave you, and it tells you the exact change. No more wrong change at the till!',
 '["Features","How to start"]', 80, unixepoch()),
('developer-api', '["api","developer","integration","api key"]',
 'Yes! KopaBook has a developer API. Owners and partners can create API keys in Settings (on desktop). The API is read-only and lets your own apps or website read your sales, products, debts, and expenses securely.',
 '["Pricing","Talk to human"]', 80, unixepoch()),
('hotel', '["hotel","rooms","guest house","booking"]',
 'KopaBook has a hotel section for guest houses: manage rooms and bookings right inside the app. It appears automatically when your business type is set to Hotel or Guest House.',
 '["Features","Pricing"]', 75, unixepoch()),
('offline', '["offline","no network","internet"]',
 'Yes! KopaBook works offline. Record your sales even without network, and everything syncs when you are back online. Perfect for shops with unstable network.',
 '["Features","Pricing"]', 70, unixepoch()),
('whatsapp-receipts', '["whatsapp","receipt"]',
 'KopaBook can send receipts and payment reminders via WhatsApp! Keep your customers updated without extra effort.',
 '["Features","Pricing"]', 70, unixepoch()),
('staff', '["staff","employee","role"]',
 'KopaBook has best-in-class staff roles. Add your staff and control what each person can see and do. Free plan: 2 staff, Starter: 5 staff, Pro: unlimited.',
 '["Pricing","Features"]', 70, unixepoch()),
('debts', '["debt","owing","credit","customer owing"]',
 'Track who owes you with debt tracking. See all outstanding debts in one list, send reminders on WhatsApp, and record repayments. Never lose track of customer debts again!',
 '["Features","Start free"]', 70, unixepoch()),
('stock', '["stock","inventory"]',
 'KopaBook tracks your stock levels automatically. When you make a sale, stock reduces. You get alerts before items run out. Free plan handles 100 products and services, Starter 1,000, Pro unlimited.',
 '["Pricing","Start free"]', 70, unixepoch()),
('refund', '["refund"]',
 'Paid plans come with a 7-day refund policy, no stories. If you are not happy within 7 days of paying, just ask and we will sort it out.',
 '["Pricing","Talk to human"]', 60, unixepoch()),
('contact', '["contact","reach you","phone number","email address"]',
 'You can reach us anytime at info@kopabook.com, or faster on WhatsApp at +234 813 024 4617. We reply quickly!',
 '["Talk to human","Features"]', 60, unixepoch());
