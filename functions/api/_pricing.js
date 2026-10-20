// Country-based fair pricing for KopaBook.
// Prices are adjusted so each country pays a fair rate for their economy.
// Nigeria (home market) pays in NGN. Everywhere else pays in USD.
//
// Why USD-only outside Nigeria: our Paystack merchant account is Nigerian,
// which can charge NGN and USD. GHS/KES/ZAR need separate country accounts,
// so we do not pretend to charge them. Card payments outside Nigeria go
// through Paystack in USD; crypto (USDT/BTC) is available everywhere.

export const PRICING_TIERS = {
  // Monthly prices in USD cents (yearly = 10x monthly, i.e. 2 months free)
  low: { starter: 100, pro: 200, solo: 400 },           // Low income
  lower_middle: { starter: 200, pro: 400, solo: 700 },  // Lower-middle income
  upper_middle: { starter: 400, pro: 800, solo: 1200 }, // Upper-middle income
  high: { starter: 600, pro: 1200, solo: 1800 },        // High income
};

// Country -> pricing tier mapping (roughly World Bank income groups).
// Amounts are a starting point: tune them in PRICING_TIERS above.
export const COUNTRY_TIERS = {
  // Nigeria: special NGN pricing (home market)
  "Nigeria": "nigeria",

  // Low income countries
  "Burundi": "low", "Malawi": "low", "Niger": "low", "Chad": "low",
  "South Sudan": "low", "Somalia": "low", "Sierra Leone": "low", "Liberia": "low",
  "Guinea": "low", "Guinea-Bissau": "low", "Burkina Faso": "low", "Mali": "low",
  "Central African Republic": "low", "DR Congo": "low", "Eritrea": "low",
  "Gambia": "low", "Togo": "low", "Afghanistan": "low", "Yemen": "low",
  "Mozambique": "low", "Madagascar": "low",

  // Lower-middle income
  "Ghana": "lower_middle", "Kenya": "lower_middle", "Uganda": "lower_middle",
  "Tanzania": "lower_middle", "Rwanda": "lower_middle", "Ethiopia": "lower_middle",
  "Senegal": "lower_middle", "Ivory Coast": "lower_middle", "Cameroon": "lower_middle",
  "Angola": "lower_middle", "Zambia": "lower_middle", "Zimbabwe": "lower_middle",
  "Benin": "lower_middle", "Mauritania": "lower_middle", "Sudan": "lower_middle",
  "Djibouti": "lower_middle", "Comoros": "lower_middle", "Lesotho": "lower_middle",
  "Eswatini": "lower_middle", "India": "lower_middle", "Pakistan": "lower_middle",
  "Bangladesh": "lower_middle", "Sri Lanka": "lower_middle", "Nepal": "lower_middle",
  "Philippines": "lower_middle", "Indonesia": "lower_middle", "Vietnam": "lower_middle",
  "Myanmar": "lower_middle", "Cambodia": "lower_middle", "Laos": "lower_middle",
  "Egypt": "lower_middle", "Morocco": "lower_middle", "Algeria": "lower_middle",
  "Tunisia": "lower_middle", "Ukraine": "lower_middle", "Moldova": "lower_middle",
  "Kyrgyzstan": "lower_middle", "Tajikistan": "lower_middle", "Uzbekistan": "lower_middle",
  "Honduras": "lower_middle", "Nicaragua": "lower_middle", "El Salvador": "lower_middle",
  "Bolivia": "lower_middle", "Papua New Guinea": "lower_middle", "Vanuatu": "lower_middle",
  "Solomon Islands": "lower_middle", "Congo Republic": "lower_middle",
  "Sao Tome and Principe": "lower_middle", "Cape Verde": "lower_middle",

  // Upper-middle income
  "South Africa": "upper_middle", "Botswana": "upper_middle", "Namibia": "upper_middle",
  "Gabon": "upper_middle", "Equatorial Guinea": "upper_middle", "Mauritius": "upper_middle",
  "Seychelles": "upper_middle", "Libya": "upper_middle",
  "Brazil": "upper_middle", "Argentina": "upper_middle", "Chile": "upper_middle",
  "Colombia": "upper_middle", "Peru": "upper_middle", "Mexico": "upper_middle",
  "Malaysia": "upper_middle", "Thailand": "upper_middle", "China": "upper_middle",
  "Turkey": "upper_middle", "Russia": "upper_middle", "Belarus": "upper_middle",
  "Serbia": "upper_middle", "Bosnia and Herzegovina": "upper_middle",
  "North Macedonia": "upper_middle", "Albania": "upper_middle", "Montenegro": "upper_middle",
  "Georgia": "upper_middle", "Armenia": "upper_middle", "Azerbaijan": "upper_middle",
  "Kazakhstan": "upper_middle", "Turkmenistan": "upper_middle",
  "Jordan": "upper_middle", "Lebanon": "upper_middle", "Iraq": "upper_middle",
  "Iran": "upper_middle", "Cuba": "upper_middle", "Dominican Republic": "upper_middle",
  "Jamaica": "upper_middle", "Ecuador": "upper_middle", "Paraguay": "upper_middle",
  "Guyana": "upper_middle", "Suriname": "upper_middle",
  "Costa Rica": "upper_middle", "Panama": "upper_middle", "Belize": "upper_middle",
  "Grenada": "upper_middle", "Saint Lucia": "upper_middle", "Saint Vincent and the Grenadines": "upper_middle",
  "Dominica": "upper_middle",
};

// High income: everything not listed above defaults to "high"

// Nigeria home pricing in NGN kobo
const NIGERIA_PRICES = {
  starter: { monthly: 100000, yearly: 1000000 },   // NGN 1,000 / 10,000
  pro: { monthly: 1000000, yearly: 10000000 },     // NGN 10,000 / 100,000
  solo: { monthly: 500000, yearly: 5000000 },       // NGN 5,000 / 50,000
};

export function getCountryTier(country) {
  if (!country) return "high";
  return COUNTRY_TIERS[country] || "high";
}

// Only NGN (Nigeria) and USD (everywhere else). Our Paystack account can
// charge these two; anything else would fail at the gateway.
export function getCountryCurrency(country) {
  return country === "Nigeria" ? "NGN" : "USD";
}

// Currencies our Paystack merchant account can actually charge.
export const PAYSTACK_CURRENCIES = ["NGN", "USD"];

// Get price in smallest currency unit (kobo/cents) for a tier, cycle, and country
export function getPrice(tier, cycle, country) {
  tier = String(tier || "").toLowerCase();
  cycle = String(cycle || "monthly").toLowerCase();
  if (!["starter", "pro", "solo"].includes(tier)) return null;
  if (!["monthly", "yearly"].includes(cycle)) return null;

  const tierKey = getCountryTier(country);
  const currency = getCountryCurrency(country);

  // Nigeria: fixed NGN prices
  if (tierKey === "nigeria") {
    return {
      amount: NIGERIA_PRICES[tier][cycle],
      currency: "NGN",
      tier: tierKey,
    };
  }

  // Everywhere else: USD cents
  const usdCents = PRICING_TIERS[tierKey][tier] * (cycle === "yearly" ? 10 : 1);
  return { amount: usdCents, currency: "USD", tier: tierKey };
}

export function formatPrice(amount, currency) {
  const n = Number(amount || 0) / 100;
  const symbols = { NGN: "NGN", USD: "$" };
  const sym = symbols[currency] || currency;
  return `${sym} ${n.toLocaleString()}`;
}

// Approximate NGN per USD, used only to quote crypto amounts for Nigerian
// users (crypto settles in USD value). Keep roughly at the market rate;
// small drift is acceptable at these amounts.
export const NGN_PER_USD = 1550;

// Crypto payments carry a $2 minimum to cover blockchain network charges.
export const CRYPTO_MIN_USD_CENTS = 200;

// Crypto price in USD cents for any country. Nigerian NGN prices are
// converted at NGN_PER_USD so Nigerians can also pay with crypto.
// The $2 minimum applies to every crypto payment.
export function getCryptoPriceUsdCents(tier, cycle, country) {
  const price = getPrice(tier, cycle, country);
  if (!price) return null;
  let usdCents;
  if (price.currency === "USD") usdCents = Math.round(Number(price.amount));
  else if (price.currency === "NGN") usdCents = Math.max(1, Math.round(Number(price.amount) / NGN_PER_USD));
  else return null;
  return { usdCents: Math.max(CRYPTO_MIN_USD_CENTS, usdCents) };
}

// DB-backed price source. The marketing page and the admin panel read prices
// from the subscription_plans table, so checkout must too: hardcoded numbers
// here and the DB price book can silently diverge otherwise.
//
// Schema note (migrations/0029_subscription_plans.sql): the table has columns
// (tier, billing_cycle, amount_kobo, currency, active), not (tier, country,
// period, amount). Only the NGN home-market prices live in the DB, so this
// returns a price only for Nigeria; other countries keep the hardcoded PPP
// prices below. Returns { amount, currency } in the smallest currency unit,
// or null when the DB read fails or has no valid row, so callers can fall
// back to the hardcoded constants and checkout never breaks.
export async function getPricedb(db, tier, country, period) {
  try {
    tier = String(tier || "").toLowerCase();
    period = String(period || "monthly").toLowerCase();
    if (!["starter", "pro", "solo"].includes(tier)) return null;
    if (!["monthly", "yearly"].includes(period)) return null;
    if (country !== "Nigeria") return null;
    const row = await db.prepare(
      `SELECT amount_kobo, currency FROM subscription_plans
       WHERE tier = ? AND billing_cycle = ? AND active = 1 LIMIT 1`
    ).bind(tier, period).first();
    if (!row) return null;
    const amount = Math.floor(Number(row.amount_kobo));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const currency = String(row.currency || "NGN").toUpperCase();
    if (currency !== "NGN") return null;
    return { amount, currency };
  } catch {
    return null;
  }
}

// DB-backed crypto quote for a tier/cycle/country, or null to fall back to
// the hardcoded crypto prices. Nigeria's NGN DB price is converted at
// NGN_PER_USD, and the $2 crypto minimum is enforced here too.
export async function getCryptoPricedbUsdCents(db, tier, cycle, country) {
  try {
    const p = await getPricedb(db, tier, country, cycle);
    if (!p) return null;
    let usdCents;
    if (p.currency === "NGN") usdCents = Math.max(1, Math.round(Number(p.amount) / NGN_PER_USD));
    else if (p.currency === "USD") usdCents = Math.round(Number(p.amount));
    else return null;
    if (!Number.isFinite(usdCents) || usdCents <= 0) return null;
    return { usdCents: Math.max(CRYPTO_MIN_USD_CENTS, usdCents) };
  } catch {
    return null;
  }
}

// The user's country for pricing. Read from their first business
// (businesses.country exists since migration 0020). There is no
// users.country column, so never query it. Falls back to Nigeria and
// never throws, so pricing can never 500 the checkout.
export async function getUserCountry(db, userId) {
  try {
    const row = await db.prepare(
      `SELECT b.country AS country FROM businesses b
       JOIN business_members m ON m.business_id = b.id
       WHERE m.user_id = ? LIMIT 1`
    ).bind(userId).first();
    const c = row?.country && String(row.country).trim();
    return c || "Nigeria";
  } catch {
    return "Nigeria";
  }
}
