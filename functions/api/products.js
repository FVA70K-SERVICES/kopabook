// /api/products — GET list, POST create
import { json, getAuthContext, requireAuth, canManage, audit, toSqliteDate } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const q = url.searchParams.get("q");
    const activeOnly = url.searchParams.get("active") !== "all";

    let sql = `SELECT p.*, COALESCE(i.quantity_on_hand, 0) AS stock, COALESCE(i.reorder_level, p.low_stock_threshold) AS reorder_level
               FROM products p
               LEFT JOIN inventory_items i ON i.product_id = p.id
               WHERE p.business_id = ?`;
    const params = [auth.business.id];
    if (activeOnly) sql += ` AND p.is_active = 1`;
    if (q) {
      sql += ` AND (p.name LIKE ? OR p.sku LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY p.name ASC`;

    const result = await context.env.KOPABOOK_DB.prepare(sql).bind(...params).all();
    return json({ ok: true, products: result.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load products.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can add products." }, 403);
    }

    const body = await context.request.json().catch(() => ({}));
    const { name, sku, unitPrice, costPrice, openingQuantity, lowStockThreshold, category } = body;

    if (!name || unitPrice === undefined || unitPrice === null) {
      return json({ ok: false, message: "Product name and unit price are required." }, 400);
    }
    const price = Number(unitPrice);
    if (Number.isNaN(price) || price < 0) {
      return json({ ok: false, message: "Unit price must be a valid number." }, 400);
    }

    const opening = Number(openingQuantity || 0);
    const reorder = Number(lowStockThreshold === undefined ? 5 : lowStockThreshold);

    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, category, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(
        auth.business.id,
        String(name).trim(),
        sku ? String(sku).trim() : null,
        price,
        Number(costPrice || 0),
        reorder,
        category ? String(category).trim() : null
      )
      .run();
    const productId = result.meta.last_row_id;

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level)
       VALUES (?, ?, ?)`
    )
      .bind(productId, opening, reorder)
      .run();

    if (opening > 0) {
      await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
         VALUES (?, 'opening', ?, 'manual', 'Opening stock', ?)`
      )
        .bind(productId, opening, auth.user.id)
        .run();
    }

    await audit(context, auth, "product.create", "product", productId, { name });

    return json({ ok: true, productId }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create product.", error: String(error) }, 500);
  }
}
