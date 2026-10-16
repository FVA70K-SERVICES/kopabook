// Country-based fair pricing for KopaBook.
// Prices are PPP-adjusted so each country pays a fair rate for their economy.
// Nigeria uses NGN (home market). Ghana, Kenya, South Africa use local currency.
// All other countries use USD.

export const PRICING_TIERS = {
  // Monthly prices in USD cents (yearly = 10x monthly)
  low: { starter: 100, pro: 200, solo: 400 },           // Low income
  lower_middle: { starter: 200, pro: 400, solo: 700 },  // Lower-middle income
  upper_middle: { starter: 400, pro: 800, solo: 1200 }, // Upper-middle income
  high: { starter: 600, pro: 1200, solo: 1800 },        // High income
};

// Country -> pricing tier mapping
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

// Paystack-supported local currencies (others use USD)
export const COUNTRY_CURRENCIES = {
  "Nigeria": "NGN",
  "Ghana": "GHS",
  "Kenya": "KES",
  "South Africa": "ZAR",
};

// Approximate exchange rates to USD (for converting USD prices to local currency)
const USD_RATES = {
  "GHS": 15.5,   // Ghanaian Cedi
  "KES": 129,    // Kenyan Shilling
  "ZAR": 18.2,   // South African Rand
};

// Nigeria home pricing in NGN kobo
const NIGERIA_PRICES = {
  starter: { monthly: 100000, yearly: 1000000 },   // NGN 1,000 / 10,000
  pro: { monthly: 250000, yearly: 2500000 },       // NGN 2,500 / 25,000
  solo: { monthly: 500000, yearly: 5000000 },       // NGN 5,000 / 50,000
};

export function getCountryTier(country) {
  if (!country) return "high";
  return COUNTRY_TIERS[country] || "high";
}

export function getCountryCurrency(country) {
  return COUNTRY_CURRENCIES[country] || "USD";
}

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

  // Get USD cents
  const usdCents = PRICING_TIERS[tierKey][tier] * (cycle === "yearly" ? 10 : 1);

  // Convert to local currency if needed
  if (currency === "USD") {
    return { amount: usdCents, currency: "USD", tier: tierKey };
  }

  const rate = USD_RATES[currency] || 1;
  const localAmount = Math.round((usdCents / 100) * rate * 100); // to smallest unit
  // Round to nice numbers
  const rounded = Math.round(localAmount / 100) * 100;
  return { amount: rounded, currency, tier: tierKey };
}

export function formatPrice(amount, currency) {
  const n = Number(amount || 0) / 100;
  const symbols = { NGN: "NGN", GHS: "GH₵", KES: "KSh", ZAR: "R", USD: "$" };
  const sym = symbols[currency] || currency;
  return `${sym} ${n.toLocaleString()}`;
}
