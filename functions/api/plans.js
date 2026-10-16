// GET /api/plans — public list of active subscription plans with live prices.
import { json } from "./_utils";

export function formatKobo(kobo, currency) {
  const n = Number(kobo || 0) / 100;
  return `${currency || "NGN"} ${n.toLocaleString()}`;
}

export async function onRequestGet(context) {
  try {
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
    return json({ ok: true, plans });
  } catch (error) {
    return json({ ok: false, message: "Could not load plans.", error: String(error) }, 500);
  }
}
