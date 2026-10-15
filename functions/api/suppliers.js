// /api/suppliers — GET list, POST create
import { json, getAuthContext, requireAuth, audit, toSqliteDate } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const q = url.searchParams.get("q");

    let sql = `SELECT * FROM suppliers WHERE business_id = ?`;
    const params = [auth.business.id];
    if (q) {
      sql += ` AND (name LIKE ? OR phone LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY name ASC`;

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, suppliers: result.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load suppliers.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { name, phone, address } = body;
    if (!name || !String(name).trim()) {
      return json({ ok: false, message: "Supplier name is required." }, 400);
    }

    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO suppliers (business_id, name, phone, address, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        auth.business.id,
        String(name).trim(),
        phone ? String(phone).trim() : null,
        address ? String(address).trim() : null,
        toSqliteDate()
      )
      .run();

    await audit(context, auth, "supplier.create", "supplier", result.meta.last_row_id, { name: String(name).trim() });
    return json({ ok: true, supplierId: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not add supplier.", error: String(error) }, 500);
  }
}
