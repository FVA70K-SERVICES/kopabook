// GET /api/receipts/sale?id= — full receipt data for one sale:
// business header info, sale, line items, payments, customer.
import { json, getAuthContext, requireAuth } from "../_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const id = Number(new URL(context.request.url).searchParams.get("id"));
    if (!id) return json({ ok: false, message: "Sale id is required." }, 400);

    const db = context.env.KOPABOOK_DB;
    const sale = await db.prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? AND s.business_id = ?`
    ).bind(id, auth.business.id).first();
    if (!sale) return json({ ok: false, message: "Sale not found." }, 404);

    let items;
    try {
      items = await db.prepare(
        `SELECT si.quantity, si.unit_price, si.line_total, p.name AS product_name, p.unit AS product_unit
         FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ? ORDER BY si.id ASC`
      ).bind(id).all();
    } catch (e) {
      // Migration 0042 not applied yet.
      if (!/no such column: p\.unit/i.test(String(e && e.message))) throw e;
      items = await db.prepare(
        `SELECT si.quantity, si.unit_price, si.line_total, p.name AS product_name
         FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ? ORDER BY si.id ASC`
      ).bind(id).all();
    }

    const payments = await db.prepare(
      `SELECT amount, payment_method AS mode, created_at FROM payment_records
       WHERE sale_id = ? ORDER BY id ASC`
    ).bind(id).all().catch(() => ({ results: [] }));

    const business = await db.prepare(
      `SELECT name, business_type, city, state, currency, brand_color, tagline,
              receipt_phone, receipt_address, receipt_footer, receipt_paper_width
       FROM businesses WHERE id = ?`
    ).bind(auth.business.id).first();

    return json({
      ok: true,
      business: business || {},
      sale,
      items: items.results || [],
      payments: payments.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load receipt.", error: String(error) }, 500);
  }
}
