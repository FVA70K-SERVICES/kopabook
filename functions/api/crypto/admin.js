// Admin: verify crypto payments and activate subscriptions.
// GET /api/crypto/admin — list payments needing review (platform admin only)
// POST /api/crypto/admin — approve (with on-chain verification) or reject (with reason).
//
// Approval NEVER activates on trust: the transaction is checked on the public
// blockchain first (right wallet, right token, right amount, confirmed).
import { json, getAuthContext, requirePlatformAdmin } from "../_utils";
import { activateSubscription } from "../billing/verify";
import { verifyCryptoPayment, isValidTxHash, explorerUrl } from "./_verify";
import { getUserCountry } from "../_pricing";

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function audit(db, adminId, action, reference, extra) {
  return db.prepare(
    `INSERT INTO audit_logs (actor_user_id, action_type, entity_type, metadata_json)
     VALUES (?, ?, 'crypto_payments', ?)`
  ).bind(adminId, action, JSON.stringify({ reference, ...(extra || {}) }));
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requirePlatformAdmin(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    const payments = await db.prepare(
      `SELECT cp.*, u.email, u.full_name,
         (SELECT b.country FROM businesses b
          JOIN business_members m ON m.business_id = b.id
          WHERE m.user_id = u.id LIMIT 1) AS country
       FROM crypto_payments cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.status IN ('pending', 'awaiting_verification')
       ORDER BY cp.created_at DESC LIMIT 50`
    ).all();

    const rows = (payments.results || []).map((p) => ({
      ...p,
      explorer_url: p.tx_hash ? explorerUrl(p.crypto_currency, p.tx_hash) : null,
    }));
    return json({ ok: true, payments: rows });
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
      return json({ ok: false, message: `Payment already ${payment.status}.` }, 400);
    }
    if (payment.expires_at && payment.expires_at < nowSql()) {
      await db.prepare(`UPDATE crypto_payments SET status = 'expired' WHERE reference = ?`)
        .bind(reference).run();
      return json({ ok: false, message: "Payment request expired." }, 410);
    }

    // ---- Reject: reason is mandatory, everything is logged ----
    if (action === "reject") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3) {
        return json({ ok: false, message: "A rejection reason is required." }, 400);
      }
      await db.batch([
        db.prepare(
          `UPDATE crypto_payments SET status = 'rejected', reject_reason = ? WHERE reference = ?`
        ).bind(reason, reference),
        audit(db, auth.user.id, "crypto_payment.rejected", reference, { reason, tier: payment.tier }),
      ]);
      return json({ ok: true, message: "Payment rejected and logged." });
    }

    // ---- Approve: verify on-chain first, no exceptions ----
    let txHash = payment.tx_hash;
    const adminHash = String(body.tx_hash || "").trim();
    if (!txHash && adminHash) {
      // User paid but never submitted: admin may paste the hash they verified.
      txHash = adminHash;
    }
    if (!isValidTxHash(txHash)) {
      return json({ ok: false, message: "No valid transaction hash on this payment. The user must submit one, or paste it with this approval." }, 400);
    }
    // Hash must not already belong to another payment.
    const dup = await db.prepare(
      `SELECT reference FROM crypto_payments WHERE tx_hash = ? AND reference != ? LIMIT 1`
    ).bind(txHash, reference).first();
    if (dup) {
      return json({ ok: false, message: "This transaction hash was already used for another payment." }, 409);
    }

    const verification = await verifyCryptoPayment({
      cryptoCurrency: payment.crypto_currency,
      txHash,
      walletAddress: payment.wallet_address,
      amountUsdCents: payment.amount_usd_cents,
      cryptoAmount: payment.crypto_amount,
    });
    const verificationJson = JSON.stringify({
      ...verification,
      checked_at: new Date().toISOString(),
      explorer_url: explorerUrl(payment.crypto_currency, txHash),
    });

    if (!verification.ok) {
      // Record the failed check so the next reviewer sees the history.
      await db.prepare(
        `UPDATE crypto_payments SET verification_json = ? WHERE reference = ?`
      ).bind(verificationJson, reference).run();
      return json({
        ok: false,
        message: `Verification failed: ${verification.error}`,
        verification,
        explorer_url: explorerUrl(payment.crypto_currency, txHash),
      }, 400);
    }

    // Verified. Activate first (idempotent), then record (retry-safe order).
    const now = nowSql();
    await activateSubscription(db, payment.user_id, payment.tier, payment.billing_cycle, {
      reference,
      method: "crypto",
      crypto_currency: payment.crypto_currency,
      tx_hash: txHash,
    });

    const payerCountry = await getUserCountry(db, payment.user_id);

    await db.batch([
      db.prepare(
        `UPDATE crypto_payments
         SET status = 'confirmed', tx_hash = ?, confirmed_at = ?, confirmed_by = ?, verification_json = ?
         WHERE reference = ?`
      ).bind(txHash, now, auth.user.id, verificationJson, reference),
      db.prepare(
        `INSERT INTO subscription_payments
           (user_id, tier, billing_cycle, amount_kobo, currency, country, payment_method, paystack_reference, status, paid_at)
         VALUES (?, ?, ?, ?, 'USD', ?, 'crypto', ?, 'paid', ?)`
      ).bind(payment.user_id, payment.tier, payment.billing_cycle, payment.amount_usd_cents, payerCountry, reference, now),
      audit(db, auth.user.id, "crypto_payment.approved", reference, {
        tier: payment.tier,
        billing_cycle: payment.billing_cycle,
        amount_usd_cents: payment.amount_usd_cents,
        tx_hash: txHash,
        verification_detail: verification.detail || null,
      }),
    ]);

    return json({
      ok: true,
      message: `Verified on-chain and activated: ${payment.tier} (${payment.billing_cycle}). ${verification.detail || ""}`,
    });
  } catch (error) {
    if (String((error && error.message) || "").includes("UNIQUE")) {
      return json({ ok: false, message: "This transaction hash was already used for another payment." }, 409);
    }
    return json({ ok: false, message: "Could not process payment.", error: String(error) }, 500);
  }
}
