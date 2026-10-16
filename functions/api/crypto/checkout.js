// POST /api/crypto/checkout — create a crypto payment request for a subscription.
// Returns wallet address, amount, and reference. User sends crypto, then confirms.
// Supports USDT (Tron) by default. Amount is PPP-adjusted USD for their country.
import { json, getAuthContext, requireAuth } from "../_utils";
import { getPrice } from "../_pricing";
import { LIMITS } from "../billing";
import { checkRateLimit } from "../_webhook_security";

function randomRef() {
  return "crypto_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    // Rate limit: max 3 crypto payment requests per user per hour
    const rateKey = `crypto_${auth.user.id}`;
    if (!checkRateLimit(rateKey, 3, 3600000)) {
      return json({ ok: false, message: "Too many requests. Please try again later." }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const tier = String(body.tier || "").toLowerCase();
    const cycle = String(body.cycle || "monthly").toLowerCase();
    const cryptoCurrency = String(body.crypto_currency || "USDT").toUpperCase();

    if (!LIMITS[tier] || tier === "free" || !["monthly", "yearly"].includes(cycle)) {
      return json({ ok: false, message: "Pick a valid plan." }, 400);
    }
    if (!["USDT", "BTC"].includes(cryptoCurrency)) {
      return json({ ok: false, message: "We accept USDT and BTC." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const user = await db.prepare(
      `SELECT country FROM users WHERE id = ? LIMIT 1`
    ).bind(auth.user.id).first();
    const userCountry = user?.country || "Nigeria";

    // Get USD price for crypto (always USD for crypto payments)
    const price = getPrice(tier, cycle, userCountry);
    if (!price) {
      return json({ ok: false, message: "This plan is not available right now." }, 400);
    }

    // Convert to USD cents for crypto
    let usdCents;
    if (price.currency === "USD") {
      usdCents = price.amount;
    } else if (price.currency === "NGN") {
      usdCents = Math.round((price.amount / 100) / 1500 * 100); // ~1500 NGN/USD
    } else {
      // GHS, KES, ZAR - convert via approximate rates
      const rates = { GHS: 15.5, KES: 129, ZAR: 18.2 };
      const rate = rates[price.currency] || 1;
      usdCents = Math.round((price.amount / 100) / rate * 100);
    }

    const usdAmount = (usdCents / 100).toFixed(2);
    const walletAddress = cryptoCurrency === "BTC"
      ? context.env.CRYPTO_BTC_ADDRESS
      : context.env.CRYPTO_USDT_ADDRESS;

    if (!walletAddress) {
      return json({ ok: false, message: "Crypto payments are not set up yet." }, 503);
    }

    const reference = randomRef();
    const id = "cp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    await db.prepare(
      `INSERT INTO crypto_payments (id, user_id, tier, billing_cycle, amount_usd_cents, crypto_currency, crypto_amount, wallet_address, reference, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(id, auth.user.id, tier, cycle, usdCents, cryptoCurrency, usdAmount, walletAddress, reference).run();

    return json({
      ok: true,
      reference,
      crypto_currency: cryptoCurrency,
      amount: usdAmount,
      wallet_address: walletAddress,
      network: cryptoCurrency === "BTC" ? "Bitcoin" : "Tron (TRC20)",
      tier,
      billing_cycle: cycle,
      instructions: `Send exactly ${usdAmount} ${cryptoCurrency} to the address above on ${cryptoCurrency === "BTC" ? "Bitcoin" : "Tron (TRC20)"} network. Then tap "I've sent payment" below.`,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not create crypto payment.", error: String(error) }, 500);
  }
}
