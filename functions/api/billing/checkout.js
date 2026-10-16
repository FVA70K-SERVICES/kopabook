// POST /api/billing/checkout — start a Paystack payment for a tier + billing cycle.
// Prices use country-adjusted PPP pricing based on the user's business country.
// Returns the Paystack authorization URL; the user pays there, then returns.
import { json, getAuthContext, requireAuth } from "../_utils";
import { LIMITS } from "../billing";
import { getPrice } from "../_pricing";
import { checkRateLimit } from "../_webhook_security";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    // Rate limit: max 5 checkout attempts per user per hour (prevent payment spam)
    const rateKey = `checkout_${auth.user.id}`;
    if (!checkRateLimit(rateKey, 5, 3600000)) {
      return json({ ok: false, message: "Too many payment attempts. Please try again later." }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    const cycle = String(body.cycle || "monthly").toLowerCase();
    if (!LIMITS[tier] || tier === "free" || !["monthly", "yearly"].includes(cycle)) {
      return json({ ok: false, message: "Pick a valid plan." }, 400);
    }

    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return json({ ok: false, message: "Payments are not connected yet. Please try again later." }, 503);
    }

    const db = context.env.KOPABOOK_DB;

    // Get user's country for localized pricing
    const user = await db.prepare(
      `SELECT country FROM users WHERE id = ? LIMIT 1`
    ).bind(auth.user.id).first();
    const userCountry = user?.country || "Nigeria";

    const price = getPrice(tier, cycle, userCountry);
    if (!price) {
      return json({ ok: false, message: "This plan is not available right now." }, 400);
    }

    const amount = Number(price.amount);
    const currency = price.currency;
    const reference = `kopa_${auth.user.id}_${Date.now()}`;

    await db.prepare(
      `INSERT INTO subscription_payments (user_id, tier, billing_cycle, amount_kobo, paystack_reference, status, currency, country)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(auth.user.id, tier, cycle, amount, reference, currency, userCountry).run();

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
        currency,
        callback_url: `${origin}/app/settings?payment=${reference}`,
        metadata: { user_id: auth.user.id, tier, billing_cycle: cycle, country: userCountry },
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
