// POST /api/paystack/webhook — Paystack event webhook.
// Hardened: constant-time signature verification, strict tier allowlist,
// amount + reference + user matching, idempotency protection.
// Configure this URL in the Paystack dashboard: https://kopabook.com/api/paystack/webhook
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

      // Match the exact payment by Paystack reference (idempotency)
      const reference = String(data.reference || "");
      if (!reference) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const payment = await db.prepare(
        `SELECT * FROM subscription_payments
         WHERE paystack_reference = ? AND status != 'paid' LIMIT 1`
      ).bind(reference).first();

      // Triple-check: user matches, amount matches exactly, currency matches
      if (payment &&
          Number(payment.user_id) === userId &&
          Number(data.amount) === Number(payment.amount_kobo) &&
          String(data.currency || "NGN").toUpperCase() === String(payment.currency || "NGN").toUpperCase()) {
        await activateSubscription(db, userId, tier, cycle, data, reference);
        // Mark as paid to prevent replay
        await db.prepare(
          `UPDATE subscription_payments SET status = 'paid' WHERE paystack_reference = ?`
        ).bind(reference).run();
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response("error", { status: 500 });
  }
}
