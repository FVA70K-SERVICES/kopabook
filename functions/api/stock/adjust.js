// POST /api/stock/adjust — manual stock increase/decrease (owner/manager only)
import { json, getAuthContext, requireAuth, canManage, audit, toSqliteDate } from "../_utils";

export async function onRequestPost(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    if (!canManage(auth)) {
      return json({ ok: false, message: "Only owners and managers can adjust stock." }, 403);
    }

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
    await db.prepare(
      `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + ?, updated_at = ?
       WHERE product_id = ?`
    )
      .bind(delta, now, product.id)
      .run();

    await db.prepare(
      `INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, source_type, note, created_by)
       VALUES (?, 'adjustment', ?, 'manual', ?, ?)`
    )
      .bind(product.id, delta, note ? String(note).trim() : "Manual adjustment", auth.user.id)
      .run();

    await audit(context, auth, "stock.adjust", "product", product.id, { delta });
    return json({ ok: true, newStock: product.stock + delta });
  } catch (error) {
    return json({ ok: false, message: "Could not adjust stock.", error: String(error) }, 500);
  }
}
