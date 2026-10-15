// /api/suppliers/[id] — GET single, PATCH update, DELETE delete
import { json, getAuthContext, requireAuth, canManage, audit } from "../_utils";

async function getSupplier(context, auth, id) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT * FROM suppliers WHERE id = ? AND business_id = ? LIMIT 1`
  )
    .bind(id, auth.business.id)
    .first();
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = Number(context.params.id);
    const supplier = await getSupplier(context, auth, id);
    if (!supplier) return json({ ok: false, message: "Supplier not found." }, 404);
    return json({ ok: true, supplier });
  } catch (error) {
    return json({ ok: false, message: "Could not load supplier.", error: String(error) }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can edit suppliers." }, 403);
    }

    const id = Number(context.params.id);
    const supplier = await getSupplier(context, auth, id);
    if (!supplier) return json({ ok: false, message: "Supplier not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return json({ ok: false, message: "Supplier name cannot be empty." }, 400);
      fields.push("name = ?");
      params.push(name);
    }
    if (body.phone !== undefined) {
      fields.push("phone = ?");
      params.push(body.phone ? String(body.phone).trim() : null);
    }
    if (body.address !== undefined) {
      fields.push("address = ?");
      params.push(body.address ? String(body.address).trim() : null);
    }
    if (body.rating !== undefined) {
      const newRating = Number(body.rating);
      if (!(newRating >= 1 && newRating <= 5)) {
        return json({ ok: false, message: "Rating must be between 1 and 5." }, 400);
      }
      const currentRating = Number(supplier.rating) || 0;
      const currentCount = Number(supplier.rating_count) || 0;
      const newAvg = (currentRating * currentCount + newRating) / (currentCount + 1);
      fields.push("rating = ?", "rating_count = rating_count + 1");
      params.push(Math.round(newAvg * 100) / 100);
    }

    if (fields.length === 0) {
      return json({ ok: false, message: "Nothing to update." }, 400);
    }

    params.push(id, auth.business.id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE suppliers SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
    )
      .bind(...params)
      .run();

    await audit(context, auth, "supplier.update", "supplier", id, { ...body });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update supplier.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can delete suppliers." }, 403);
    }

    const id = Number(context.params.id);
    const supplier = await getSupplier(context, auth, id);
    if (!supplier) return json({ ok: false, message: "Supplier not found." }, 404);

    const purchaseCount = await context.env.KOPABOOK_DB.prepare(
      `SELECT COUNT(*) AS n FROM supplier_purchases WHERE supplier_id = ? AND business_id = ?`
    )
      .bind(id, auth.business.id)
      .first();

    if (Number(purchaseCount?.n) > 0) {
      return json(
        { ok: false, message: "This supplier has purchase records and cannot be deleted." },
        400
      );
    }

    await context.env.KOPABOOK_DB.prepare(
      `DELETE FROM suppliers WHERE id = ? AND business_id = ?`
    )
      .bind(id, auth.business.id)
      .run();

    await audit(context, auth, "supplier.delete", "supplier", id, { name: supplier.name });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not delete supplier.", error: String(error) }, 500);
  }
}
