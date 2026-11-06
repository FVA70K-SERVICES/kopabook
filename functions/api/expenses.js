// /api/expenses — GET list, POST create
// History (world-best upgrade): recording and removing an expense writes
// a history event (type "expense"). The write is best-effort: it never
// throws and never blocks the expense itself.
import { json, getAuthContext, requireAuth, requirePerm, audit } from "./_utils";
import { recordHistory } from "./_history";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    let sql = `SELECT e.*, c.name AS category_name, s.name AS supplier_name
               FROM expenses e
               LEFT JOIN expense_categories c ON c.id = e.category_id
               LEFT JOIN suppliers s ON s.id = e.supplier_id
               WHERE e.business_id = ?`;
    const params = [auth.business.id];
    if (from) { sql += ` AND e.incurred_on >= ?`; params.push(from); }
    if (to) { sql += ` AND e.incurred_on <= ?`; params.push(to); }
    sql += ` ORDER BY e.incurred_on DESC, e.id DESC LIMIT 200`;

    // The three reads are independent: run them in parallel instead of
    // one after another so the list, its total and its categories arrive
    // in a single round trip. Same rows, same shape, same auth.
    const [result, totalRow, cats] = await Promise.all([
      context.env.KOPABOOK_DB.prepare(sql).bind(...params).all(),
      context.env.KOPABOOK_DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE business_id = ?` +
        (from ? ` AND incurred_on >= ?` : ``) + (to ? ` AND incurred_on <= ?` : ``)
      ).bind(...params).first(),
      context.env.KOPABOOK_DB.prepare(
        `SELECT id, name FROM expense_categories WHERE business_id = ? ORDER BY name ASC`
      ).bind(auth.business.id).all(),
    ]);

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
    const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can record expenses.");
    if (permDenied) return permDenied;

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
    // History: one plain line, amount in business currency.
    const catName = catId
      ? (await context.env.KOPABOOK_DB.prepare(`SELECT name FROM expense_categories WHERE id = ? LIMIT 1`).bind(catId).first())?.name
      : null;
    const label = (note ? String(note).trim() : "") || catName || categoryName || "Expense";
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "expense",
      entityType: "expense",
      entityId: result.meta.last_row_id,
      summary: `Recorded expense: ${label} — ${auth.business.currency} ${amt.toLocaleString("en-US")}`,
      amount: amt,
    });
    return json({ ok: true, expenseId: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record expense.", error: String(error) }, 500);
  }
}

// DELETE /api/expenses?id= — delete an expense record (owner/partner or expense permission).
// A supplier purchase behind the expense is kept; only the expense record is removed.
export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can delete expenses.");
    if (permDenied) return permDenied;

    const url = new URL(context.request.url);
    const id = Number(url.searchParams.get("id")) || null;
    if (!id) return json({ ok: false, message: "Expense id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const row = await db.prepare(
      `SELECT id, amount, note FROM expenses WHERE id = ? AND business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!row) return json({ ok: false, message: "Expense not found." }, 404);

    await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();

    await audit(context, auth, "expense.delete", "expense", id, { amount: row.amount });
    // History keeps the record that an expense was removed (the history
    // row itself is never deleted).
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "expense",
      entityType: "expense",
      entityId: id,
      summary: `Removed expense of ${auth.business.currency} ${Number(row.amount).toLocaleString("en-US")}${row.note ? ` (${String(row.note).trim()})` : ""}`,
      amount: Number(row.amount),
    });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete expense.", error: String(error) }, 500);
  }
}
