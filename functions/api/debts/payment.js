// POST /api/debts/payment — record a debt repayment
import { json, getAuthContext, requireAuth, audit } from "../_utils";
import { recordHistory } from "../_history.js";

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

    // Overpayment guard: a repayment can never push the balance below zero.
    // Any excess comes back as change instead of creating a negative balance.
    const applied = Math.min(amt, Math.max(0, prevBalance));
    const change = Math.round((amt - applied) * 100) / 100;
    const newBalance = Math.round((prevBalance - applied) * 100) / 100;

    const payResult = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO payment_records (business_id, customer_id, amount, payment_method, recorded_by)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, Number(customerId), applied, paymentMethod || "cash", auth.user.id)
      .run();

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
       VALUES (?, 'payment', ?, ?, 'payment', ?, ?)`
    )
      .bind(Number(customerId), -applied, newBalance, payResult.meta.last_row_id, note ? String(note).trim() : null)
      .run();

    await audit(context, auth, "debt.payment", "customer", Number(customerId), { amount: applied, change });
    // WORLD-BEST (merge, History stream §6c).
    const custRow = await context.env.KOPABOOK_DB.prepare(`SELECT name FROM customers WHERE id = ? AND business_id = ? LIMIT 1`).bind(Number(customerId), auth.business.id).first();
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "payment",
      entityType: "customer",
      entityId: Number(customerId),
      summary: `Recorded payment of ${auth.business.currency} ${Number(applied).toLocaleString("en-US")} from ${custRow?.name || "customer"}${newBalance > 0 ? ` — ${auth.business.currency} ${Number(newBalance).toLocaleString("en-US")} still owed` : " — debt fully cleared"}`,
      amount: Number(applied),
    });
    return json({ ok: true, newBalance, applied, change }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record payment.", error: String(error) }, 500);
  }
}
