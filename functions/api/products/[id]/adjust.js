// /api/products/[id]/adjust — stock count correction with a reason.
// POST { delta, reason }: adjust stock by delta, recording why.
// GET: adjustment history for the product (newest first).
//
// Rules (roadmap: stock done fully, in part):
// - A reason is REQUIRED. An empty reason is a 400 with a clear message.
// - Role-checked server-side: can_manage_products, the same flag the
//   product list uses (owners and partners always pass). Hiding the button
//   is not the check.
// - The adjustment is a NEW row. The original counts stay: stock_adjustments
//   keeps the reason and delta, inventory_movements keeps an 'adjustment'
//   entry, and inventory_items.quantity_on_hand moves by delta. History is
//   never rewritten.
// - Stock can never go below zero: a delta that would do that is refused.
// - Business-scoped: the product must belong to the caller's business.
// - No purchase orders, goods-received notes, batch/expiry, or
//   multi-location stock here: those are named next steps.
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "../../_utils";
import { recordHistory } from "../../_history.js";

const REASON_MAX = 200;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function productIdFrom(context) {
  // Cloudflare Pages Functions dynamic segment.
  const param = context.params && context.params.id;
  if (param) return Number(param);
  // Fallback: parse /api/products/<id>/adjust from the URL.
  const m = String(context.request.url).match(/\/products\/(\d+)\/adjust/);
  return m ? Number(m[1]) : NaN;
}

async function getProduct(context, id, businessId) {
  return context.env.KOPABOOK_DB.prepare(
    `SELECT p.*, COALESCE(i.quantity_on_hand, 0) AS stock
     FROM products p
     LEFT JOIN inventory_items i ON i.product_id = p.id
     WHERE p.id = ? AND p.business_id = ? LIMIT 1`
  ).bind(id, businessId).first();
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = productIdFrom(context);
    if (!id) return json({ ok: false, message: "Product id is required." }, 400);
    const product = await getProduct(context, id, auth.business.id);
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT a.id, a.delta, a.reason, a.created_by, a.created_at,
              u.full_name AS created_by_name
       FROM stock_adjustments a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.business_id = ? AND a.product_id = ?
       ORDER BY a.id DESC LIMIT 50`
    ).bind(auth.business.id, id).all();

    return json({ ok: true, product: { id: product.id, name: product.name }, adjustments: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load adjustments.", error: String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can adjust stock.");
    if (permDenied) return permDenied;

    const id = productIdFrom(context);
    if (!id) return json({ ok: false, message: "Product id is required." }, 400);

    const body = await context.request.json().catch(() => ({}));
    const delta = Number(body.delta);
    const reason = String(body.reason === undefined || body.reason === null ? "" : body.reason).trim();
    if (!reason) {
      return json({ ok: false, message: "A reason is required for every stock adjustment. Say what changed and why." }, 400);
    }
    if (reason.length > REASON_MAX) {
      return json({ ok: false, message: `Reason must be ${REASON_MAX} characters or less.` }, 400);
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return json({ ok: false, message: "Enter a quantity change, for example 10 or -3. Zero changes nothing." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const product = await getProduct(context, id, auth.business.id);
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const currentStock = Number(product.stock) || 0;
    const newStock = round2(currentStock + delta);
    if (newStock < 0) {
      return json({ ok: false, message: `That would take stock below zero. ${product.name} has ${currentStock} in stock.` }, 400);
    }

    const now = toSqliteDate();
    // Keep the stock row even if one was never created for this product.
    const inv = await db.prepare(
      `SELECT product_id FROM inventory_items WHERE product_id = ? LIMIT 1`
    ).bind(id).first();
    if (inv) {
      await db.prepare(
        `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ?, updated_at = ?
         WHERE product_id = ?`
      ).bind(delta, now, id).run();
    } else {
      await db.prepare(
        `INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level)
         VALUES (?, ?, ?)`
      ).bind(id, newStock, Number(product.low_stock_threshold ?? 5)).run();
    }

    // The adjustment itself: a new row, with the reason. The original
    // counts stay untouched in history.
    await db.prepare(
      `INSERT INTO stock_adjustments (business_id, product_id, delta, reason, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(auth.business.id, id, delta, reason, auth.user.id).run();

    // Same event in the stock movement history the Products page already shows.
    await db.prepare(
      `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
       VALUES (?, 'adjustment', ?, 'manual', ?, ?)`
    ).bind(id, delta, reason, auth.user.id).run();

    await audit(context, auth, "stock.adjust", "product", id, { delta, reason, from: currentStock, to: newStock });
    // WORLD-BEST (merge, History stream §6i, adapted to this file's names:
    // delta + reason, not quantityDelta + note).
    await recordHistory(context.env, {
      businessId: auth.business.id,
      actorId: auth.user.id,
      actorName: auth.user.fullName,
      actorRole: auth.business.role,
      type: "stock",
      entityType: "product",
      entityId: id,
      summary: `Adjusted ${product.name} stock by ${delta > 0 ? "+" : ""}${delta} (${reason})`,
      amount: null,
    });
    return json({ ok: true, productId: id, delta, reason, previousStock: currentStock, newStock });
  } catch (error) {
    return json({ ok: false, message: "Could not adjust stock.", error: String(error) }, 500);
  }
}
