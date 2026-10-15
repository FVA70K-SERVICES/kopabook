// /api/customers — GET list (with outstanding balance), POST create
import { json, getAuthContext, requireAuth, audit } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const q = url.searchParams.get("q");
    const debtorsOnly = url.searchParams.get("debtors") === "1";

    let sql = `SELECT c.*,
                 COALESCE((SELECT balance_after FROM customer_ledger
                           WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS outstanding
               FROM customers c
               WHERE c.business_id = ?`;
    const params = [auth.business.id];
    if (q) { sql += ` AND (c.name LIKE ? OR c.phone LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
    sql += ` ORDER BY c.name ASC`;

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    let customers = result.results || [];
    if (debtorsOnly) customers = customers.filter((c) => Number(c.outstanding) > 0);

    return json({ ok: true, customers });
  } catch (error) {
    return json({ ok: false, message: "Could not load customers.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { name, phone, notes } = body;
    if (!name) return json({ ok: false, message: "Customer name is required." }, 400);

    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO customers (business_id, name, phone, notes) VALUES (?, ?, ?, ?)`
    )
      .bind(
        auth.business.id,
        String(name).trim(),
        phone ? String(phone).trim() : null,
        notes ? String(notes).trim() : null
      )
      .run();

    await audit(context, auth, "customer.create", "customer", result.meta.last_row_id, { name });
    return json({ ok: true, customerId: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create customer.", error: String(error) }, 500);
  }
}
