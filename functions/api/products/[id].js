// /api/products/[id] — PATCH update, DELETE archive
import { json, getAuthContext, requireAuth, requirePerm, audit, normalizeUnit } from "../_utils";

async function getProduct(context, auth, id) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT * FROM products WHERE id = ? AND business_id = ? LIMIT 1`
  )
    .bind(id, auth.business.id)
    .first();
}

export async function onRequestPatch(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can edit products.");
    if (permDenied) return permDenied;

    const id = Number(context.params.id);
    const product = await getProduct(context, auth, id);
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const body = await context.request.json().catch(() => ({}));
    const fields = [];
    const params = [];

    for (const [key, col] of [
      ["name", "name"],
      ["sku", "sku"],
      ["unitPrice", "unit_price"],
      ["costPrice", "cost_price"],
      ["lowStockThreshold", "low_stock_threshold"],
      ["category", "category"],
    ]) {
      if (body[key] !== undefined) {
        fields.push(`${col} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() || null : Number(body[key]));
      }
    }
    // Unit of measure (migration 0042). Falls back gracefully if the
    // column does not exist yet on the database.
    let unitUpdate = null;
    if (body.unit !== undefined) unitUpdate = normalizeUnit(body.unit);
    if (body.isActive !== undefined) {
      fields.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }
    if (fields.length === 0) {
      return json({ ok: false, message: "Nothing to update." }, 400);
    }

    params.push(id, auth.business.id);
    try {
      const unitFields = unitUpdate !== null ? [...fields, "unit = ?"] : fields;
      const unitParams = unitUpdate !== null
        ? [...params.slice(0, -2), unitUpdate, ...params.slice(-2)]
        : params;
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE products SET ${unitFields.join(", ")} WHERE id = ? AND business_id = ?`
      )
        .bind(...unitParams)
        .run();
    } catch (e) {
      // Migration 0042 not applied yet: retry without the unit column.
      if (unitUpdate === null || !/no such column: unit/i.test(String(e && e.message))) throw e;
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE products SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
      )
        .bind(...params)
        .run();
    }

    if (body.lowStockThreshold !== undefined) {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE inventory_items SET reorder_level = ? WHERE product_id = ?`
      )
        .bind(Number(body.lowStockThreshold), id)
        .run();
    }

    await audit(context, auth, "product.update", "product", id, body);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not update product.", error: String(error) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (auth.business.role !== "owner") {
      return json({ ok: false, message: "Only the owner can archive products." }, 403);
    }

    const id = Number(context.params.id);
    const product = await getProduct(context, auth, id);
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    await context.env.KOPABOOK_DB.prepare(
      `UPDATE products SET is_active = 0 WHERE id = ? AND business_id = ?`
    )
      .bind(id, auth.business.id)
      .run();

    await audit(context, auth, "product.archive", "product", id, { name: product.name });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not archive product.", error: String(error) }, 500);
  }
}
