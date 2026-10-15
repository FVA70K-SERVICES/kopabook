// /api/debts — GET outstanding debt summary
import { json, getAuthContext, requireAuth } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const debtors = await context.env.KOPABOOK_DB.prepare(
      `SELECT c.id, c.name, c.phone,
              (SELECT balance_after FROM customer_ledger
               WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS outstanding,
              (SELECT created_at FROM customer_ledger
               WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS last_activity,
              (SELECT created_at FROM reminder_logs
               WHERE customer_id = c.id AND kind = 'debt'
               ORDER BY id DESC LIMIT 1) AS last_reminded_at
       FROM customers c
       WHERE c.business_id = ?
       ORDER BY outstanding DESC`
    )
      .bind(auth.business.id)
      .all();

    const list = (debtors.results || []).filter((d) => Number(d.outstanding) > 0);
    const total = list.reduce((sum, d) => sum + Number(d.outstanding), 0);

    return json({ ok: true, total: Math.round(total * 100) / 100, count: list.length, debtors: list });
  } catch (error) {
    return json({ ok: false, message: "Could not load debts.", error: String(error) }, 500);
  }
}
