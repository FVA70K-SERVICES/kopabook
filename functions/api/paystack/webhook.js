// POST /api/billing/webhook — Paystack event webhook.
// Paystack signs every event with HMAC SHA512 of the raw body using the secret key.
// Configure this URL in the Paystack dashboard: https://kopabook-bop.pages.dev/api/billing/webhook
import { activateSubscription } from "./verify";

export async function onRequestPost(context) {
  try {
    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) return new Response("not configured", { status: 503 });

    const rawBody = await context.request.text();
    const signature = context.request.headers.get("x-paystack-signature") || "";

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== signature) return new Response("invalid signature", { status: 401 });

    const event = JSON.parse(rawBody);
    const db = context.env.KOPABOOK_DB;

    if (event.event === "charge.success") {
      const data = event.data || {};
      const meta = data.metadata || {};
      const userId = Number(meta.user_id);
      const tier = String(meta.tier || "");
      const cycle = String(meta.billing_cycle || "monthly");
      if (userId && (tier === "starter" || tier === "pro")) {
        // Only activate if the amount matches a logged payment for this user.
        const payment = await db.prepare(
          `SELECT * FROM subscription_payments
           WHERE user_id = ? AND tier = ? AND billing_cycle = ? AND status != 'paid'
           ORDER BY id DESC LIMIT 1`
        ).bind(userId, tier, cycle).first();
        if (payment && Number(data.amount) === Number(payment.amount_kobo)) {
          await activateSubscription(db, userId, tier, cycle, data);
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
