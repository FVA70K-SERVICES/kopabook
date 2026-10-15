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

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE suppliers SET trade_count = trade_count + 1 WHERE id = ? AND business_id = ?`
    )
      .bind(supplierId, auth.business.id)
      .run();

    await audit(context, auth, "supplier.purchase", "supplier_purchase", result.meta.last_row_id, {
      supplier_id: supplierId,
      supplier_name: supplier.name,
      amount,
      note,
    });

    const response = { ok: true, purchaseId: result.meta.last_row_id };
    if (supplier.verification_status === "unverified") {
      response.warning = true;
      response.message = "This supplier is not verified yet. Confirm their details before paying.";
    }
    return json(response, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not record purchase.", error: String(error) }, 500);
  }
}
