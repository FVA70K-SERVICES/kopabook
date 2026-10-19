// GET /api/reports — date-range summaries (Starter feature)
import { json, getAuthContext, requireAuth } from "./_utils";
import { getBusinessOwnerTier } from "./billing";

// Tier gate: paid feature, business-scoped (staff act under the owner's plan).
async function requireFeatureTier(db, businessId) {
  const { tier } = await getBusinessOwnerTier(db, businessId);
  if (!["pro", "solo", "starter"].includes(tier)) {
    return json({ ok: false, upgradeRequired: true, message: "Full reports are a Starter feature. Upgrade to use them." }, 403);
  }
  return null;
}

export async function onRequestGet(context) {
  try {
    const auth = await getAuthContext(context);
    const denied = requireAuth(auth);
    if (denied) return denied;
    const tierGate = await requireFeatureTier(context.env.KOPABOOK_DB, auth.business.id);
    if (tierGate) return tierGate;

    const url = new URL(context.request.url);
    const from = url.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    // Profit-trend bucketing: g=day (default) or g=week.
    const granularity = url.searchParams.get("g") === "week" ? "week" : "day";
    const db = context.env.KOPABOOK_DB;
    const bid = auth.business.id;
    const canSeeProfit = !!auth.perms.can_view_profit;

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

    // Profit trend: revenue from sale_items line totals, cost from per-line
    // cost snapshots (service lines carry a zero cost snapshot, so they add
    // revenue with no cost). Cost and profit are only visible to staff with
    // the profit permission.
    const periodExpr = granularity === "week" ? "strftime('%Y-W%W', s.created_at)" : "date(s.created_at)";
    const profitTrend = await db.prepare(
      `SELECT ${periodExpr} AS period,
         COALESCE(SUM(si.line_total), 0) AS revenue,
         COALESCE(SUM(si.quantity * si.cost_snapshot), 0) AS cost
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY period ORDER BY period ASC`
    ).bind(bid, from, to).all();

    // Best sellers by revenue and by quantity (products only).
    const bestSellersByRevenue = await db.prepare(
      `SELECT p.name, SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY p.id ORDER BY revenue DESC LIMIT 10`
    ).bind(bid, from, to).all();
    const bestSellersByQty = await db.prepare(
      `SELECT p.name, SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY p.id ORDER BY qty DESC LIMIT 10`
    ).bind(bid, from, to).all();

    // Slow movers: active products with stock on hand but zero sales in range.
    const slowMovers = await db.prepare(
      `SELECT p.name, COALESCE(i.quantity_on_hand, 0) AS stock, p.unit_price AS price
       FROM products p
       LEFT JOIN inventory_items i ON i.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(i.quantity_on_hand, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM sale_items si
           INNER JOIN sales s ON s.id = si.sale_id
           WHERE si.product_id = p.id AND s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
         )
       ORDER BY stock DESC LIMIT 20`
    ).bind(bid, bid, from, to).all();

    // Payment method breakdown: sales totals grouped by the checkout method.
    const paymentBreakdown = await db.prepare(
      `SELECT COALESCE(payment_method, 'cash') AS method, COUNT(*) AS count,
         COALESCE(SUM(total_amount), 0) AS total
       FROM sales
       WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
       GROUP BY payment_method ORDER BY total DESC`
    ).bind(bid, from, to).all();

    const trend = (profitTrend.results || []).map((r) => {
      const revenue = Number(r.revenue || 0);
      const cost = Number(r.cost || 0);
      return {
        period: r.period,
        revenue,
        cost: canSeeProfit ? cost : null,
        profit: canSeeProfit ? Math.round((revenue - cost) * 100) / 100 : null,
      };
    });

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
      // New optional sections (additive; existing fields unchanged).
      profitTrend: trend,
      bestSellers: {
        byRevenue: bestSellersByRevenue.results || [],
        byQuantity: bestSellersByQty.results || [],
      },
      slowMovers: slowMovers.results || [],
      paymentBreakdown: paymentBreakdown.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load reports.", error: String(error) }, 500);
  }
}
