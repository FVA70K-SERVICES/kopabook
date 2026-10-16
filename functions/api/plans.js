// GET /api/plans — public list of subscription plans with country-adjusted prices.
// ?country=Nigeria returns localized pricing. Defaults to NGN prices.
import { json } from "./_utils";
import { getPrice, formatPrice, getCountryCurrency } from "./_pricing";

export function formatKobo(kobo, currency) {
  const n = Number(kobo || 0) / 100;
  return `${currency || "NGN"} ${n.toLocaleString()}`;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const country = url.searchParams.get("country") || "";

    // If country is provided, use PPP-adjusted pricing
    if (country) {
      const plans = {};
      const currency = getCountryCurrency(country);
      for (const tier of ["starter", "pro", "solo"]) {
        plans[tier] = {};
        for (const cycle of ["monthly", "yearly"]) {
          const p = getPrice(tier, cycle, country);
          if (p) {
            plans[tier][cycle] = {
              amount_kobo: p.amount,
              currency: p.currency,
              label: `${formatPrice(p.amount, p.currency)}${cycle === "yearly" ? "/year" : "/month"}`,
            };
          }
        }
      }
      // Free is always free
      plans["free"] = {
        monthly: { amount_kobo: 0, currency, label: "Free" },
        yearly: { amount_kobo: 0, currency, label: "Free" },
      };
      return json({ ok: true, plans, country, currency, localized: true });
    }

    // Default: NGN prices from database
    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT tier, billing_cycle, amount_kobo, currency
       FROM subscription_plans WHERE active = 1
       ORDER BY tier, billing_cycle`
    ).all();
    const plans = {};
    for (const r of rows.results || []) {
      if (!plans[r.tier]) plans[r.tier] = {};
      plans[r.tier][r.billing_cycle] = {
        amount_kobo: r.amount_kobo,
        currency: r.currency || "NGN",
        label: `${formatKobo(r.amount_kobo, r.currency)}${r.billing_cycle === "yearly" ? "/year" : "/month"}`,
      };
    }
    return json({ ok: true, plans, localized: false });
  } catch (error) {
    return json({ ok: false, message: "Could not load plans.", error: String(error) }, 500);
  }
}
