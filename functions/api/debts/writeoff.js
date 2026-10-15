// POST /api/debts/writeoff — clear a debtor's balance as a bad debt
import { json, getAuthContext, requireAuth, audit } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { customerId, note } = body;
    if (!customerId) return json({ ok: false, message: "customerId is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const customer = await db
      .prepare(`SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1`)
      .bind(Number(customerId), auth.business.id)
      .first();
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const lastLedger = await db
      .prepare(`SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(Number(customerId))
      .first();
    const prevBalance = lastLedger ? Number(lastLedger.balance_after) : 0;
    if (prevBalance <= 0) return json({ ok: false, message: "No outstanding balance to write off." }, 400);

    await db
      .prepare(
        `INSERT INTO customer_ledger (customer_id, entry_type, amount_delta, balance_after, source_type, source_id, note)
         VALUES (?, 'writeoff', ?, 0, 'manual', NULL, ?)`
      )
      .bind(Number(customerId), -prevBalance, note ? String(note).trim() : "Written off as bad debt")
      .run();

    await audit(context, auth, "debt.writeoff", "customer", Number(customerId), { amount: prevBalance });
    return json({ ok: true, writtenOff: prevBalance }, 200);
  } catch (error) {
    return json({ ok: false, message: "Could not write off debt.", error: String(error) }, 500);
  }
}
