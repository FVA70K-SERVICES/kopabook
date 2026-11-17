// /api/products/[id] — PATCH update, DELETE archive
import { json, getAuthContext, requireAuth, requirePerm, audit, normalizeUnit } from "../_utils";
import { recordHistory } from "../_history.js";

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

    // Phase 7.3: prices and stock levels must be real numbers, zero or
    // more. The old code pushed Number("abc") — NaN, or a raw string —
    // straight into the row.
    for (const [key, col] of [
      ["name", "name"],
      ["sku", "sku"],
      ["unitPrice", "unit_price"],
      ["costPrice", "cost_price"],
      ["lowStockThreshold", "low_stock_threshold"],
      ["category", "category"],
    ]) {
      if (body[key] !== undefined) {
        if (key === "unitPrice" || key === "costPrice") {
          const v = Number(body[key]);
          if (!Number.isFinite(v) || v < 0) {
            return json({ ok: false, message: `${key === "unitPrice" ? "Unit price" : "Cost price"} must be a valid number, zero or more.` }, 400);
          }
        }
        if (key === "lowStockThreshold") {
          const v = Number(body[key]);
          if (!Number.isFinite(v) || v < 0) {
            return json({ ok: false, message: "Reorder level must be a number, zero or more." }, 400);
          }
        }
        fields.push(`${col} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() || null : Number(body[key]));
      }
    }
    // Phase 7.3: SKUs are unique per business (migration 0064). Changing
    // a SKU to one another product in this business already uses — in any
    // letter case — is refused. The product itself is excluded.
    if (body.sku !== undefined && typeof body.sku === "string" && body.sku.trim() !== "") {
      const clash = await context.env.KOPABOOK_DB.prepare(
        `SELECT id FROM products WHERE business_id = ? AND sku = ? COLLATE NOCASE AND id != ? LIMIT 1`
      ).bind(auth.business.id, body.sku.trim(), id).first();
      if (clash) {
        return json({ ok: false, message: "Another product in this business already uses that SKU." }, 409);
      }
    }
    // Unit of measure (migration 0042, live D1 has the column): relied on
    // directly, no fallback for a database without it.
    let unitUpdate = null;
    if (body.unit !== undefined) unitUpdate = normalizeUnit(body.unit);
    if (body.isActive !== undefined) {
      fields.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }
    // Phase 7.3: a unit-only update is a real update (the old guard
    // returned "Nothing to update" because the unit column was not in
    // `fields`).
    if (fields.length === 0 && unitUpdate === null) {
      return json({ ok: false, message: "Nothing to update." }, 400);
    }

    params.push(id, auth.business.id);
    // Phase 7.3: single UPDATE against the unit column. A UNIQUE failure
    // can only be a race against the SKU check above.
    const unitFields = unitUpdate !== null ? [...fields, "unit = ?"] : fields;
    const unitParams = unitUpdate !== null
      ? [...params.slice(0, -2), unitUpdate, ...params.slice(-2)]
      : params;
    try {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE products SET ${unitFields.join(", ")} WHERE id = ? AND business_id = ?`
      )
        .bind(...unitParams)
        .run();
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String(e && e.message))) {
        return json({ ok: false, message: "Another product in this business already uses that SKU." }, 409);
      }
      throw e;
    }

    if (body.lowStockThreshold !== undefined) {
      await context.env.KOPABOOK_DB.prepare(
        `UPDATE inventory_items SET reorder_level = ? WHERE product_id = ?`
      )
        .bind(Number(body.lowStockThreshold), id)
        .run();
    }

    await audit(context, auth, "product.update", "product", id, body);
    // WORLD-BEST (merge, History stream §6h, adapted: the price comes
    // from the request body when it is set, else the stored row).
    const newPrice = body.unitPrice !== undefined ? Number(body.unitPrice) : Number(product.unit_price);
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "stock",
      entityType: "product",
      entityId: id,
      summary: `Updated product ${product.name}${Number.isFinite(newPrice) ? ` — ${auth.business.currency} ${newPrice.toLocaleString("en-US")}` : ""}`,
      amount: null,
    });
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
    // WORLD-BEST (merge): an archive leaves a trace like any other change.
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "stock",
      entityType: "product",
      entityId: id,
      summary: `Archived product ${product.name}`,
      amount: null,
    });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: "Could not archive product.", error: String(error) }, 500);
  }
}
