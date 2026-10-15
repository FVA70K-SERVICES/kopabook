// /api/products/[id] — PATCH update, DELETE archive
import { json, getAuthContext, requireAuth, canManage, audit } from "../_utils";

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
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can edit products." }, 403);
    }

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
    if (body.isActive !== undefined) {
      fields.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }
    if (fields.length === 0) {
      return json({ ok: false, message: "Nothing to update." }, 400);
    }

    params.push(id, auth.business.id);
    await context.env.KOPABOOK_DB.prepare(
      `UPDATE products SET ${fields.join(", ")} WHERE id = ? AND business_id = ?`
    )
      .bind(...params)
      .run();

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
