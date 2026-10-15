// GET /api/reports — date-range summaries
import { json, getAuthContext, requireAuth } from "./_utils";

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const db = context.env.KOPABOOK_DB;
    const bid = auth.business.id;

    const daily = await db.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS sales_count, COALESCE(SUM(total_amount), 0) AS sales_total
       FROM sales WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
       GROUP BY day ORDER BY day ASC`
    ).bind(bid, from, to).all();

    const topProducts = await db.prepare(
      `SELECT p.name, SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY p.id ORDER BY revenue DESC LIMIT 10`
    ).bind(bid, from, to).all();

    const expensesByCat = await db.prepare(
      `SELECT COALESCE(c.name, 'Uncategorised') AS category, COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.business_id = ? AND e.incurred_on BETWEEN ? AND ?
       GROUP BY category ORDER BY total DESC`
    ).bind(bid, from, to).all();

    const totals = await db.prepare(
      `SELECT
         (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?) AS sales_total,
         (SELECT COUNT(*) FROM sales WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?) AS sales_count,
         (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE business_id = ? AND incurred_on BETWEEN ? AND ?) AS expense_total`
    ).bind(bid, from, to, bid, from, to, bid, from, to).first();

    return json({
      ok: true,
      from, to,
      totals: {
        salesTotal: Number(totals?.sales_total || 0),
        salesCount: Number(totals?.sales_count || 0),
        expenseTotal: Number(totals?.expense_total || 0),
        // Profit is only visible to staff with the profit permission.
        profit: auth.perms.can_view_profit
          ? Math.round((Number(totals?.sales_total || 0) - Number(totals?.expense_total || 0)) * 100) / 100
          : null,
      },
      daily: daily.results || [],
      topProducts: topProducts.results || [],
      expensesByCategory: expensesByCat.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load reports.", error: String(error) }, 500);
  }
}
