// GET /api/dashboard — live totals from real data
import { json, getAuthContext, requireAuth, businessDay } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const db = context.env.KOPABOOK_DB;
    const bid = auth.business.id;

    // "Today" follows the business's own timezone, not server UTC.
    const day = businessDay(auth.business.timezone);
    const todaySales = await db.prepare(
      `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count,
              COALESCE(SUM(change_given), 0) AS changeGiven
       FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ?`
    ).bind(bid, day.startUtc, day.endUtc).first();

    const todayExpenses = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses WHERE business_id = ? AND incurred_on = ?`
    ).bind(bid, day.date).first();

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

    // Money position: what came in today, by method, and what went back as change.
    // "Have" = collected. "Haven't" = still owed (debts). Change = given back.
    const byMethod = await db.prepare(
      `SELECT pr.payment_method AS method, COALESCE(SUM(pr.amount), 0) AS total
       FROM payment_records pr
       INNER JOIN sales s ON s.id = pr.sale_id
       WHERE pr.business_id = ? AND s.created_at >= ? AND s.created_at < ?
       GROUP BY pr.payment_method`
    ).bind(bid, day.startUtc, day.endUtc).all();
    const collectedByMethod = {};
    for (const r of byMethod.results || []) {
      collectedByMethod[r.method || "cash"] = Number(r.total || 0);
    }

    return json({
      ok: true,
      metrics: {
        todaySalesTotal: Number(todaySales?.total || 0),
        todaySalesCount: Number(todaySales?.count || 0),
        todayChangeGiven: Number(todaySales?.changeGiven || 0),
        todayExpensesTotal: Number(todayExpenses?.total || 0),
        todayExpensesCount: Number(todayExpenses?.count || 0),
        outstandingDebtTotal: Math.round(outstandingDebt * 100) / 100,
        openDebtCount: openDebts,
        collectedByMethod,
        todayCashCollected: Math.round((collectedByMethod.cash || collectedByMethod.Cash || 0) * 100) / 100,
        lowStockCount: Number(lowStock?.count || 0),
        totalProducts: Number(products?.count || 0),
      },
      recentSales: recentSales.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load dashboard metrics.", error: String(error) }, 500);
  }
}
