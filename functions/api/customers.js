// /api/customers — GET list (with outstanding balance), POST create
import { json, getAuthContext, requireAuth, audit } from "./_utils";
import { recordHistory } from "./_history.js";

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
    if (q) { sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.tags LIKE ? OR c.notes LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
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
    const { name, phone, notes, email } = body;
    if (!name) return json({ ok: false, message: "Customer name is required." }, 400);
    // Email is optional. A grossly invalid value is refused; it never
    // blocks a sale (this endpoint only creates a customer).
    const cleanEmail = email ? String(email).trim() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ ok: false, message: "Enter a valid email address, or leave it blank." }, 400);
    }

    let result;
    try {
      result = await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO customers (business_id, name, phone, notes, email) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(
          auth.business.id,
          String(name).trim(),
          phone ? String(phone).trim() : null,
          notes ? String(notes).trim() : null,
          cleanEmail
        )
        .run();
    } catch (e) {
      // Migration 0061 not applied yet: no email column. Create without it.
      if (!/no such column: .*email/i.test(String(e && e.message))) throw e;
      result = await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO customers (business_id, name, phone, notes) VALUES (?, ?, ?, ?)`
      )
        .bind(
          auth.business.id,
          String(name).trim(),
          phone ? String(phone).trim() : null,
          notes ? String(notes).trim() : null
        )
        .run();
    }

    await audit(context, auth, "customer.create", "customer", result.meta.last_row_id, { name });
    // WORLD-BEST (merge, History stream §6f).
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "customer",
      entityType: "customer",
      entityId: result.meta.last_row_id,
      summary: `Added customer ${String(name).trim()}`,
      amount: null,
    });
    return json({ ok: true, customerId: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create customer.", error: String(error) }, 500);
  }
}
