// /api/products — GET list, POST create
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "./_utils";
import { LIMITS, TIER_NAMES, getBusinessOwnerTier } from "./billing";

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
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can add products.");
    if (permDenied) return permDenied;

    const body = await context.request.json().catch(() => ({}));
    const { name, sku, unitPrice, costPrice, openingQuantity, lowStockThreshold, category } = body;

    if (!name || unitPrice === undefined || unitPrice === null) {
      return json({ ok: false, message: "Product name and unit price are required." }, 400);
    }

    // Tier limit: free accounts get 100 products/services per business, then upgrade.
    const { tier } = await getBusinessOwnerTier(context.env.KOPABOOK_DB, auth.business.id);
    const maxProducts = LIMITS[tier].products;
    if (maxProducts !== null) {
      const count = await context.env.KOPABOOK_DB.prepare(
        `SELECT (SELECT COUNT(*) FROM products WHERE business_id = ? AND is_active = 1)
              + (SELECT COUNT(*) FROM services WHERE business_id = ? AND is_active = 1) AS n`
      ).bind(auth.business.id, auth.business.id).first();
      if (Number(count && count.n) >= maxProducts) {
        return json({
          ok: false,
          upgradeRequired: true,
          message: `Your ${TIER_NAMES[tier]} plan allows ${maxProducts} products and services per business. Upgrade to add more.`,
        }, 403);
      }
    }
    const price = Number(unitPrice);
    if (Number.isNaN(price) || price < 0) {
      return json({ ok: false, message: "Unit price must be a valid number." }, 400);
    }

    const opening = Number(openingQuantity || 0);
    const reorder = Number(lowStockThreshold === undefined ? 5 : lowStockThreshold);

    const db = context.env.KOPABOOK_DB;

    // Every product gets a trackable ID. Auto-generate KB-0001 style codes
    // per business when the owner leaves the field blank.
    let finalSku = sku ? String(sku).trim() : null;
    if (!finalSku) {
      const countRow = await db.prepare(
        `SELECT COUNT(*) AS c FROM products WHERE business_id = ?`
      ).bind(auth.business.id).first();
      let n = Number(countRow?.c || 0) + 1;
      for (;;) {
        const candidate = "KB-" + String(n).padStart(4, "0");
        const clash = await db.prepare(
          `SELECT id FROM products WHERE business_id = ? AND sku = ? LIMIT 1`
        ).bind(auth.business.id, candidate).first();
        if (!clash) { finalSku = candidate; break; }
        n++;
      }
    }

    const result = await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, category, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(
        auth.business.id,
        String(name).trim(),
        finalSku,
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
