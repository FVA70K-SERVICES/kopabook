// /api/suppliers/purchase — POST record a purchase from a supplier
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_expenses", "Only staff with expense permission can record supplier purchases.");
    if (permDenied) return permDenied;

    const body = await context.request.json().catch(() => ({}));
    const supplierId = Number(body.supplierId);
    const amount = Number(body.amount);
    const note = body.note ? String(body.note).trim() : null;
    const purchasedOn = body.purchasedOn ? String(body.purchasedOn) : new Date().toISOString().slice(0, 10);
    const recordExpense = body.recordExpense !== false;

    if (!supplierId) {
      return json({ ok: false, message: "Supplier is required." }, 400);
    }
    if (!(amount > 0)) {
      return json({ ok: false, message: "Amount must be greater than zero." }, 400);
    }

    const supplier = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, name, verification_status FROM suppliers
       WHERE id = ? AND business_id = ? LIMIT 1`
    )
      .bind(supplierId, auth.business.id)
      .first();

    if (!supplier) return json({ ok: false, message: "Supplier not found." }, 404);

    const now = toSqliteDate();
    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO supplier_purchases (business_id, supplier_id, amount, note, purchased_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(auth.business.id, supplierId, amount, note, purchasedOn, now)
      .run();
    const purchaseId = result.meta.last_row_id;

    // A supplier purchase is money out: mirror it as an expense so Expenses
    // totals and report profits stay correct for the owner. Linked, never double.
    if (recordExpense) {
      let cat = await context.env.KOPABOOK_DB.prepare(
        `SELECT id FROM expense_categories WHERE business_id = ? AND name = 'Supplier purchases' LIMIT 1`
      ).bind(auth.business.id).first();
      if (!cat) {
        const cr = await context.env.KOPABOOK_DB.prepare(
          `INSERT INTO expense_categories (business_id, name, is_default) VALUES (?, 'Supplier purchases', 1)`
        ).bind(auth.business.id).run();
        cat = { id: cr.meta.last_row_id };
      }
      const expenseNote = `Purchase from ${supplier.name}` + (note ? ` — ${note}` : "");
      await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO expenses (business_id, category_id, amount, note, incurred_on, created_by, supplier_id, supplier_purchase_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(auth.business.id, cat.id, amount, expenseNote, purchasedOn, auth.user.id, supplierId, purchaseId)
        .run();
    }

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE suppliers SET trade_count = trade_count + 1 WHERE id = ? AND business_id = ?`
    )
      .bind(supplierId, auth.business.id)
      .run();

    await audit(context, auth, "supplier.purchase", "supplier_purchase", purchaseId, {
      supplier_id: supplierId,
      supplier_name: supplier.name,
      amount,
      note,
      expense_recorded: recordExpense,
    });

    const response = { ok: true, purchaseId, expenseRecorded: recordExpense };
    if (supplier.verification_status === "unverified") {
      response.warning = true;
      response.message = "This supplier is not verified yet. Confirm their details before paying.";
    }
    return json(response, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record purchase.", error: String(error) }, 500);
  }
}
