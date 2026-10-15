// GET /api/dashboard — live totals from real data
import { json, getAuthContext, requireAuth } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    const bid = auth.business.id;

    // "Today" follows West Africa Time (UTC+1, no daylight saving), the
    // timezone KopaBook businesses operate in, not server UTC.
    const todaySales = await db.prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
       FROM sales WHERE business_id = ? AND date(created_at, '+1 hour') = date('now', '+1 hour')`
    ).bind(bid).first();

    const todayExpenses = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses WHERE business_id = ? AND incurred_on = date('now', '+1 hour')`
    ).bind(bid).first();

    const debtRows = await db.prepare(
      `SELECT c.id,
              (SELECT balance_after FROM customer_ledger
               WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS outstanding
       FROM customers c WHERE c.business_id = ?`
    ).bind(bid).all();
    let outstandingDebt = 0, openDebts = 0;
    for (const r of debtRows.results || []) {
      const o = Number(r.outstanding || 0);
      if (o > 0) { outstandingDebt += o; openDebts++; }
    }

    const lowStock = await db.prepare(
      `SELECT COUNT(*) AS count
       FROM products p
       LEFT JOIN inventory_items i ON i.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1
         AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_level, p.low_stock_threshold, 5)`
    ).bind(bid).first();

    const products = await db.prepare(
      `SELECT COUNT(*) AS count FROM products WHERE business_id = ? AND is_active = 1`
    ).bind(bid).first();

    const recentSales = await db.prepare(
      `SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.balance_due,
              s.payment_method, s.created_at, c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ?
       ORDER BY s.id DESC LIMIT 5`
    ).bind(bid).all();

    return json({
      ok: true,
      metrics: {
        todaySalesTotal: Number(todaySales?.total || 0),
        todaySalesCount: Number(todaySales?.count || 0),
        todayExpensesTotal: Number(todayExpenses?.total || 0),
        todayExpensesCount: Number(todayExpenses?.count || 0),
        outstandingDebtTotal: Math.round(outstandingDebt * 100) / 100,
        openDebtCount: openDebts,
        lowStockCount: Number(lowStock?.count || 0),
        totalProducts: Number(products?.count || 0),
      },
      recentSales: recentSales.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load dashboard metrics.", error: String(error) }, 500);
  }
}
