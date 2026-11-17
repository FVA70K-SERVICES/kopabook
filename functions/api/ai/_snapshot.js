// Kopa AI — Rich business snapshot, its text form, and the system prompt.
// Phase 7.3 split of functions/api/ai/chat.js (was one 4,268-line file).
// Split verbatim from chat.js; the dead "column not migrated yet"
// fallbacks were then removed (Phase 7.3: the columns are relied on
// directly — live D1 has them).
import { businessDay, businessDayWindow } from "../_utils";
import { getBusinessOwnerTier } from "../billing";
import { PROJECT_TYPES, projectTotals } from "../projects/_lib.js";
import { qtyLeftText } from "./_fastpath.js";
import { ASSISTANT_LANGUAGES } from "./_assistant.js";
import { FREE_PROJECT_ACTIONS_PER_DAY, UPGRADE_NUDGE, allowedToolsForTier, fmt, pricePhrase } from "./_gating.js";

// ---------------------------------------------------------------------------
// Rich business snapshot. One bad query must never kill the whole answer, so
// each section is wrapped in its own try/catch. Every query binds business_id
// from auth, never from user input.
//
// Business-timezone windows (round 5): every sales/expenses figure below
// comes from the business's own timezone (auth.business.timezone, default
// Africa/Lagos), the same pattern buildBriefing already uses. The old
// UTC-day/month queries answered the wrong day after midnight WAT: at
// 01:32 WAT on 2026-11-06 the UTC day had 0 sales while the Lagos day
// had 1 sale, NGN 2,270,256, so Ask Kopa AI said "No sales yet today"
// on the same session the Dashboard showed NGN 2,270,256.
//
// Profit is sales minus expenses per window, the same definition as the
// briefing's "Profit today" line. There is NO cost_price in this
// snapshot (products carry price and stock only), so gross margin from
// cost is not computable here: never invent cost data, and a reader
// that cannot compute a figure must use unknownFigureText() with the
// reason, never a guessed figure.
// ---------------------------------------------------------------------------
// Exported for local tests (same convention as the pure helpers below):
// the snapshot fields are only observable through chat replies otherwise.
export async function buildSnapshot(db, auth) {
  const businessId = auth.business.id;
  const currency = auth.business.currency || "NGN";
  const snap = {};
  const q = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      return fallback;
    }
  };

  // Business-tz period windows, all from the same "now": today,
  // yesterday, this week (Monday to Sunday), this month, this year.
  // Sales compare created_at (a UTC timestamp) against UTC windows;
  // expenses compare incurred_on (a local YYYY-MM-DD date) against
  // local dates. Voided sales (status 'voided', world-best soft void)
  // never count anywhere: old rows may have a NULL status, so the
  // filter keeps NULLs and excludes only 'voided'.
  const tz = (auth.business && auth.business.timezone) || "Africa/Lagos";
  const now = new Date();
  const todayW = businessDay(tz, now);
  const yestW = businessDay(tz, new Date(now.getTime() - 24 * 3600 * 1000));
  const tomorrowDate = businessDay(tz, new Date(now.getTime() + 24 * 3600 * 1000)).date;
  const [ty, tm, td] = todayW.date.split("-").map(Number);
  const dayMs = 24 * 3600 * 1000;
  const utcDay = Date.UTC(ty, tm - 1, td);
  const mondayMs = utcDay - (((new Date(utcDay).getUTCDay() + 6) % 7) * dayMs);
  const mondayDate = new Date(mondayMs).toISOString().slice(0, 10);
  const nextMondayDate = new Date(mondayMs + 7 * dayMs).toISOString().slice(0, 10);
  const monthStartDate = todayW.date.slice(0, 8) + "01";
  const nextMonthDate = tm === 12 ? (ty + 1) + "-01-01" : ty + "-" + String(tm + 1).padStart(2, "0") + "-01";
  const yearStartDate = ty + "-01-01";
  const nextYearDate = (ty + 1) + "-01-01";
  const lastYearStartDate = (ty - 1) + "-01-01";
  const lastMondayDate = new Date(mondayMs - 7 * dayMs).toISOString().slice(0, 10);
  const weekStartUtc = businessDayWindow(tz, mondayDate).startUtc;
  const weekEndUtc = businessDayWindow(tz, nextMondayDate).startUtc;
  const monthStartUtc = businessDayWindow(tz, monthStartDate).startUtc;
  const monthEndUtc = businessDayWindow(tz, nextMonthDate).startUtc;
  const yearStartUtc = businessDayWindow(tz, yearStartDate).startUtc;
  const yearEndUtc = businessDayWindow(tz, nextYearDate).startUtc;
  const lastYearStartUtc = businessDayWindow(tz, lastYearStartDate).startUtc;
  const VOIDED = "(status IS NULL OR status <> 'voided')";
  const salesWindow = async (startUtc, endUtc) => {
    const r = await q(async () => await db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt, COALESCE(SUM(change_given),0) AS changeGiven FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ? AND ${VOIDED}`
    ).bind(businessId, startUtc, endUtc).first(), null);
    return { total: Number(r && r.total) || 0, count: Number(r && r.cnt) || 0, changeGiven: Number(r && r.changeGiven) || 0 };
  };
  const expensesWindow = async (startDate, endDate) => {
    const r = await q(async () => await db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM expenses WHERE business_id = ? AND incurred_on >= ? AND incurred_on < ?`
    ).bind(businessId, startDate, endDate).first(), null);
    return { total: Number(r && r.total) || 0, count: Number(r && r.cnt) || 0 };
  };

  snap.businessName = auth.business.name || "Your business";
  snap.businessDate = todayW.date;
  snap.timezone = tz;
  snap.businessType = auth.business.business_type || "general";
  snap.tier = (await q(async () => (await getBusinessOwnerTier(db, businessId)).tier, "free")) || "free";

  snap.products = await q(async () => {
    // Phase 7.3: the unit column (migration 0042) is relied on directly;
    // live D1 has it. (The section wrapper `q` still guards the snapshot
    // if this query ever fails.)
    const rows = await db.prepare(
      `SELECT p.id, p.name, p.unit_price, p.unit, COALESCE(ii.quantity_on_hand, 0) AS stock,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                        WHERE si.product_id = p.id AND s.business_id = ? AND s.created_at >= date('now', '-30 days') AND (s.status IS NULL OR s.status <> 'voided')), 0) AS sold_30d
       FROM products p LEFT JOIN inventory_items ii ON ii.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1
       ORDER BY sold_30d DESC, p.name ASC LIMIT 50`
    ).bind(businessId, businessId).all();
    return (rows.results || []).map((p) => ({
      name: p.name,
      price: Number(p.unit_price || 0),
      unit: p.unit || "piece",
      stock: Number(p.stock || 0),
    }));
  }, []);

  snap.salesToday = await salesWindow(todayW.startUtc, todayW.endUtc);
  snap.salesYesterday = await salesWindow(yestW.startUtc, yestW.endUtc);
  snap.salesWeek = await salesWindow(weekStartUtc, weekEndUtc);
  snap.salesMonth = await salesWindow(monthStartUtc, monthEndUtc);
  snap.salesYear = await salesWindow(yearStartUtc, yearEndUtc);
  snap.salesLastYear = await salesWindow(lastYearStartUtc, yearStartUtc);

  snap.expensesToday = await expensesWindow(todayW.date, tomorrowDate);
  snap.expensesYesterday = await expensesWindow(yestW.date, todayW.date);
  snap.expensesWeek = await expensesWindow(mondayDate, nextMondayDate);
  snap.expensesLastWeek = await expensesWindow(lastMondayDate, mondayDate);
  snap.expensesMonth = await expensesWindow(monthStartDate, nextMonthDate);
  snap.expensesYear = await expensesWindow(yearStartDate, nextYearDate);
  snap.expensesLastYear = await expensesWindow(lastYearStartDate, yearStartDate);

  // Sales by day for the last 31 business days, in one query: the
  // date-sales and day-report reads need line items per day, not just
  // window totals. Rows are bucketed in JS by business-local date, so
  // a sale just after midnight WAT still lands on the Lagos day. Every
  // day in the range gets an entry, even with no sales, so a quiet day
  // reads as no sales rather than as missing data. Per day: total,
  // count, change given, items aggregated by product name (cap 20),
  // and debts for sales with a balance due (cap 10). Voided sales
  // never count. On a query failure the field is null, so the date
  // readers fall through instead of claiming no sales.
  snap.salesByDay = await q(async () => {
    const startMs = utcDay - 30 * dayMs;
    const startDate = new Date(startMs).toISOString().slice(0, 10);
    const startUtc = businessDayWindow(tz, startDate).startUtc;
    const rs = await db.prepare(
      `SELECT s.id, s.sale_number, COALESCE(c.name, 'Walk-in') AS customer,
              s.total_amount, s.amount_paid, s.balance_due, COALESCE(s.change_given, 0) AS change_given,
              s.created_at, si.quantity, si.line_total, p.name AS product_name
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND ${VOIDED}
       ORDER BY s.created_at ASC`
    ).bind(businessId, startUtc, todayW.endUtc).all();
    const days = {};
    const windows = [];
    for (let i = 0; i < 31; i++) {
      const d = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
      days[d] = { date: d, total: 0, count: 0, changeGiven: 0, items: [], debts: [], unlistedTotal: 0, unlistedCount: 0, customers: {} };
      windows.push({ date: d, ...businessDayWindow(tz, d) });
    }
    const seen = new Set();
    const agg = {};
    // Per sale: its total and day, and whether any item line named a
    // product. A sale with no sale_items rows, or whose product was
    // deleted (LEFT JOIN gives NULL product_name), counts in the
    // total but contributes no item line: without this tracking the
    // item list and the total disagree, as happened live in October
    // 2026 (one NGN 10,000 sale counted but unlisted).
    const saleTotals = new Map();
    const saleHasItems = new Set();
    for (const row of rs.results || []) {
      const w = windows.find((x) => row.created_at >= x.startUtc && row.created_at < x.endUtc);
      if (!w) continue;
      const day = days[w.date];
      if (!seen.has(row.id)) {
        seen.add(row.id);
        day.total = Math.round((day.total + (Number(row.total_amount) || 0)) * 100) / 100;
        day.count += 1;
        day.changeGiven = Math.round((day.changeGiven + (Number(row.change_given) || 0)) * 100) / 100;
        saleTotals.set(row.id, { total: Number(row.total_amount) || 0, date: w.date });
        const cust = row.customer || "Walk-in";
        const cAgg = day.customers[cust] || (day.customers[cust] = { total: 0, count: 0 });
        cAgg.total = Math.round((cAgg.total + (Number(row.total_amount) || 0)) * 100) / 100;
        cAgg.count += 1;
        if ((Number(row.balance_due) || 0) > 0 && day.debts.length < 10) {
          day.debts.push({ customer: row.customer || "Walk-in", amount: Number(row.balance_due) || 0, ref: row.sale_number || "" });
        }
      }
      if (row.product_name) {
        saleHasItems.add(row.id);
        const key = w.date + "\n" + row.product_name;
        const a = agg[key] || (agg[key] = { product: row.product_name, qty: 0, amount: 0 });
        a.qty += Number(row.quantity) || 0;
        a.amount = Math.round((a.amount + (Number(row.line_total) || 0)) * 100) / 100;
      }
    }
    for (const [id, s] of saleTotals) {
      if (!saleHasItems.has(id)) {
        const day = days[s.date];
        day.unlistedTotal = Math.round((day.unlistedTotal + s.total) * 100) / 100;
        day.unlistedCount += 1;
      }
    }
    for (const [key, a] of Object.entries(agg)) {
      days[key.slice(0, 10)].items.push(a);
    }
    for (const d of Object.keys(days)) {
      days[d].items.sort((a, b) => b.amount - a.amount);
      days[d].items = days[d].items.slice(0, 20);
    }
    return days;
  }, null);

  // Sales by month for the current month plus the previous 2 months,
  // in one query: the month-sales and month-report reads need line
  // items per month, not just window totals. Rows are bucketed in JS
  // by business-local month, the same way the per-day map buckets by
  // day. Every month in the range gets an entry, even with no sales.
  // Per month: total, count, change given, items aggregated by product
  // name (cap 20), and debts for sales with a balance due (cap 10).
  // Voided sales never count. On a query failure the field is null,
  // so the month readers fall through instead of claiming no sales.
  snap.salesByMonth = await q(async () => {
    let my = tm - 2;
    let yy = ty;
    while (my < 1) { my += 12; yy -= 1; }
    const monthsStartDate = yy + "-" + String(my).padStart(2, "0") + "-01";
    const monthsStartUtc = businessDayWindow(tz, monthsStartDate).startUtc;
    const rs = await db.prepare(
      `SELECT s.id, s.sale_number, COALESCE(c.name, 'Walk-in') AS customer,
              s.total_amount, s.amount_paid, s.balance_due, COALESCE(s.change_given, 0) AS change_given,
              s.created_at, si.quantity, si.line_total, p.name AS product_name
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND ${VOIDED}
       ORDER BY s.created_at ASC`
    ).bind(businessId, monthsStartUtc, monthEndUtc).all();
    const months = {};
    const keys = [];
    {
      let cy = yy;
      let cm = my;
      for (let i = 0; i < 3; i++) {
        const key = cy + "-" + String(cm).padStart(2, "0");
        months[key] = { key, total: 0, count: 0, changeGiven: 0, items: [], debts: [], unlistedTotal: 0, unlistedCount: 0, customers: {} };
        keys.push(key);
        cm += 1;
        if (cm > 12) { cm = 1; cy += 1; }
      }
    }
    const startMs = Date.parse(monthsStartDate + "T00:00:00Z");
    const endMs = Date.parse(nextMonthDate + "T00:00:00Z");
    const dayCount = Math.round((endMs - startMs) / dayMs);
    const windows = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
      windows.push({ date: d, ...businessDayWindow(tz, d) });
    }
    const seen = new Set();
    const agg = {};
    // Per sale: its total and month, and whether any item line named
    // a product. A sale with no sale_items rows, or whose product was
    // deleted, counts in the total but contributes no item line: the
    // unlisted fields keep the list and the total in agreement.
    const saleTotals = new Map();
    const saleHasItems = new Set();
    for (const row of rs.results || []) {
      const w = windows.find((x) => row.created_at >= x.startUtc && row.created_at < x.endUtc);
      if (!w) continue;
      const month = months[w.date.slice(0, 7)];
      if (!month) continue;
      if (!seen.has(row.id)) {
        seen.add(row.id);
        month.total = Math.round((month.total + (Number(row.total_amount) || 0)) * 100) / 100;
        month.count += 1;
        month.changeGiven = Math.round((month.changeGiven + (Number(row.change_given) || 0)) * 100) / 100;
        saleTotals.set(row.id, { total: Number(row.total_amount) || 0, key: w.date.slice(0, 7) });
        const cust = row.customer || "Walk-in";
        const cAgg = month.customers[cust] || (month.customers[cust] = { total: 0, count: 0 });
        cAgg.total = Math.round((cAgg.total + (Number(row.total_amount) || 0)) * 100) / 100;
        cAgg.count += 1;
        if ((Number(row.balance_due) || 0) > 0 && month.debts.length < 10) {
          month.debts.push({ customer: row.customer || "Walk-in", amount: Number(row.balance_due) || 0, ref: row.sale_number || "" });
        }
      }
      if (row.product_name) {
        saleHasItems.add(row.id);
        const key = w.date.slice(0, 7) + "\n" + row.product_name;
        const a = agg[key] || (agg[key] = { product: row.product_name, qty: 0, amount: 0 });
        a.qty += Number(row.quantity) || 0;
        a.amount = Math.round((a.amount + (Number(row.line_total) || 0)) * 100) / 100;
      }
    }
    for (const [id, s] of saleTotals) {
      if (!saleHasItems.has(id)) {
        const month = months[s.key];
        month.unlistedTotal = Math.round((month.unlistedTotal + s.total) * 100) / 100;
        month.unlistedCount += 1;
      }
    }
    for (const [key, a] of Object.entries(agg)) {
      months[key.slice(0, 7)].items.push(a);
    }
    for (const key of keys) {
      months[key].items.sort((a, b) => b.amount - a.amount);
      months[key].items = months[key].items.slice(0, 20);
    }
    return months;
  }, null);

  // Expenses by month for the same 3 months, with each expense's
  // description: the expenses-by-word read ("what did I spend on
  // transport this month") matches on the description word. On a query
  // failure the field is null, so that read falls through instead of
  // claiming no expenses.
  snap.expensesByMonth = await q(async () => {
    let my = tm - 2;
    let yy = ty;
    while (my < 1) { my += 12; yy -= 1; }
    const monthsStartDate = yy + "-" + String(my).padStart(2, "0") + "-01";
    const rs = await db.prepare(
      `SELECT COALESCE(e.note, ec.name, 'Expense') AS description, e.amount, e.incurred_on
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.business_id = ? AND e.incurred_on >= ? AND e.incurred_on < ?
       ORDER BY e.incurred_on ASC`
    ).bind(businessId, monthsStartDate, nextMonthDate).all();
    const months = {};
    {
      let cy = yy;
      let cm = my;
      for (let i = 0; i < 3; i++) {
        const key = cy + "-" + String(cm).padStart(2, "0");
        months[key] = { key, total: 0, count: 0, items: [] };
        cm += 1;
        if (cm > 12) { cm = 1; cy += 1; }
      }
    }
    for (const row of rs.results || []) {
      const key = String(row.incurred_on || "").slice(0, 7);
      const month = months[key];
      if (!month) continue;
      month.total = Math.round((month.total + (Number(row.amount) || 0)) * 100) / 100;
      month.count += 1;
      if (month.items.length < 50) {
        month.items.push({ description: row.description, amount: Number(row.amount) || 0, date: row.incurred_on });
      }
    }
    return months;
  }, null);

  // Sales by year for last year and this year, in one query: the
  // year-sales, year-report and best-seller reads need line items per
  // year, the same shape as the per-month map. Per year: total, count,
  // change given, items aggregated by product name (cap 20), debts
  // (cap 10), unlisted sales with no product line, and per-customer
  // totals. Voided sales never count. On a query failure the field is
  // null, so the year readers fall back to the window totals.
  snap.salesByYear = await q(async () => {
    const yearsStartDate = lastYearStartDate;
    const yearsStartUtc = businessDayWindow(tz, yearsStartDate).startUtc;
    const rs = await db.prepare(
      `SELECT s.id, s.sale_number, COALESCE(c.name, 'Walk-in') AS customer,
              s.total_amount, s.amount_paid, s.balance_due, COALESCE(s.change_given, 0) AS change_given,
              s.created_at, si.quantity, si.line_total, p.name AS product_name
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? AND ${VOIDED}
       ORDER BY s.created_at ASC`
    ).bind(businessId, yearsStartUtc, yearEndUtc).all();
    const years = {};
    const keys = [];
    for (let y = ty - 1; y <= ty; y++) {
      const key = String(y);
      years[key] = { key, total: 0, count: 0, changeGiven: 0, items: [], debts: [], unlistedTotal: 0, unlistedCount: 0, customers: {} };
      keys.push(key);
    }
    const startMs = Date.parse(yearsStartDate + "T00:00:00Z");
    const endMs = Date.parse(nextYearDate + "T00:00:00Z");
    const dayCount = Math.round((endMs - startMs) / dayMs);
    const windows = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
      windows.push({ date: d, ...businessDayWindow(tz, d) });
    }
    const seen = new Set();
    const agg = {};
    const saleTotals = new Map();
    const saleHasItems = new Set();
    for (const row of rs.results || []) {
      const w = windows.find((x) => row.created_at >= x.startUtc && row.created_at < x.endUtc);
      if (!w) continue;
      const year = years[w.date.slice(0, 4)];
      if (!year) continue;
      if (!seen.has(row.id)) {
        seen.add(row.id);
        year.total = Math.round((year.total + (Number(row.total_amount) || 0)) * 100) / 100;
        year.count += 1;
        year.changeGiven = Math.round((year.changeGiven + (Number(row.change_given) || 0)) * 100) / 100;
        saleTotals.set(row.id, { total: Number(row.total_amount) || 0, key: w.date.slice(0, 4) });
        const cust = row.customer || "Walk-in";
        const cAgg = year.customers[cust] || (year.customers[cust] = { total: 0, count: 0 });
        cAgg.total = Math.round((cAgg.total + (Number(row.total_amount) || 0)) * 100) / 100;
        cAgg.count += 1;
        if ((Number(row.balance_due) || 0) > 0 && year.debts.length < 10) {
          year.debts.push({ customer: row.customer || "Walk-in", amount: Number(row.balance_due) || 0, ref: row.sale_number || "" });
        }
      }
      if (row.product_name) {
        saleHasItems.add(row.id);
        const key = w.date.slice(0, 4) + "\n" + row.product_name;
        const a = agg[key] || (agg[key] = { product: row.product_name, qty: 0, amount: 0 });
        a.qty += Number(row.quantity) || 0;
        a.amount = Math.round((a.amount + (Number(row.line_total) || 0)) * 100) / 100;
      }
    }
    for (const [id, s] of saleTotals) {
      if (!saleHasItems.has(id)) {
        const year = years[s.key];
        year.unlistedTotal = Math.round((year.unlistedTotal + s.total) * 100) / 100;
        year.unlistedCount += 1;
      }
    }
    for (const [key, a] of Object.entries(agg)) {
      years[key.slice(0, 4)].items.push(a);
    }
    for (const key of keys) {
      years[key].items.sort((a, b) => b.amount - a.amount);
      years[key].items = years[key].items.slice(0, 20);
    }
    return years;
  }, null);

  // Expenses by year for last year and this year, with each expense's
  // description, the same shape as the per-month map. On a query
  // failure the field is null, so the year-expenses read falls back
  // to the window totals.
  snap.expensesByYear = await q(async () => {
    const rs = await db.prepare(
      `SELECT COALESCE(e.note, ec.name, 'Expense') AS description, e.amount, e.incurred_on
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.business_id = ? AND e.incurred_on >= ? AND e.incurred_on < ?
       ORDER BY e.incurred_on ASC`
    ).bind(businessId, lastYearStartDate, nextYearDate).all();
    const years = {};
    for (let y = ty - 1; y <= ty; y++) {
      years[String(y)] = { key: String(y), total: 0, count: 0, items: [] };
    }
    for (const row of rs.results || []) {
      const key = String(row.incurred_on || "").slice(0, 4);
      const year = years[key];
      if (!year) continue;
      year.total = Math.round((year.total + (Number(row.amount) || 0)) * 100) / 100;
      year.count += 1;
      if (year.items.length < 50) {
        year.items.push({ description: row.description, amount: Number(row.amount) || 0, date: row.incurred_on });
      }
    }
    return years;
  }, null);

  snap.debtors = await q(async () => {
    const rs = await db.prepare(
      `SELECT c.name, COALESCE((SELECT balance_after FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1), 0) AS bal,
              (SELECT created_at FROM customer_ledger WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS last_activity
       FROM customers c WHERE c.business_id = ? ORDER BY bal DESC LIMIT 20`
    ).bind(businessId).all();
    return (rs.results || [])
      .map((r) => ({ name: r.name, balance: Number(r.bal) || 0, lastActivity: r.last_activity || null }))
      .filter((r) => r.balance > 0);
  }, []);

  snap.lowStock = await q(async () => {
    // Phase 7.3: the unit column (migration 0042) is relied on directly.
    const rs = await db.prepare(
      `SELECT p.name, p.unit, COALESCE(ii.quantity_on_hand,0) AS qty FROM products p
       LEFT JOIN inventory_items ii ON ii.product_id = p.id
       WHERE p.business_id = ? AND p.is_active = 1 AND COALESCE(ii.quantity_on_hand,0) <= p.low_stock_threshold LIMIT 10`
    ).bind(businessId).all();
    return (rs.results || []).map((p) => ({ name: p.name, unit: p.unit || "piece", qty: Number(p.qty) || 0 }));
  }, []);

  snap.recentSales = await q(async () => {
    const rs = await db.prepare(
      `SELECT s.sale_number, COALESCE(c.name, 'Walk-in') AS customer, s.total_amount, s.amount_paid, s.balance_due, s.created_at
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.business_id = ? AND (s.status IS NULL OR s.status <> 'voided') ORDER BY s.id DESC LIMIT 5`
    ).bind(businessId).all();
    return (rs.results || []).map((s) => ({
      ref: s.sale_number, customer: s.customer, total: Number(s.total_amount) || 0,
      paid: Number(s.amount_paid) || 0, balance: Number(s.balance_due) || 0, at: s.created_at,
    }));
  }, []);

  snap.recentExpenses = await q(async () => {
    const rs = await db.prepare(
      `SELECT COALESCE(e.note, ec.name, 'Expense') AS description, e.amount, e.incurred_on
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.business_id = ? ORDER BY e.id DESC LIMIT 5`
    ).bind(businessId).all();
    return (rs.results || []).map((e) => ({ description: e.description, amount: Number(e.amount) || 0, date: e.incurred_on }));
  }, []);

  snap.staffCount = await q(async () => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`).bind(businessId).first();
    return Number(r && r.n) || 0;
  }, 0);

  // Staff names with their business role, from business_members joined
  // to users: the staff-names read lists these, never invented names.
  // On a query failure the field is null, so the read answers with the
  // count instead and says the names are not in the snapshot.
  snap.staff = await q(async () => {
    const rs = await db.prepare(
      `SELECT u.full_name AS name, bm.role AS role
       FROM business_members bm INNER JOIN users u ON u.id = bm.user_id
       WHERE bm.business_id = ? ORDER BY bm.id ASC`
    ).bind(businessId).all();
    return (rs.results || []).map((r) => ({ name: r.name, role: r.role || "" }));
  }, null);

  // All customers, not just debtors: "how many customers do I have"
  // needs this count; snap.debtors above is owing customers only.
  snap.customerCount = await q(async () => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE business_id = ?`).bind(businessId).first();
    return Number(r && r.n) || 0;
  }, 0);

  snap.projects = await q(async () => {
    const byId = new Map();
    const own = await db.prepare(
      `SELECT id, name, type, status, budget, 'business' AS access, NULL AS member_role
       FROM projects WHERE business_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(businessId).all();
    for (const p of own.results || []) byId.set(Number(p.id), p);
    const invited = await db.prepare(
      `SELECT p.id, p.name, p.type, p.status, p.budget, 'invited' AS access, pm.role AS member_role
       FROM project_members pm JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = ? ORDER BY p.id DESC LIMIT 20`
    ).bind(auth.user.id).all();
    for (const p of invited.results || []) if (!byId.has(Number(p.id))) byId.set(Number(p.id), p);
    const projects = [];
    for (const p of [...byId.values()].slice(0, 20)) {
      projects.push({ ...p, totals: await projectTotals(db, p.id) });
    }
    return projects;
  }, []);

  return snap;
}

function snapshotText(snap, currency) {
  const L = [];
  L.push(`Business: ${snap.businessName} (${snap.businessType}), plan: ${snap.tier}, staff members: ${snap.staffCount}, customers: ${Number(snap.customerCount || 0)}.`);
  if (snap.businessDate) {
    L.push(`Today is ${snap.businessDate} (${snap.timezone || "Africa/Lagos"}).`);
  }
  if (snap.products.length) {
    L.push("Products (name, price, unit, stock): " + snap.products.map((p) => `${p.name} ${fmt(p.price, currency)} ${pricePhrase(p.unit)} (stock ${p.stock})`).join("; ") + ".");
  } else {
    L.push("Products: none added yet.");
  }
  L.push(`Sales today: ${fmt(snap.salesToday.total, currency)} across ${snap.salesToday.count} sales.`);
  if (snap.salesYesterday) {
    L.push(`Sales yesterday: ${fmt(snap.salesYesterday.total, currency)} across ${snap.salesYesterday.count} sales.`);
  }
  L.push(`Sales this month: ${fmt(snap.salesMonth.total, currency)} across ${snap.salesMonth.count} sales.`);
  L.push(`Sales this week: ${fmt(snap.salesWeek.total, currency)} across ${snap.salesWeek.count} sales.`);
  L.push(`Sales this year: ${fmt(snap.salesYear.total, currency)} across ${snap.salesYear.count} sales.`);
  if (snap.salesLastYear) {
    L.push(`Sales last year: ${fmt(snap.salesLastYear.total, currency)} across ${snap.salesLastYear.count} sales.`);
  }
  if (snap.expensesToday) {
    L.push(`Expenses today: ${fmt(snap.expensesToday.total, currency)} across ${snap.expensesToday.count} expenses.`);
    // Profit is sales minus expenses for the same window. No cost_price
    // exists in the snapshot, so this is not gross margin from cost.
    L.push(`Profit today: ${fmt(Math.round((Number(snap.salesToday.total || 0) - Number(snap.expensesToday.total || 0)) * 100) / 100, currency)} (sales minus expenses).`);
  }
  L.push(`Expenses this month: ${fmt(snap.expensesMonth.total, currency)} across ${snap.expensesMonth.count} expenses.`);
  L.push(`Expenses this week: ${fmt(snap.expensesWeek.total, currency)} across ${snap.expensesWeek.count} expenses.`);
  L.push(`Expenses this year: ${fmt(snap.expensesYear.total, currency)} across ${snap.expensesYear.count} expenses.`);
  if (snap.expensesLastYear) {
    L.push(`Expenses last year: ${fmt(snap.expensesLastYear.total, currency)} across ${snap.expensesLastYear.count} expenses.`);
  }
  if (snap.debtors.length) {
    L.push("Customers owing (name: balance): " + snap.debtors.map((d) => `${d.name}: ${fmt(d.balance, currency)}`).join("; ") + ".");
  } else {
    L.push("Customers owing: nobody owes money right now.");
  }
  if (snap.lowStock.length) {
    L.push("Low stock: " + snap.lowStock.map((p) => `${p.name} (${qtyLeftText(p.qty, p.unit)})`).join("; ") + ".");
  } else {
    L.push("Low stock: nothing is running low.");
  }
  if (snap.recentSales.length) {
    L.push("Last sales: " + snap.recentSales.map((s) => `${s.ref} ${s.customer} ${fmt(s.total, currency)} paid ${fmt(s.paid, currency)}${s.balance > 0 ? ` (owes ${fmt(s.balance, currency)})` : ""}`).join("; ") + ".");
  }
  if (snap.recentExpenses.length) {
    L.push("Last expenses: " + snap.recentExpenses.map((e) => `${e.description} ${fmt(e.amount, currency)} on ${e.date}`).join("; ") + ".");
  }
  if (snap.projects && snap.projects.length) {
    L.push("Projects visible to this user (id, name, type, status, budget, income, expenses, balance, milestones done/total, access): " + snap.projects.map((p) => `#${p.id} ${p.name} (${p.type}, ${p.status}, budget ${fmt(p.budget, currency)}, income ${fmt(p.totals.totalIncome, currency)}, expenses ${fmt(p.totals.totalExpense, currency)}, balance ${fmt(p.totals.balance, currency)}, milestones ${p.totals.milestonesDone}/${p.totals.milestonesTotal}, ${p.access}${p.member_role ? " " + p.member_role : ""})`).join("; ") + ".");
  } else {
    L.push("Projects visible to this user: none.");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt: conversational manager + action protocol. The tool list is
// tailored to the business's tier so the model only offers what is allowed.
// ---------------------------------------------------------------------------
const TOOL_DOCS = {
  record_sale: `- record_sale: {"items": [{"product": "product name", "qty": 2}], "customer_name": "optional", "amount_paid": optional number, "payment_method": "cash"}. Use the EXACT product names from the snapshot. If amount_paid is missing, assume full payment.`,
  add_expense: `- add_expense: {"description": "what it was for", "amount": number, "category": "optional"}`,
  add_product: `- add_product: {"name": "product name", "price": number, "unit": "optional e.g. cup", "stock": optional number}`,
  record_customer_payment: `- record_customer_payment: {"customer_name": "name", "amount": number}`,
  set_reminder: `- set_reminder: {"text": "what to remember", "remind_at": "e.g. tomorrow 9am"}`,
  get_customer_balance: `- get_customer_balance: {"customer_name": "name"}`,
  draft_debtor_message: `- draft_debtor_message: {"customer_name": "name", "tone": "polite|firm|final" (optional, default polite)}. Writes a professional payment reminder to a customer who owes money. I will show you the draft for review first.`,
  send_debtor_message: `- send_debtor_message: {"customer_name": "name", "message": "the EXACT draft text"}. This is a proposal first: show the draft, then the owner taps Confirm on the proposal card, then tap the WhatsApp link. The message param must match the draft you showed them word for word. Kopa never sends WhatsApp itself.`,
  save_memory: `- save_memory: {"key": "short label, e.g. supplier or price rule", "value": "the fact to remember"}. Saves something about this business to long-term memory so you remember it in future chats. To forget something, save the same key with an empty value. A key starting with "instruction:" is a standing instruction for this business only; it never applies to another business and never removes a hard gate.`,
  create_project_plan: `- create_project_plan: {"name": "project name", "type": "construction|event|charity|business|custom", "goal": "what success means", "milestones": [{"title": "step", "description": "optional", "due_date": "YYYY-MM-DD optional"}], "budget_lines": [{"label": "cost item", "amount": number}], "budget": optional total, "start_date": "optional", "end_date": "optional"}. Use ONLY after the brief interview below has produced a name, a valid type and a goal. This is a proposal to create the project and all its milestones in one go.`,
  project_add_milestone: `- project_add_milestone: {"project": "exact project name or id", "title": "milestone", "description": "optional", "due_date": "YYYY-MM-DD optional"}`,
  project_complete_milestone: `- project_complete_milestone: {"project": "exact project name or id", "milestone": "exact milestone title or id"}`,
  project_record_transaction: `- project_record_transaction: {"project": "exact project name or id", "kind": "income|expense", "amount": number, "description": "what the money was for", "category": "optional"}`,
  project_update: `- project_update: {"project": "exact project name or id", "new_name": "optional replacement name", "status": "completed to close it, or active to reopen it"}. Use for renaming or closing/reopening a project only.`,
  project_invite: `- project_invite: {"project": "exact project name or id", "email": "person@example.com", "role": "contributor|viewer optional"}. Contributor is the default unless the owner asks for viewer.`,
  project_report: `- project_report: {"project": "exact project name or id"}. Use this for EVERY question about how a named project is doing; its figures come from the project record, never from memory.`,
};

export function systemPrompt(snap, currency, tier, memorySection, assistant) {
  const profile = assistant || { name: "Kopa", custom: false, paEnabled: false, language: "en" };
  const assistantName = profile.name || "Kopa";
  const allowed = allowedToolsForTier(tier);
  const toolDocs = allowed.map((t) => TOOL_DOCS[t]).join("\n");
  const actionSection = allowed.length
    ? `ACTIONS (you can DO things, not just answer):
When the user asks you to DO something, output ONE line on its own, exactly in this format, with no code fences:
ACTION: {"tool": "tool_name", "params": {...}}
Then on the next lines write your normal reply text (e.g. what you are about to do).

Available tools and params:
${toolDocs}

DEBTOR MESSAGES: when the user wants a payment reminder written for a customer who owes money, use draft_debtor_message. I will show the draft for review. Only use send_debtor_message after the owner taps Confirm on its proposal card. The message you send must be word-for-word the draft they approved.

WRITE ACTIONS ARE PROPOSALS: write actions are proposals, not done deals. The system shows the user an exact summary and only records after they confirm, so your reply text beside a write ACTION must speak of what you propose to record, never claim it is already recorded.

MISSING DETAILS: if a write request is missing a detail that cannot be known from the snapshot (which product when several match, the price of a brand new product, how much was paid when that changes a balance), ask ONE short question and emit NO ACTION line.

Only output an ACTION line when the user clearly wants something done. For plain questions, just answer in natural text with no ACTION line.`
    : `ACTIONS: you are in read-only mode on this plan. You cannot record sales, add expenses, or take any other action. If the user asks you to DO something, answer warmly that actions need an upgrade: "${UPGRADE_NUDGE}"`;
  const projectSection = `PROJECT INTERVIEW AND MANAGEMENT:
- When the user wants a NEW project planned or created, interview briefly, ONE missing item at a time: first the project name, then its type (${PROJECT_TYPES.join(", ")}), then the goal. Do not invent the name, type or goal, and emit NO project ACTION while one is missing.
- Once name, type and goal are known, draft an ordered milestone list and planned budget lines from the goal and anything the user gave you, then emit create_project_plan. If the user gave no budget information at all, ask ONE question for a rough total or the main cost lines before emitting it. Planned budget lines are a draft for confirmation, not recorded spending.
- For an existing project, use the exact project name or id from the snapshot. If more than one visible project could match, ask which one; never guess.
- Use project_report for every status question about a project. Use the project management tools only for the active business's own projects, each as a separate proposal. Invited projects are report-only here: you may report on them, but you may not change them through this chat; their changes belong to their own business.

${tier === "free" ? `PROJECT ACTIONS ON THE FREE PLAN:
Projects itself is open on this plan, in the app and through you. You may plan, create and manage projects with the project tools, always as proposals the user confirms first. Free includes ${FREE_PROJECT_ACTIONS_PER_DAY} AI project actions a day for this business, counted only when a confirmed project action is actually carried out; proposals, cancellations and project reports never use one up. If the system says today's free project actions are used up, relay that plainly and do not emit a project ACTION. Every OTHER kind of action (recording sales, adding expenses, adding products and so on) still needs an upgrade on this plan.

` : ""}`;
  const managerSection = profile.paEnabled
    ? `MANAGER AND PA ROLE:
You are also the owner's business manager and personal assistant. Be proactive about stock, debts and reminders: flag low stock, overdue debts and due reminders when they matter. Use what you remember about this business (see the memory section above) when you advise and plan. Draft messages for the owner's approval and never send anything silently.

`
    : "";
  const languageSection = profile.language && profile.language !== "en"
    ? `LANGUAGE:
Reply in ${ASSISTANT_LANGUAGES[profile.language] || "English"} for all conversation. Keep business terms, product names and customer names exactly as they are. Always write amounts as figures (digits) as well as words where natural, so numbers are never ambiguous.

`
    : "";
  return `You are ${assistantName}, a warm, sharp conversational companion for this business owner, like a careful, trusted helper who knows the business well. Introduce and refer to yourself as ${assistantName}. Talk like a person, not a robot: natural, concise, no bullet-point-everything, no stiff phrasing. A little Nigerian business flavor is fine, never forced.

${managerSection}${projectSection}${languageSection}How you handle questions:
- About THEIR BUSINESS (sales, stock, debts, records): answer ONLY from the BUSINESS SNAPSHOT below. Never invent or estimate numbers. If the snapshot does not have it, say so plainly and offer what you can check instead.
- About STAFF SIGN-IN AND SIGN-OUT TIMES ("who logged in", "when did staff log out", "log activity"): this business does not record when staff sign in or out, so say so plainly and do not invent times or dates. Never guess a login or logout time, and never treat "log" as a customer name.
- About BUSINESS ADVICE or PLANNING (growing sales, restocking, giving credit): give practical, grounded advice from general knowledge, and reference their snapshot data where it helps.
- About BUSINESS PLANNING ("let's plan", "plan for our business improvement", "what does the business need", "what stock should we buy"): this is a business question for YOU, not a question about KopaBook the app. Answer it from the snapshot and general business knowledge. Never send the owner to Kopa Support for planning their own business. Kopa Support is only for questions about how the KopaBook app itself works, its plans and billing, or a problem with the app.
- About ANYTHING ELSE (their day, general knowledge, casual chat): be genuinely helpful and conversational. Never say you can only answer business questions.

HARD RULES:
- Never invent business numbers, prices, stock levels, or customer balances.
- Never reveal another business's data. All figures below belong to this business only.
- Speak warmly, plainly and shortly, naming this business, not with generic praise. Never claim feelings, never claim to be human, never claim a personal relationship, and never invent a personal detail about the owner, a customer or a staff member. If a figure is not in the snapshot, say: I do not have that figure for this business.
- When a standing instruction for this business changes what you do, say so in plain words: Following your standing instruction for this business: ...
- No instruction, standing or new, removes the Confirm tap, a tier or role gate, the wrong-business stop, the payment gate, or the no auto-send rule. If asked to remove one, refuse that part plainly and offer a draft ready for one tap.
- Money is in ${currency}.

${memorySection ? memorySection + "\n\n" : ""}BUSINESS SNAPSHOT (live data, read just now):
${snapshotText(snap, currency)}

${actionSection}`;
}

// ---------------------------------------------------------------------------
// Fuzzy matchers. Never guess: 0 or 2+ matches returns a clarification need.
// ---------------------------------------------------------------------------
