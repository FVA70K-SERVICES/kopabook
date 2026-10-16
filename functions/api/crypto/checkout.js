// POST /api/crypto/checkout — create a crypto payment request for a subscription.
// Returns wallet address, exact amount, and reference. The user sends the crypto,
// then submits the transaction hash. Nothing activates until the transaction is
// verified on the blockchain by an admin.
import { json, getAuthContext, requireAuth } from "../_utils";
import { getPrice } from "../_pricing";
import { LIMITS } from "../billing";
import { checkRateLimit } from "../_webhook_security";
import { getBtcPriceUsd, isValidCryptoAddress, explorerUrl } from "./_verify";

function randomRef() {
  return "crypto_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const PAYMENT_TTL_MS = 24 * 3600 * 1000; // payment requests expire after 24h

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;

    // Rate limit: max 3 crypto payment requests per user per hour
    if (!(await checkRateLimit(db, `crypto_${auth.user.id}`, 3, 3600000))) {
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

    const user = await db.prepare(
      `SELECT country FROM users WHERE id = ? LIMIT 1`
    ).bind(auth.user.id).first();
    const userCountry = user?.country || "Nigeria";

    // Crypto is always priced in USD (country-adjusted).
    const price = getPrice(tier, cycle, userCountry);
    if (!price || price.currency !== "USD") {
      return json({ ok: false, message: "This plan is not available right now." }, 400);
    }
    const usdCents = Number(price.amount);
    const usdAmount = (usdCents / 100).toFixed(2);

    const walletAddress = cryptoCurrency === "BTC"
      ? context.env.CRYPTO_BTC_ADDRESS
      : context.env.CRYPTO_USDT_ADDRESS;

    if (!walletAddress || !isValidCryptoAddress(cryptoCurrency, walletAddress)) {
      return json({ ok: false, message: "Crypto payments are not set up yet. Please try again later." }, 503);
    }

    const network = cryptoCurrency === "BTC" ? "Bitcoin" : "Tron (TRC20)";

    // Exact crypto amount the user must send.
    let cryptoAmount, amountLabel;
    if (cryptoCurrency === "BTC") {
      let btcPrice;
      try {
        btcPrice = await getBtcPriceUsd();
      } catch {
        return json({ ok: false, message: "BTC quotes are temporarily unavailable. Please pay with USDT or try again shortly." }, 503);
      }
      const btcQty = (usdCents / 100) / btcPrice;
      cryptoAmount = btcQty.toFixed(8);
      amountLabel = `${cryptoAmount} BTC (about $${usdAmount})`;
    } else {
      cryptoAmount = usdAmount; // 1 USDT = $1
      amountLabel = `${cryptoAmount} USDT`;
    }

    const reference = randomRef();
    const id = "cp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const expiresAt = new Date(Date.now() + PAYMENT_TTL_MS).toISOString().slice(0, 19).replace("T", " ");

    await db.prepare(
      `INSERT INTO crypto_payments (id, user_id, tier, billing_cycle, amount_usd_cents, crypto_currency, crypto_amount, wallet_address, reference, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(id, auth.user.id, tier, cycle, usdCents, cryptoCurrency, cryptoAmount, walletAddress, reference, expiresAt).run();

    return json({
      ok: true,
      reference,
      crypto_currency: cryptoCurrency,
      amount: cryptoAmount,
      amount_label: amountLabel,
      usd_amount: usdAmount,
      wallet_address: walletAddress,
      network,
      expires_at: expiresAt,
      instructions: `Send exactly ${amountLabel} to the address above on the ${network} network. Sending on any other network will lose your money. Then come back here and submit your transaction hash within 24 hours.`,
    });
  } catch (error) {
    return json({ ok: false, message: "Could not create crypto payment.", error: String(error) }, 500);
  }
}
