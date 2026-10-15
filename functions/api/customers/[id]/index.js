// /api/customers/:id — GET full customer profile with stats, PATCH edit contact.
import { json, getAuthContext, requireAuth, audit } from "../_utils";

async function getCustomer(context, id, businessId) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT * FROM customers WHERE id = ? AND business_id = ? LIMIT 1`
  )
    .bind(id, businessId)
    .first();
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = Number(context.params.id);
    const customer = await getCustomer(context, id, auth.business.id);
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const db = context.env.KOPABOOK_DB;
    const stats = await db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'sale' THEN amount_delta END), 0) AS lifetime_sales,
         COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN -amount_delta END), 0) AS total_paid,
         COUNT(CASE WHEN entry_type = 'sale' THEN 1 END) AS purchase_count,
         MIN(created_at) AS first_seen,
         MAX(created_at) AS last_activity,
         MAX(CASE WHEN entry_type = 'payment' THEN created_at END) AS last_payment_at
       FROM customer_ledger WHERE customer_id = ?`
    ).bind(id).first();

    const outstanding = await db.prepare(
      `SELECT balance_after FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(id).first();

    const reminders = await db.prepare(
      `SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM reminder_logs
       WHERE customer_id = ? AND kind IN ('debt', 'broadcast')`
    ).bind(id).first();

    const recent = await db.prepare(
      `SELECT id, entry_type, amount_delta, balance_after, note, created_at
       FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(id).all();

    return json({
      ok: true,
      customer,
      stats: {
        lifetime_sales: Number(stats.lifetime_sales) || 0,
        total_paid: Number(stats.total_paid) || 0,
        outstanding: Number(outstanding?.balance_after) || 0,
        purchase_count: Number(stats.purchase_count) || 0,
        first_seen: stats.first_seen,
        last_activity: stats.last_activity,
        last_payment_at: stats.last_payment_at,
        reminders_count: Number(reminders.n) || 0,
        last_reminded_at: reminders.last_at,
      },
      recent: recent.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load customer.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = Number(context.params.id);
    const customer = await getCustomer(context, id, auth.business.id);
    if (!customer) return json({ ok: false, message: "Customer not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];
    for (const [key, col] of [["name", "name"], ["phone", "phone"], ["notes", "notes"], ["tags", "tags"]]) {
      if (body[key] !== undefined) {
        const v = String(body[key]).trim();
        fields.push(`${col} = ?`);
        params.push(key === "name" ? (v || customer.name) : (v || null));
      }
    }
    if (fields.length === 0) return json({ ok: false, message: "Nothing to update." }, 400);

    params.push(id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE customers SET ${fields.join(", ")} WHERE id = ?`
    ).bind(...params).run();

    await audit(context, auth, "customer.update", "customer", id, body);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update customer.", error: String(error) }, 500);
  }
}
