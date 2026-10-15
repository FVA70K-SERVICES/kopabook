// /api/customers/[id]/ledger — GET full running-balance ledger for one customer
import { json, getAuthContext, requireAuth } from "../../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = Number(context.params.id);
    const customer = await context.env.KOPABOOK_DB.prepare(
      `SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
    )
      .bind(id, auth.business.id)
      .first();
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const ledger = await context.env.KOPABOOK_DB.prepare(
      `SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 100`
    )
      .bind(id)
      .all();

    const outstanding = ledger.results && ledger.results.length > 0
      ? Number(ledger.results[0].balance_after)
      : 0;

    return json({ ok: true, customer, outstanding, ledger: ledger.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load ledger.", error: String(error) }, 500);
  }
}
