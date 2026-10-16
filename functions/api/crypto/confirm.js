// POST /api/crypto/confirm — user submits the transaction hash after sending crypto.
// Requires a valid 64-hex transaction hash. Marks the payment 'awaiting_verification'.
// Activation only happens after an admin verifies the transaction on-chain.
import { json, getAuthContext, requireAuth } from "../_utils";
import { checkRateLimit } from "../_webhook_security";
import { isValidTxHash } from "./_verify";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;

    if (!(await checkRateLimit(db, `crypto_confirm_${auth.user.id}`, 5, 3600000))) {
      return json({ ok: false, message: "Too many attempts. Please try again later." }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const reference = String(body.reference || "").trim();
    const txHash = String(body.tx_hash || "").trim();

    if (!reference) {
      return json({ ok: false, message: "Payment reference is required." }, 400);
    }
    if (!isValidTxHash(txHash)) {
      return json({ ok: false, message: "Enter the valid transaction hash from your wallet (64 hex characters)." }, 400);
    }

    const payment = await db.prepare(
      `SELECT * FROM crypto_payments WHERE reference = ? AND user_id = ? LIMIT 1`
    ).bind(reference, auth.user.id).first();

    if (!payment) {
      return json({ ok: false, message: "Payment not found." }, 404);
    }
    if (payment.status !== "pending") {
      return json({ ok: false, message: "This payment has already been submitted." }, 400);
    }
    if (payment.expires_at && payment.expires_at < new Date().toISOString().slice(0, 19).replace("T", " ")) {
      await db.prepare(`UPDATE crypto_payments SET status = 'expired' WHERE reference = ?`).bind(reference).run();
      return json({ ok: false, message: "This payment request expired. Please start a new one." }, 410);
    }

    // One transaction hash can only ever pay for one subscription.
    const dup = await db.prepare(
      `SELECT reference FROM crypto_payments WHERE tx_hash = ? AND reference != ? LIMIT 1`
    ).bind(txHash, reference).first();
    if (dup) {
      return json({ ok: false, message: "This transaction has already been used for another payment." }, 409);
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    await db.prepare(
      `UPDATE crypto_payments SET status = 'awaiting_verification', tx_hash = ?, submitted_at = ? WHERE reference = ?`
    ).bind(txHash, now, reference).run();

    return json({
      ok: true,
      message: "Payment submitted. We verify every transaction on the blockchain before activating, usually within a few hours. You will be notified by email.",
    });
  } catch (error) {
    // UNIQUE(tx_hash) is the last line of defence against double-use.
    if (String(error && error.message || "").includes("UNIQUE")) {
      return json({ ok: false, message: "This transaction has already been used for another payment." }, 409);
    }
    return json({ ok: false, message: "Could not confirm payment.", error: String(error) }, 500);
  }
}
