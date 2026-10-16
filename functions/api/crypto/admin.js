// Admin: verify crypto payments and activate subscriptions.
// GET /api/crypto/admin — list pending crypto payments (platform admin only)
// POST /api/crypto/admin — approve or reject a crypto payment
import { json, getAuthContext, requirePlatformAdmin } from "../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requirePlatformAdmin(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    const payments = await db.prepare(
      `SELECT cp.*, u.email, u.full_name
       FROM crypto_payments cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.status IN ('pending', 'awaiting_verification')
       ORDER BY cp.created_at DESC LIMIT 50`
    ).all();

    return json({ ok: true, payments: payments.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load payments.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requirePlatformAdmin(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const reference = String(body.reference || "").trim();
    const action = String(body.action || "").toLowerCase(); // approve or reject

    if (!reference || !["approve", "reject"].includes(action)) {
      return json({ ok: false, message: "Reference and action (approve/reject) required." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const payment = await db.prepare(
      `SELECT * FROM crypto_payments WHERE reference = ? LIMIT 1`
    ).bind(reference).first();

    if (!payment) {
      return json({ ok: false, message: "Payment not found." }, 404);
    }
    if (!["pending", "awaiting_verification"].includes(payment.status)) {
      return json({ ok: false, message: "Payment already processed." }, 400);
    }

    if (action === "reject") {
      await db.prepare(
        `UPDATE crypto_payments SET status = 'rejected' WHERE reference = ?`
      ).bind(reference).run();
      return json({ ok: true, message: "Payment rejected." });
    }

    // Approve: activate the subscription
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE crypto_payments SET status = 'confirmed', confirmed_at = ?, confirmed_by = ? WHERE reference = ?`
    ).bind(now, auth.user.id, reference).run();

    // Activate subscription (same logic as Paystack webhook)
    const { activateSubscription } = await import("../billing/verify.js");
    await activateSubscription(db, payment.user_id, payment.tier, payment.billing_cycle, {
      reference,
      method: "crypto",
      crypto_currency: payment.crypto_currency,
    });

    return json({ ok: true, message: `Subscription activated for ${payment.tier} (${payment.billing_cycle}).` });
  } catch (error) {
    return json({ ok: false, message: "Could not process payment.", error: String(error) }, 500);
  }
}
