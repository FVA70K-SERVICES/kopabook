// GET /api/dashboard — live totals from real data
// WORLD-BEST (Dashboard stream): adds the money split (tendered vs money
// actually received), the 7-day revenue trend, and the insights fields.
// Every existing metric field and name is unchanged. Past sales are never
// rewritten: the split only changes how today is labelled and divided.
// A payment mode is credit-kind when payment_modes.kind = 'credit', or —
// before migration 0061 runs — when its name is exactly 'credit'
// (case-insensitive). Credit-kind tender does NOT count as money received.
import { json, getAuthContext, requireAuth, businessDay } from "./_utils";
import { getBusinessOwnerTier } from "./billing";
import { computeMoneySplit } from "./_money.js";
import { loadModeRows } from "./_creditRules.js";
import { busiestHour, topDebtor, bestSeller, isOverdue } from "./_insights.js";

function isoDateNDaysAgo(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

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
       FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ?
         AND (status IS NULL OR status != 'voided')`
    ).bind(bid, day.startUtc, day.endUtc).first();

    const todayExpenses = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses WHERE business_id = ? AND incurred_on = ?`
    ).bind(bid, day.date).first();

    const debtRows = await db.prepare(
      `SELECT c.id, c.name,
              (SELECT balance_after FROM customer_ledger
               WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS outstanding,
              (SELECT created_at FROM customer_ledger
               WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS last_activity
       FROM customers c WHERE c.business_id = ?`
    ).bind(bid).all();
    let outstandingDebt = 0, openDebts = 0;
    const debtorList = [];
    for (const r of debtRows.results || []) {
      const o = Number(r.outstanding || 0);
      if (o > 0) {
        outstandingDebt += o;
        openDebts++;
        debtorList.push({ name: r.name, outstanding: o, last_activity: r.last_activity });
      }
    }

    // Owner-set overdue days (migration 0061). Pre-migration the column
    // does not exist: fall back to the 7-day default.
    let overdueDays = 7;
    try {
      const bizRow = await db.prepare(
        `SELECT overdue_days FROM businesses WHERE id = ? LIMIT 1`
      ).bind(bid).first();
      if (bizRow && bizRow.overdue_days !== null && bizRow.overdue_days !== undefined) {
        overdueDays = Number(bizRow.overdue_days) || 7;
      }
    } catch {
      overdueDays = 7;
    }
    const overdueCount = debtorList.filter((d) => isOverdue(d.last_activity, overdueDays)).length;

    const lowStock = await db.prepare(
      `SELECT COUNT(*) AS count
       FROM products p
       LEFT JOIN inventory_items i ON i.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1
         AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_level, p.low_stock_threshold, 5)`
    ).bind(bid).first();

    // First three low-stock item names, for the Dashboard card.
    const lowStockNames = await db.prepare(
      `SELECT p.name
       FROM products p
       LEFT JOIN inventory_items i ON i.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1
         AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_level, p.low_stock_threshold, 5)
       ORDER BY p.name ASC LIMIT 3`
    ).bind(bid).all();

    const products = await db.prepare(
      `SELECT COUNT(*) AS count FROM products WHERE business_id = ? AND is_active = 1`
    ).bind(bid).first();

    const recentSales = await db.prepare(
      `SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.balance_due,
              s.payment_method, s.created_at, c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND (s.status IS NULL OR s.status != 'voided')
       ORDER BY s.id DESC LIMIT 5`
    ).bind(bid).all();

    // Money position: what was tendered today, by method, and what went
    // back as change. "Have" = collected (sales total). "Haven't" = still
    // owed (debts). Change = given back. Tendered rows are NOT money in
    // when the method is credit-kind: that portion is still owed.
    const byMethod = await db.prepare(
      `SELECT pr.payment_method AS method, COALESCE(SUM(pr.amount), 0) AS total
       FROM payment_records pr
       INNER JOIN sales s ON s.id = pr.sale_id
       WHERE pr.business_id = ? AND s.created_at >= ? AND s.created_at < ?
         AND (s.status IS NULL OR s.status != 'voided')
       GROUP BY pr.payment_method`
    ).bind(bid, day.startUtc, day.endUtc).all();
    const collectedByMethod = {};
    for (const r of byMethod.results || []) {
      collectedByMethod[r.method || "cash"] = Number(r.total || 0);
    }
    const modeRows = await loadModeRows(db, bid);
    const moneySplit = computeMoneySplit(
      collectedByMethod,
      Number(todaySales?.changeGiven || 0),
      modeRows
    );
    // Credit-kind method names, so the Dashboard can mark those rows.
    const creditMethods = new Set();
    for (const [method] of Object.entries(collectedByMethod)) {
      const row = modeRows.find((m) => String(m.name || "").trim().toLowerCase() === String(method || "").trim().toLowerCase());
      const kind = row && row.kind ? String(row.kind).trim().toLowerCase() : null;
      if (kind === "credit" || (!kind && String(method || "").trim().toLowerCase() === "credit")) {
        creditMethods.add(method);
      }
    }

    // 7-day revenue trend (free for all Dashboard viewers). Cost/profit
    // stay Starter-gated exactly like Reports, and only for staff who can
    // view profit: otherwise cost and profit are null.
    const trendFrom = isoDateNDaysAgo(day.date, 6);
    let canSeeTrendCost = false;
    try {
      const { tier } = await getBusinessOwnerTier(db, bid);
      canSeeTrendCost = ["pro", "solo", "starter"].includes(tier) && !!auth.perms.can_view_profit;
    } catch {
      canSeeTrendCost = false;
    }
    const trendRows = await db.prepare(
      `SELECT date(s.created_at) AS period,
              COALESCE(SUM(si.line_total), 0) AS revenue,
              COALESCE(SUM(si.quantity * si.cost_snapshot), 0) AS cost
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ? AND date(s.created_at) BETWEEN ? AND ?
         AND (s.status IS NULL OR s.status != 'voided')
       GROUP BY period ORDER BY period ASC`
    ).bind(bid, trendFrom, day.date).all();
    const trendByDay = new Map();
    for (const r of trendRows.results || []) {
      trendByDay.set(r.period, { revenue: Number(r.revenue || 0), cost: Number(r.cost || 0) });
    }
    const trend7d = [];
    for (let i = 6; i >= 0; i--) {
      const d = isoDateNDaysAgo(day.date, i);
      const t = trendByDay.get(d) || { revenue: 0, cost: 0 };
      trend7d.push({
        period: d,
        revenue: Math.round(t.revenue * 100) / 100,
        cost: canSeeTrendCost ? Math.round(t.cost * 100) / 100 : null,
        profit: canSeeTrendCost ? Math.round((t.revenue - t.cost) * 100) / 100 : null,
      });
    }

    // Busiest hour today (lightweight: today's sale timestamps, bucketed
    // in the business timezone by the shared helper).
    const todayStamps = await db.prepare(
      `SELECT created_at FROM sales
       WHERE business_id = ? AND created_at >= ? AND created_at < ?
         AND (status IS NULL OR status != 'voided')`
    ).bind(bid, day.startUtc, day.endUtc).all();
    const busiest = busiestHour(
      (todayStamps.results || []).map((r) => r.created_at),
      auth.business.timezone
    );

    // Best seller today, by revenue (same shape as Reports top products).
    const bestRows = await db.prepare(
      `SELECT p.name, SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN products p ON p.id = si.product_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ?
         AND (s.status IS NULL OR s.status != 'voided')
       GROUP BY p.id ORDER BY revenue DESC LIMIT 1`
    ).bind(bid, day.startUtc, day.endUtc).all();

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
        // WORLD-BEST: money split. tenderedByMethod is what customers
        // handed over, by method (same figures as collectedByMethod).
        // moneyInByMethod excludes credit-kind modes. actuallyReceived =
        // tendered minus credit-kind tender minus change given.
        tenderedByMethod: collectedByMethod,
        moneyInByMethod: moneySplit.moneyInByMethod,
        creditTenderedToday: moneySplit.creditTendered,
        actuallyReceived: moneySplit.actuallyReceived,
        creditMethods: [...creditMethods],
        // WORLD-BEST: insights.
        trend7d,
        busiestHour: busiest,
        topDebtor: topDebtor(debtorList),
        bestSeller: bestSeller(bestRows.results || []),
        lowStockNames: (lowStockNames.results || []).map((r) => r.name),
        overdueCount,
        overdueDays,
      },
      recentSales: recentSales.results || [],
    });
  } catch (error) {
    return json({ ok: false, message: "Could not load dashboard metrics.", error: String(error) }, 500);
  }
}
