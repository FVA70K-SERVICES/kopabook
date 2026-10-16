// FVAChat subscription plans - cheap pricing for every business

export const FVACHAT_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    currency: 'NGN',
    priceDisplay: 'Free forever',
    conversations: 50,        // bot conversations per month
    sites: 1,
    features: [
      '50 bot conversations/month',
      '1 website',
      'FVA Bot basic answers',
      'WhatsApp fallback',
      'Basic chat widget'
    ],
    ordering: false,
    booking: false,
    customBranding: false,
    priority: false
  },
  starter: {
    name: 'Starter',
    price: 1500,
    currency: 'NGN',
    priceDisplay: 'NGN 1,500/month',
    conversations: 500,
    sites: 1,
    features: [
      '500 bot conversations/month',
      '1 website',
      'FVA Bot with business memory',
      'Order taking',
      'Custom bot name',
      'Chat ratings',
      'Email transcripts'
    ],
    ordering: true,
    booking: false,
    customBranding: true,
    priority: false
  },
  growth: {
    name: 'Growth',
    price: 3500,
    currency: 'NGN',
    priceDisplay: 'NGN 3,500/month',
    conversations: 2000,
    sites: 3,
    features: [
      '2,000 bot conversations/month',
      '3 websites',
      'Everything in Starter',
      'Booking system',
      'Appointment reminders',
      'Advanced analytics',
      'Priority support'
    ],
    ordering: true,
    booking: true,
    customBranding: true,
    priority: true
  },
  internal: {
    name: 'Internal',
    price: 0,
    currency: 'NGN',
    priceDisplay: 'Internal - unlimited',
    conversations: -1,        // unlimited
    sites: -1,                // unlimited
    features: [
      'Unlimited conversations',
      'Unlimited websites',
      'All features unlocked',
      'Order taking',
      'Booking system',
      'Priority support',
      'No limits, permanent'
    ],
    ordering: true,
    booking: true,
    customBranding: true,
    priority: true
  },
  scale: {
    name: 'Scale',
    price: 7500,
    currency: 'NGN',
    priceDisplay: 'NGN 7,500/month',
    conversations: -1,  // unlimited
    sites: 10,
    features: [
      'Unlimited conversations',
      '10 websites',
      'Everything in Growth',
      'Multi-agent seats (5)',
      'API access',
      'White-label option',
      'Dedicated support'
    ],
    ordering: true,
    booking: true,
    customBranding: true,
    priority: true
  }
};

// USD equivalents for international
export const FVACHAT_PLANS_USD = {
  free: { ...FVACHAT_PLANS.free, priceDisplay: 'Free forever' },
  starter: { ...FVACHAT_PLANS.starter, price: 2, priceDisplay: '$2/month' },
  growth: { ...FVACHAT_PLANS.growth, price: 5, priceDisplay: '$5/month' },
  internal: {
    name: 'Internal',
    price: 0,
    currency: 'NGN',
    priceDisplay: 'Internal - unlimited',
    conversations: -1,        // unlimited
    sites: -1,                // unlimited
    features: [
      'Unlimited conversations',
      'Unlimited websites',
      'All features unlocked',
      'Order taking',
      'Booking system',
      'Priority support',
      'No limits, permanent'
    ],
    ordering: true,
    booking: true,
    customBranding: true,
    priority: true
  },
  scale: { ...FVACHAT_PLANS.scale, price: 10, priceDisplay: '$10/month' }
};

export function getPlan(planId) {
  return FVACHAT_PLANS[planId] || FVACHAT_PLANS.free;
}

export function canUseFeature(planId, feature) {
  const plan = getPlan(planId);
  if (feature === 'ordering') return plan.ordering;
  if (feature === 'booking') return plan.booking;
  if (feature === 'customBranding') return plan.customBranding;
  return true;
}

export function checkConversationLimit(planId, usedThisMonth) {
  const plan = getPlan(planId);
  if (plan.conversations === -1) return { allowed: true, remaining: -1 };
  const remaining = plan.conversations - usedThisMonth;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}
