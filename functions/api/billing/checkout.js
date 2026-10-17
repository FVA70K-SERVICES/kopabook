// POST /api/billing/checkout — start a Paystack payment for a tier + billing cycle.
// Prices use country-adjusted PPP pricing based on the user's business country.
// Returns the Paystack authorization URL; the user pays there, then returns.
import { json, getAuthContext, requireAuth } from "../_utils";
import { LIMITS } from "../billing";
import { getPrice, PAYSTACK_CURRENCIES, getUserCountry, getPricedb } from "../_pricing";
import { checkRateLimit } from "../_webhook_security";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;

    // Rate limit: max 5 checkout attempts per user per hour (prevent payment spam)
    if (!(await checkRateLimit(db, `checkout_${auth.user.id}`, 5, 3600000))) {
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

    // Get user's country for localized pricing (from their business; never throws)
    const userCountry = await getUserCountry(db, auth.user.id);

    // Single price source: the DB price book (subscription_plans) first,
    // hardcoded country prices only as a fallback if the DB read fails or
    // has no valid row, so the two can never silently diverge.
    let price = await getPricedb(db, tier, userCountry, cycle);
    if (!price) price = getPrice(tier, cycle, userCountry);
    if (!price) {
      return json({ ok: false, message: "This plan is not available right now." }, 400);
    }

    // Only charge currencies our Paystack account actually supports.
    // Nigeria pays NGN; everyone else pays USD. Crypto covers the rest.
    const amount = Number(price.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ ok: false, message: "This plan is not available right now." }, 400);
    }
    const currency = PAYSTACK_CURRENCIES.includes(price.currency) ? price.currency : "USD";
    const reference = `kopa_${auth.user.id}_${Date.now()}`;

    await db.prepare(
      `INSERT INTO subscription_payments (user_id, tier, billing_cycle, amount_kobo, paystack_reference, status, currency, country, payment_method)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'paystack')`
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
      const psMsg = String(psData.message || "");
      // Currency not enabled on our Paystack account: point the user to crypto.
      if (/currency/i.test(psMsg)) {
        return json({ ok: false, message: "Card payments in this currency are not enabled on our account yet. Please pay with crypto (USDT/BTC) instead." }, 502);
      }
      return json({ ok: false, message: "Could not start the payment. Please try again." }, 502);
    }

    return json({ ok: true, authorization_url: psData.data.authorization_url, reference });
  } catch (error) {
    return json({ ok: false, message: "Could not start the payment.", error: String(error) }, 500);
  }
}
