// POST /api/billing/checkout — start a Paystack payment for a tier + billing cycle.
// Returns the Paystack authorization URL; the user pays there, then returns.
import { json, getAuthContext, requireAuth } from "../_utils";
import { LIMITS } from "../billing";

// Amounts in kobo. Yearly = 10x monthly (2 months free).
export const PLAN_PRICES = {
  starter: { monthly: 100000, yearly: 1000000 },
  pro: { monthly: 250000, yearly: 2500000 },
};
export const PLAN_LABELS = {
  starter: { monthly: "NGN 1,000/month", yearly: "NGN 10,000/year" },
  pro: { monthly: "NGN 2,500/month", yearly: "NGN 25,000/year" },
};

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    const cycle = String(body.cycle || "monthly").toLowerCase();
    if (!PLAN_PRICES[tier] || !PLAN_PRICES[tier][cycle]) {
      return json({ ok: false, message: "Pick a valid plan." }, 400);
    }

    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return json({ ok: false, message: "Payments are not connected yet. Please try again later." }, 503);
    }

    const amount = PLAN_PRICES[tier][cycle];
    const reference = `kopa_${auth.user.id}_${Date.now()}`;
    const db = context.env.KOPABOOK_DB;

    await db.prepare(
      `INSERT INTO subscription_payments (user_id, tier, billing_cycle, amount_kobo, paystack_reference, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(auth.user.id, tier, cycle, amount, reference).run();

    const origin = new URL(context.request.url).origin;
    const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: auth.user.email,
        amount,
        reference,
        currency: "NGN",
        callback_url: `${origin}/app/settings?payment=${reference}`,
        metadata: { user_id: auth.user.id, tier, billing_cycle: cycle },
      }),
    });
    const psData = await psRes.json().catch(() => ({}));
    if (!psData.status) {
      await db.prepare(`UPDATE subscription_payments SET status = 'failed' WHERE paystack_reference = ?`)
        .bind(reference).run();
      return json({ ok: false, message: "Could not start the payment. Please try again." }, 502);
    }

    return json({ ok: true, authorization_url: psData.data.authorization_url, reference });
  } catch (error) {
    return json({ ok: false, message: "Could not start the payment.", error: String(error) }, 500);
  }
}
