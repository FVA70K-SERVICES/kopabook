// /api/products — GET list, POST create
// History (world-best upgrade): creating a product writes a history
// event (type "stock"). Best-effort only: it never throws and never
// blocks the product create.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate, normalizeUnit } from "./_utils";
import { LIMITS, TIER_NAMES, getBusinessOwnerTier } from "./billing";
import { recordHistory } from "./_history";

// Phase 7.3: stock numbers. Missing or blank means the fallback; anything
// present must parse to a finite number, zero or more. Fractional stock is
// fine: sales quantities are fractional too (e.g. 2.5 kg).
function stockNumber(value, fallback, label) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a number, zero or more.` };
  return { value: n };
}

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
    const rows = result.results || [];
    // Phase 4.1: cost_price is owner-only. Staff without can_view_profit
    // get the list without it (price and stock stay visible).
    if (!auth.perms.can_view_profit) {
      for (const r of rows) delete r.cost_price;
    }
    return json({ ok: true, products: rows });
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
    const unit = normalizeUnit(body.unit);

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

    // Phase 7.3: opening stock and reorder level must be real numbers,
    // zero or more. A negative or non-numeric value is refused instead of
    // silently becoming 0 (NaN is falsy, so the old `Number(x || 0)` hid
    // it) or landing in inventory as a negative quantity. Fractional
    // stock is fine: sales quantities are fractional too (e.g. 2.5 kg).
    const opening = stockNumber(openingQuantity, 0, "Opening stock");
    if (opening.error) return json({ ok: false, message: opening.error }, 400);
    const reorder = stockNumber(lowStockThreshold, 5, "Reorder level");
    if (reorder.error) return json({ ok: false, message: reorder.error }, 400);

    const db = context.env.KOPABOOK_DB;

    // Phase 7.3: SKUs are unique per business (migration 0064 enforces it
    // in the database too). A supplied SKU that another product in this
    // business already uses, in any letter case, is refused.
    let finalSku = sku ? String(sku).trim() : null;
    if (finalSku) {
      const clash = await db.prepare(
        `SELECT id FROM products WHERE business_id = ? AND sku = ? COLLATE NOCASE LIMIT 1`
      ).bind(auth.business.id, finalSku).first();
      if (clash) {
        return json({ ok: false, message: "Another product in this business already uses that SKU." }, 409);
      }
    } else {
      const countRow = await db.prepare(
        `SELECT COUNT(*) AS c FROM products WHERE business_id = ?`
      ).bind(auth.business.id).first();
      let n = Number(countRow?.c || 0) + 1;
      for (;;) {
        const candidate = "KB-" + String(n).padStart(4, "0");
        const clash = await db.prepare(
          `SELECT id FROM products WHERE business_id = ? AND sku = ? COLLATE NOCASE LIMIT 1`
        ).bind(auth.business.id, candidate).first();
        if (!clash) { finalSku = candidate; break; }
        n++;
      }
    }

    // Phase 7.3: the unit column (migration 0042) is relied on directly;
    // the old fallback for a database without it is removed (live D1 has
    // the column). A UNIQUE-constraint failure here can only be a race
    // against another create that passed the check above: a supplied SKU
    // answers 409, an auto-generated one picks the next number.
    const userSuppliedSku = !!sku && String(sku).trim() !== "";
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        result = await context.env.KOPABOOK_DB.prepare(
          `INSERT INTO products (business_id, name, sku, unit_price, cost_price, low_stock_threshold, category, unit, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
          .bind(
            auth.business.id,
            String(name).trim(),
            finalSku,
            price,
            Number(costPrice || 0),
            reorder.value,
            category ? String(category).trim() : null,
            unit
          )
          .run();
        break;
      } catch (e) {
        if (!/UNIQUE constraint failed/i.test(String(e && e.message))) throw e;
        if (userSuppliedSku) {
          return json({ ok: false, message: "Another product in this business already uses that SKU." }, 409);
        }
        const m = /KB-(\d+)/.exec(finalSku || "");
        finalSku = "KB-" + String((m ? Number(m[1]) : 0) + 1).padStart(4, "0");
      }
    }
    if (!result) return json({ ok: false, message: "Could not create product." }, 500);
    const productId = result.meta.last_row_id;

    await context.env.KOPABOOK_DB.prepare(
      `INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level)
       VALUES (?, ?, ?)`
    )
      .bind(productId, opening.value, reorder.value)
      .run();

    if (opening.value > 0) {
      await context.env.KOPABOOK_DB.prepare(
        `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
         VALUES (?, 'opening', ?, 'manual', 'Opening stock', ?)`
      )
        .bind(productId, opening.value, auth.user.id)
        .run();
    }

    await audit(context, auth, "product.create", "product", productId, { name });

    // History: a new product entering the business is a stock event.
    // Amount is null: the price is not money moved.
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "stock",
      entityType: "product",
      entityId: productId,
      summary: `Added product ${String(name).trim()} — ${auth.business.currency} ${price.toLocaleString("en-US")}${opening.value > 0 ? `, opening stock ${opening.value}` : ""}`,
      amount: null,
    });

    return json({ ok: true, productId }, 201);
  } catch (error) {
    return json({ ok: false, message: "Could not create product.", error: String(error) }, 500);
  }
}
