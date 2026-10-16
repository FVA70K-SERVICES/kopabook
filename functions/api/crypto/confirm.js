// POST /api/crypto/confirm — user confirms they sent the crypto payment.
// Optionally includes the transaction hash. Sets status to 'awaiting_verification'.
import { json, getAuthContext, requireAuth } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const reference = String(body.reference || "").trim();
    const txHash = String(body.tx_hash || "").trim();

    if (!reference) {
      return json({ ok: false, message: "Payment reference is required." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const payment = await db.prepare(
      `SELECT * FROM crypto_payments WHERE reference = ? AND user_id = ? LIMIT 1`
    ).bind(reference, auth.user.id).first();

    if (!payment) {
      return json({ ok: false, message: "Payment not found." }, 404);
    }
    if (payment.status !== "pending") {
      return json({ ok: false, message: "This payment has already been submitted." }, 400);
    }

    await db.prepare(
      `UPDATE crypto_payments SET status = 'awaiting_verification', tx_hash = ? WHERE reference = ?`
    ).bind(txHash || null, reference).run();

    return json({
      ok: true,
      message: "Payment submitted. We will verify and activate your plan shortly. You will be notified by email.",
    });
  } catch (error) {
    return json({ ok: false, message: "Could not confirm payment.", error: String(error) }, 500);
  }
}
