// POST /api/debts/payment — record a debt repayment
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { customerId, amount, paymentMethod, note } = body;

    const amt = Number(amount);
    if (!customerId || Number.isNaN(amt) || amt <= 0) {
      return json({ ok: false, message: "Customer and a valid amount are required." }, 400);
    }

    const customer = await context.env.KOPABOOK_DB.prepare(
      `SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
    )
      .bind(Number(customerId), auth.business.id)
      .first();
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const lastLedger = await context.env.KOPABOOK_DB.prepare(
      `SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
    )
      .bind(Number(customerId))
      .first();
    const prevBalance = lastLedger ? Number(lastLedger.balance_after) : 0;
    const newBalance = Math.round((prevBalance - amt) * 100) / 100;

    const payResult = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO payment_records (business_id, customer_id, amount, payment_method, recorded_by)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, Number(customerId), amt, paymentMethod || "cash", auth.user.id)
      .run();

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
       VALUES (?, 'payment', ?, ?, 'payment', ?, ?)`
    )
      .bind(Number(customerId), -amt, newBalance, payResult.meta.last_row_id, note ? String(note).trim() : null)
      .run();

    await audit(context, auth, "debt.payment", "customer", Number(customerId), { amount: amt });
    return json({ ok: true, newBalance }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record payment.", error: String(error) }, 500);
  }
}
