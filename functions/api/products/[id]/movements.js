// GET /api/products/:id/movements — stock movement history for one product
import { json, getAuthContext, requireAuth } from "../../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const id = Number(context.params.id);
    if (!id) return json({ ok: false, message: "Product id is required." }, 400);

    const product = await context.env.KOPABOOK_DB.prepare(
      `SELECT p.id, p.name, p.sku,
              COALESCE((SELECT quantity_on_hand FROM inventory_items WHERE product_id = p.id), 0) AS stock
       FROM products p WHERE p.id = ? AND p.business_id = ? LIMIT 1`
    ).bind(id, auth.business.id).first();
    if (!product) return json({ ok: false, message: "Product not found." }, 404);

    const rows = await context.env.KOPABOOK_DB.prepare(
      `SELECT id, movement_type, quantity_delta, note, created_at
       FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT 100`
    ).bind(id).all();

    return json({ ok: true, product, movements: rows.results || [] });
  } catch (error) {
    return json({ ok: false, message: "Could not load movements.", error: String(error) }, 500);
  }
}
