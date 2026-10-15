// /api/expenses — GET list, POST create
import { json, getAuthContext, requireAuth, audit } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    let sql = `SELECT e.*, c.name AS category_name
               FROM expenses e
               LEFT JOIN expense_categories c ON c.id = e.category_id
               WHERE e.business_id = ?`;
    const params = [auth.business.id];
    if (from) { sql += ` AND e.incurred_on >= ?`; params.push(from); }
    if (to) { sql += ` AND e.incurred_on <= ?`; params.push(to); }
    sql += ` ORDER BY e.incurred_on DESC, e.id DESC LIMIT 200`;

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();

    const totalRow = await context.env.KOPABOOK_DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE business_id = ?` +
      (from ? ` AND incurred_on >= ?` : ``) + (to ? ` AND incurred_on <= ?` : ``)
    ).bind(...params).first();

    const cats = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, name FROM expense_categories WHERE business_id = ? ORDER BY name ASC`
    ).bind(auth.business.id).all();

    return json({
      ok: true,
      expenses: result.results || [],
      total: Number(totalRow?.total || 0),
      categories: cats.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load expenses.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const body = await context.request.json().catch(() => ({}));
    const { amount, categoryId, categoryName, note, incurredOn } = body;

    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) {
      return json({ ok: false, message: "Amount must be greater than zero." }, 400);
    }

    let catId = categoryId ? Number(categoryId) : null;
    if (!catId && categoryName) {
      const existing = await context.env.KOPABOOK_DB.prepare(
        `SELECT id FROM expense_categories WHERE business_id = ? AND name = ? LIMIT 1`
      ).bind(auth.business.id, String(categoryName).trim()).first();
      if (existing) {
        catId = existing.id;
      } else {
        const ins = await context.env.KOPABOOK_DB.prepare(
          `INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, ?, 0)`
        ).bind(auth.business.id, String(categoryName).trim()).run();
        catId = ins.meta.last_row_id;
      }
    }

    const date = incurredOn || new Date().toISOString().slice(0, 10);
    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO expenses (business_id, category_id, amount, note, incurred_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, catId, amt, note ? String(note).trim() : null, date, auth.user.id)
      .run();

    await audit(context, auth, "expense.create", "expense", result.meta.last_row_id, { amount: amt });
    return json({ ok: true, expenseId: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record expense.", error: String(error) }, 500);
  }
}
