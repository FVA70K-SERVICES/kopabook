// POST /api/stock/adjust — manual stock increase/decrease (owner/manager only)
import { json, getAuthContext, requireAuth, requirePerm, audit, toSqliteDate } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const permDenied = requirePerm(auth, "can_manage_products", "Only staff with product permission can adjust stock.");
    if (permDenied) return permDenied;

    const body = await context.request.json().catch(() => ({}));
    const { productId, quantityDelta, note } = body;
    const delta = Number(quantityDelta);
    if (!productId || Number.isNaN(delta) || delta === 0) {
      return json({ ok: false, message: "Product and a non-zero quantity change are required." }, 400);
    }

    const db = context.env.KOPABOOK_DB;
    const product = await db.prepare(
      `SELECT p.id, p.name, COALESCE(i.quantity_on_hand, 0) AS stock
       FROM products p
       LEFT JOIN inventory_items i ON i.product_id = p.id
       WHERE p.id = ? AND p.business_id = ? LIMIT 1`
    )
      .bind(Number(productId), auth.business.id)
      .first();
    if (!product) return json({ ok: false, message: "Product not found." }, 404);
    if (product.stock + delta < 0) {
      return json({ ok: false, message: `Adjustment would take ${product.name} below zero.` }, 400);
    }

    const now = toSqliteDate();
    // Phase 4.1: one atomic upsert, guarded so stock can never go below
    // zero — even when two adjustments race. The WHERE clause is the
    // authority, not the read above: a concurrent adjustment that already
    // spent the stock makes this one match 0 rows and it is refused.
    // The upsert also creates the inventory row for a product that never
    // had one (a positive delta only: the pre-check above refused a
    // negative-going adjustment from zero stock).
    const up = await db.prepare(
      `INSERT INTO inventory_items (product_id, quantity_on_hand, reorder_level, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         quantity_on_hand = inventory_items.quantity_on_hand + excluded.quantity_on_hand,
         updated_at = excluded.updated_at
       WHERE inventory_items.quantity_on_hand + excluded.quantity_on_hand >= 0
         AND EXISTS (SELECT 1 FROM products p WHERE p.id = inventory_items.product_id AND p.business_id = ?)`
    ).bind(product.id, delta, Number(product.low_stock_threshold ?? 5), now, auth.business.id).run();
    if ((up.meta?.changes ?? 0) !== 1) {
      return json({ ok: false, message: `Adjustment would take ${product.name} below zero.` }, 400);
    }

    await db.prepare(
      `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
       VALUES (?, 'adjustment', ?, 'manual', ?, ?)`
    )
      .bind(product.id, delta, note ? String(note).trim() : "Manual adjustment", auth.user.id)
      .run();

    await audit(context, auth, "stock.adjust", "product", product.id, { delta });
    // Re-read: the pre-check stock may be stale after a race; the upsert
    // above is the authority.
    const after = await db.prepare(
      `SELECT COALESCE(quantity_on_hand, 0) AS stock FROM inventory_items WHERE product_id = ?`
    ).bind(product.id).first();
    return json({ ok: true, newStock: Number(after?.stock ?? 0) });
  } catch (error) {
    return json({ ok: false, message: "Could not adjust stock.", error: String(error) }, 500);
  }
}
