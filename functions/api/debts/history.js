// GET /api/debts/history?customerId= — ledger entries for one debtor
import { json, getAuthContext, requireAuth } from "../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const customerId = Number(url.searchParams.get("customerId"));
    if (!customerId) return json({ ok: false, message: "customerId is required." }, 400);

    const customer = await context.env.KOPABOOK_DB
      .prepare(`SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1`)
      .bind(customerId, auth.business.id)
      .first();
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const entries = await context.env.KOPABOOK_DB
      .prepare(
        `SELECT id, entry_type, amount_delta, balance_after, note, created_at
         FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 50`
      )
      .bind(customerId)
      .all();

    return json({ ok: true, entries: entries.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load history.", error: String(error) }, 500);
  }
}
