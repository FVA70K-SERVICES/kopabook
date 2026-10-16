// POST /api/billing/webhook — Paystack event webhook (legacy path).
// Hardened: constant-time signature verification, strict tier allowlist,
// amount + reference + user matching, idempotency protection.
// Configure this URL in the Paystack dashboard: https://kopabook.com/api/billing/webhook
import { activateSubscription } from "./verify";
import { verifyPaystackSignature, VALID_TIERS, VALID_CYCLES } from "../_webhook_security";

export async function onRequestPost(context) {
  try {
    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) return new Response("not configured", { status: 503 });

    const rawBody = await context.request.text();
    const signature = context.request.headers.get("x-paystack-signature") || "";

    // Timing-attack-resistant signature verification
    const valid = await verifyPaystackSignature(rawBody, signature, secret);
    if (!valid) return new Response("invalid signature", { status: 401 });

    const event = JSON.parse(rawBody);
    const db = context.env.KOPABOOK_DB;

    if (event.event === "charge.success") {
      const data = event.data || {};
      const meta = data.metadata || {};
      const userId = Number(meta.user_id);
      const tier = String(meta.tier || "").toLowerCase();
      const cycle = String(meta.billing_cycle || "monthly").toLowerCase();

      // Strict allowlist validation
      if (!userId || !VALID_TIERS.includes(tier) || !VALID_CYCLES.includes(cycle)) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Match by reference first (strongest), fall back to user+tier+cycle
      const reference = String(data.reference || "");
      let payment = null;
      if (reference) {
        payment = await db.prepare(
          `SELECT * FROM subscription_payments
           WHERE paystack_reference = ? AND status != 'paid' LIMIT 1`
        ).bind(reference).first();
      }
      if (!payment) {
        payment = await db.prepare(
          `SELECT * FROM subscription_payments
           WHERE user_id = ? AND tier = ? AND billing_cycle = ? AND status != 'paid'
           ORDER BY id DESC LIMIT 1`
        ).bind(userId, tier, cycle).first();
      }

      // Triple-check: user matches, amount matches exactly
      if (payment &&
          Number(payment.user_id) === userId &&
          Number(data.amount) === Number(payment.amount_kobo)) {
        await activateSubscription(db, userId, tier, cycle, data);
        if (reference) {
          await db.prepare(
            `UPDATE subscription_payments SET status = 'paid' WHERE paystack_reference = ?`
          ).bind(reference).run();
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response("error", { status: 500 });
  }
}
