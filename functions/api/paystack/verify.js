// GET /api/paystack/verify?reference=xxx — confirm a Paystack payment and activate the tier.
// Called when the user returns from Paystack; the webhook also activates independently.
import { json, getAuthContext, requireAuth } from "../_utils";

function toSqlite(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function activateSubscription(db, userId, tier, cycle, psData, reference) {
  const now = new Date();
  const end = new Date(now);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);

  const customerCode = (psData && psData.customer && psData.customer.customer_code) || null;

  await db.prepare(
    `INSERT INTO account_subscriptions (user_id, tier, status, billing_cycle, paystack_customer_code, updated_at, current_period_start, current_period_end)
     VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, status = 'active',
       billing_cycle = excluded.billing_cycle,
       paystack_customer_code = COALESCE(excluded.paystack_customer_code, paystack_customer_code),
       updated_at = excluded.updated_at,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end`
  ).bind(userId, tier, cycle, customerCode, toSqlite(now), toSqlite(now), toSqlite(end)).run();

  // Mark only the specific payment as paid, by its Paystack reference.
  if (reference) {
    await db.prepare(
      `UPDATE subscription_payments SET status = 'paid', paid_at = ?,
         paystack_customer_code = COALESCE(?, paystack_customer_code)
       WHERE paystack_reference = ? AND status != 'paid'`
    ).bind(toSqlite(now), customerCode, reference).run();
  }
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const reference = url.searchParams.get("reference");
    if (!reference) return json({ ok: false, message: "Missing payment reference." }, 400);

    const secret = context.env.PAYSTACK_SECRET_KEY;
    if (!secret) return json({ ok: false, message: "Payments are not connected yet." }, 503);

    const db = context.env.KOPABOOK_DB;
    const payment = await db.prepare(
      `SELECT * FROM subscription_payments WHERE paystack_reference = ? AND user_id = ? LIMIT 1`
    ).bind(reference, auth.user.id).first();
    if (!payment) return json({ ok: false, message: "Payment not found." }, 404);
    if (payment.status === "paid") {
      return json({ ok: true, already: true, tier: payment.tier, message: "Your plan is already active." });
    }

    const psRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const psData = await psRes.json().catch(() => ({}));
    if (!psData.status || !psData.data || psData.data.status !== "success") {
      return json({ ok: false, message: "Payment not confirmed yet. If you just paid, wait a moment and try again." }, 402);
    }
    // Safety: the paid amount must match what we asked for.
    if (Number(psData.data.amount) !== Number(payment.amount_kobo)) {
      return json({ ok: false, message: "Payment amount mismatch. Contact support." }, 402);
    }

    await activateSubscription(db, auth.user.id, payment.tier, payment.billing_cycle, psData.data, reference);
    return json({ ok: true, tier: payment.tier, message: `Your ${payment.tier} plan is now active.` });
  } catch (error) {
    return json({ ok: false, message: "Could not verify the payment.", error: String(error) }, 500);
  }
}
