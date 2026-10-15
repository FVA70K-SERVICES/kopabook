// POST /api/debts/add — record a debt by hand (money lent, goods on credit, etc.)
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { customerId, customerName, amount, note } = body;

    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) {
      return json({ ok: false, message: "A valid amount is required." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    let custId = null;

    if (customerId) {
      const c = await db
        .prepare(`SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1`)
        .bind(Number(customerId), auth.business.id)
        .first();
      if (!c) return json({ ok: false, message: "Customer not found." }, 404);
      custId = c.id;
    } else {
      const name = customerName ? String(customerName).trim() : "";
      if (!name) return json({ ok: false, message: "Pick a customer or enter a name." }, 400);
      const r = await db
        .prepare(`INSERT INTO customers (business_id, name) VALUES (?, ?)`)
        .bind(auth.business.id, name)
        .run();
      custId = r.meta.last_row_id;
    }

    const lastLedger = await db
      .prepare(`SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(custId)
      .first();
    const prevBalance = lastLedger ? Number(lastLedger.balance_after) : 0;
    const newBalance = Math.round((prevBalance + amt) * 100) / 100;

    await db
      .prepare(
        `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
         VALUES (?, 'debt', ?, ?, 'manual', NULL, ?)`
      )
      .bind(custId, amt, newBalance, note ? String(note).trim() : null)
      .run();

    await audit(context, auth, "debt.add", "customer", custId, { amount: amt, note: note || null });
    return json({ ok: true, customerId: custId, newBalance }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record debt.", error: String(error) }, 500);
  }
}
