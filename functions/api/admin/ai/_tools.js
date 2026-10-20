// Read-only oversight tools for Admin AI (owner-only control centre).
// Every tool only reads. Write actions live in _actions.js as proposals
// and only ever run through POST /api/admin/ai/confirm.
// All queries are parameterized. No password hashes or tokens are ever
// selected.
import { toSqliteDate } from "../../_utils.js";
import { PROMO_SLUG, getPromoDef } from "../../_promo.js";

export const TOOL_DEFS = [
  { name: "platform_overview", description: "Platform totals: users, suspended users, businesses, active businesses, paying accounts, all-time paid subscription revenue, pending subscription upgrades, sales recorded.", args: {} },
  { name: "signups", description: "Count of new user signups in a period, plus total users. Week and month include a per-day series.", args: { period: "'today' | 'week' | 'month' | 'all'" } },
  { name: "accounts_by_tier", description: "How many accounts are on each tier (free, starter, solo, pro), plus the number of currently active promo claims.", args: {} },
  { name: "revenue", description: "Paid subscription revenue in a period from Paystack payments, broken down by payment method and tier, with approved manual bank transfer totals reported separately.", args: { period: "'today' | 'week' | 'month' | 'all'" } },
  { name: "pending_payments", description: "Payments waiting for attention: pending Paystack payments, pending manual bank transfers (including how many are older than 48 hours), and pending subscription upgrades.", args: {} },
  { name: "expiring_subscriptions", description: "Paid subscriptions ending within the next N days (default 7).", args: { days: "number, default 7" } },
  { name: "promo_state", description: "State of the Pro free month promotion: whether it is running, total claims, active claims, and the newest claims.", args: {} },
  { name: "support_load", description: "Support workload: support cases by status, open cases, open cases still awaiting a first response, and live chats needing a human.", args: {} },
  { name: "ai_usage_today", description: "Kopa AI usage today (UTC): total questions and actions, breakdown by owner tier, and the top 5 businesses by questions.", args: {} },
  { name: "dormant_businesses", description: "Active businesses with no sale in the last N days (default 14), including businesses that never sold and are older than N days.", args: { days: "number, default 14" } },
  { name: "account_lookup", description: "Look up up to 5 accounts by email or name, with subscription, businesses, payments, support cases and promo claims. Never returns password hashes or tokens.", args: { query: "email or name text" } },
  { name: "business_lookup", description: "Look up up to 5 businesses by name, with owner, owner tier, sales, products, customers and last sale.", args: { query: "business name text" } },
  { name: "full_briefing", description: "The full owner briefing pack: today figures, all-time figures, growth by month, and AI usage today. Use for 'brief me'.", args: {} },
];

export function fmtNGN(n) {
  const v = Number(n || 0);
  return "NGN " + v.toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function lagosDateStr(date = new Date()) {
  // Africa/Lagos is UTC+1 all year (no DST).
  const shifted = new Date(date.getTime() + 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function lagosMidnightUtc(dateStr) {
  // Lagos midnight is 23:00 UTC the day before.
  const ms = Date.parse(dateStr + "T00:00:00Z") - 3600 * 1000;
  return toSqliteDate(new Date(ms));
}

// { startUtc, endUtc } as "YYYY-MM-DD HH:MM:SS" UTC strings covering the
// Lagos local period. 'today' is the current Lagos day, 'week' is today
// and the previous 6 Lagos days, 'month' is today and the previous 29
// Lagos days. 'all' (and anything unknown) returns nulls (no filter).
export function lagosDayBounds(period) {
  const p = String(period || "today").toLowerCase();
  if (p === "all") return { startUtc: null, endUtc: null };
  const todayStr = lagosDateStr();
  let daysBack = 0;
  if (p === "week") daysBack = 6;
  else if (p === "month") daysBack = 29;
  const startDate = new Date(Date.parse(todayStr + "T00:00:00Z") - daysBack * 86400000);
  const startStr = startDate.toISOString().slice(0, 10);
  const endDate = new Date(Date.parse(todayStr + "T00:00:00Z") + 86400000);
  const endStr = endDate.toISOString().slice(0, 10);
  return { startUtc: lagosMidnightUtc(startStr), endUtc: lagosMidnightUtc(endStr) };
}

function periodClause(period, column) {
  const { startUtc, endUtc } = lagosDayBounds(period);
  if (!startUtc) return { sql: "", params: [] };
  return { sql: ` AND ${column} >= ? AND ${column} < ?`, params: [startUtc, endUtc] };
}

async function toolPlatformOverview(db) {
  const totals = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended,
       (SELECT COUNT(*) FROM businesses) AS businesses,
       (SELECT COUNT(*) FROM businesses WHERE status IS NULL OR status = 'active') AS active_businesses,
       (SELECT COUNT(*) FROM sales) AS sales,
       (SELECT COALESCE(SUM(total_amount), 0) FROM sales) AS sales_volume,
       (SELECT COUNT(*) FROM account_subscriptions WHERE tier != 'free' AND status = 'active') AS paying,
       (SELECT COALESCE(SUM(amount_kobo), 0) FROM subscription_payments WHERE status = 'paid') AS revenue_kobo,
       (SELECT COUNT(*) FROM account_subscriptions WHERE status = 'pending') AS pending_upgrades`
  ).first();
  const t = totals || {};
  return {
    users: Number(t.users || 0),
    suspended: Number(t.suspended || 0),
    businesses: Number(t.businesses || 0),
    active_businesses: Number(t.active_businesses || 0),
    paying: Number(t.paying || 0),
    revenue_ngn: Number(t.revenue_kobo || 0) / 100,
    pending_upgrades: Number(t.pending_upgrades || 0),
    sales: Number(t.sales || 0),
    sales_volume_ngn: Math.round(Number(t.sales_volume || 0) * 100) / 100,
  };
}

async function toolSignups(db, args) {
  const period = String((args && args.period) || "today").toLowerCase();
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first();
  const total = Number((totalRow && totalRow.n) || 0);
  const { startUtc, endUtc } = lagosDayBounds(period);
  if (!startUtc) return { period, count: total, total, series: [] };
  const countRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?`
  ).bind(startUtc, endUtc).first();
  const out = { period, count: Number((countRow && countRow.n) || 0), total, series: [] };
  if (period === "week" || period === "month") {
    // date(created_at, '+1 hour') is the Lagos local date.
    const rows = await db.prepare(
      `SELECT date(created_at, '+1 hour') AS day, COUNT(*) AS n FROM users
       WHERE created_at >= ? AND created_at < ?
       GROUP BY day ORDER BY day ASC LIMIT 30`
    ).bind(startUtc, endUtc).all();
    out.series = (rows.results || []).map((r) => ({ day: r.day, count: Number(r.n || 0) }));
  }
  return out;
}

async function toolAccountsByTier(db) {
  const rows = await db.prepare(
    `SELECT COALESCE(s.tier, 'free') AS tier, COUNT(*) AS n
     FROM users u LEFT JOIN account_subscriptions s ON s.user_id = u.id
     GROUP BY COALESCE(s.tier, 'free')`
  ).all();
  const byTier = (rows.results || []).map((r) => ({ tier: r.tier, count: Number(r.n || 0) }));
  let total = 0;
  for (const r of byTier) total += r.count;
  let activePromoClaims = null;
  try {
    const now = toSqliteDate();
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM promo_claims WHERE promo_slug = ? AND status = 'active' AND expires_at > ?`
    ).bind(PROMO_SLUG, now).first();
    activePromoClaims = Number((row && row.n) || 0);
  } catch (e) {
    activePromoClaims = null;
  }
  return { by_tier: byTier, total, active_promo_claims: activePromoClaims };
}

async function toolRevenue(db, args) {
  const period = String((args && args.period) || "all").toLowerCase();
  const clause = periodClause(period, "paid_at");
  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_kobo), 0) AS kobo FROM subscription_payments WHERE status = 'paid'${clause.sql}`
  ).bind(...clause.params).first();
  const byMethodRows = await db.prepare(
    `SELECT COALESCE(payment_method, 'paystack') AS method, COUNT(*) AS n, COALESCE(SUM(amount_kobo), 0) AS kobo
     FROM subscription_payments WHERE status = 'paid'${clause.sql}
     GROUP BY COALESCE(payment_method, 'paystack') ORDER BY kobo DESC`
  ).bind(...clause.params).all();
  const byTierRows = await db.prepare(
    `SELECT tier, COUNT(*) AS n, COALESCE(SUM(amount_kobo), 0) AS kobo
     FROM subscription_payments WHERE status = 'paid'${clause.sql}
     GROUP BY tier ORDER BY kobo DESC`
  ).bind(...clause.params).all();
  const manualClause = periodClause(period, "created_at");
  let manualNgn = null;
  let manualCount = null;
  try {
    const mRow = await db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_kobo), 0) AS kobo FROM manual_payments WHERE status = 'approved'${manualClause.sql}`
    ).bind(...manualClause.params).first();
    manualNgn = Number((mRow && mRow.kobo) || 0) / 100;
    manualCount = Number((mRow && mRow.n) || 0);
  } catch (e) {
    manualNgn = null;
    manualCount = null;
  }
  return {
    period,
    total_ngn: Number((totalRow && totalRow.kobo) || 0) / 100,
    count: Number((totalRow && totalRow.n) || 0),
    by_method: (byMethodRows.results || []).map((r) => ({ method: r.method, total_ngn: Number(r.kobo || 0) / 100, count: Number(r.n || 0) })),
    by_tier: (byTierRows.results || []).map((r) => ({ tier: r.tier, total_ngn: Number(r.kobo || 0) / 100, count: Number(r.n || 0) })),
    manual_ngn: manualNgn,
    manual_count: manualCount,
  };
}

async function toolPendingPayments(db) {
  const subCountRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM subscription_payments WHERE status = 'pending'`
  ).first();
  const subRows = await db.prepare(
    `SELECT p.id, u.email AS email, p.tier, p.billing_cycle, p.amount_kobo, p.payment_method, p.created_at
     FROM subscription_payments p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' ORDER BY p.id DESC LIMIT 10`
  ).all();
  const upgradesRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM account_subscriptions WHERE status = 'pending'`
  ).first();
  let manual = { count: null, payments: [], older_than_48h: null };
  try {
    const mCount = await db.prepare(
      `SELECT COUNT(*) AS n FROM manual_payments WHERE status = 'pending'`
    ).first();
    const mRows = await db.prepare(
      `SELECT m.id, u.email AS email, m.tier, m.billing_cycle, m.amount_kobo, m.reference_number, m.created_at
       FROM manual_payments m LEFT JOIN users u ON u.id = CAST(m.user_id AS INTEGER)
       WHERE m.status = 'pending' ORDER BY m.created_at DESC LIMIT 10`
    ).all();
    const cutoff = toSqliteDate(new Date(Date.now() - 48 * 3600 * 1000));
    const oldRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM manual_payments WHERE status = 'pending' AND created_at < ?`
    ).bind(cutoff).first();
    manual = {
      count: Number((mCount && mCount.n) || 0),
      payments: (mRows.results || []).map((r) => ({
        id: r.id, email: r.email || null, tier: r.tier, billing_cycle: r.billing_cycle,
        amount_ngn: Number(r.amount_kobo || 0) / 100, reference_number: r.reference_number, created_at: r.created_at,
      })),
      older_than_48h: Number((oldRow && oldRow.n) || 0),
    };
  } catch (e) {
    manual = { count: null, payments: [], older_than_48h: null };
  }
  return {
    subscriptions: {
      count: Number((subCountRow && subCountRow.n) || 0),
      payments: (subRows.results || []).map((r) => ({
        id: r.id, email: r.email || null, tier: r.tier, billing_cycle: r.billing_cycle,
        amount_ngn: Number(r.amount_kobo || 0) / 100, payment_method: r.payment_method || null, created_at: r.created_at,
      })),
    },
    manual,
    pending_upgrades: Number((upgradesRow && upgradesRow.n) || 0),
    // Flat mirrors for quick reading by the model and the briefing cards.
    pending_count: Number((subCountRow && subCountRow.n) || 0),
    manual_pending: manual.count,
    manual_older_than_48h: manual.older_than_48h,
  };
}

async function toolExpiring(db, args) {
  const daysRaw = Number(args && args.days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 90) : 7;
  const now = toSqliteDate();
  const until = toSqliteDate(new Date(Date.now() + days * 86400000));
  const countRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM account_subscriptions
     WHERE tier != 'free' AND status = 'active' AND current_period_end IS NOT NULL
       AND current_period_end >= ? AND current_period_end <= ?`
  ).bind(now, until).first();
  const rows = await db.prepare(
    `SELECT u.email AS email, u.full_name AS full_name, s.tier, s.billing_cycle, s.current_period_end
     FROM account_subscriptions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.tier != 'free' AND s.status = 'active' AND s.current_period_end IS NOT NULL
       AND s.current_period_end >= ? AND s.current_period_end <= ?
     ORDER BY s.current_period_end ASC LIMIT 20`
  ).bind(now, until).all();
  return {
    days,
    count: Number((countRow && countRow.n) || 0),
    subscriptions: (rows.results || []).map((r) => ({
      email: r.email || null, full_name: r.full_name || null, tier: r.tier,
      billing_cycle: r.billing_cycle || null, current_period_end: r.current_period_end,
    })),
  };
}

async function toolPromoState(db) {
  try {
    const def = await getPromoDef(db);
    const now = toSqliteDate();
    const counts = await db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'active' AND expires_at > ? THEN 1 ELSE 0 END), 0) AS active
       FROM promo_claims WHERE promo_slug = ?`
    ).bind(now, PROMO_SLUG).first();
    const rows = await db.prepare(
      `SELECT c.user_id, u.email AS email, c.claimed_at, c.expires_at, c.status
       FROM promo_claims c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.promo_slug = ? ORDER BY c.claimed_at DESC, c.id DESC LIMIT 5`
    ).bind(PROMO_SLUG).all();
    let isActive = false;
    if (def && Number(def.is_active || 0) === 1) {
      if ((!def.starts_at || String(def.starts_at) <= now) && (!def.ends_at || String(def.ends_at) > now)) isActive = true;
    }
    return {
      available: !!def,
      is_active: isActive,
      slug: def ? def.slug : PROMO_SLUG,
      name: def ? def.name : null,
      tier: def ? def.tier : null,
      total_claims: Number((counts && counts.total) || 0),
      active_claims: Number((counts && counts.active) || 0),
      newest_claims: (rows.results || []).map((r) => ({
        email: r.email || null, claimed_at: r.claimed_at, expires_at: r.expires_at, status: r.status,
      })),
    };
  } catch (e) {
    return { available: false, is_active: false, total_claims: null, active_claims: null, newest_claims: [] };
  }
}

async function toolSupportLoad(db) {
  let byStatus = null;
  let open = null;
  let awaiting = null;
  try {
    const rows = await db.prepare(
      `SELECT status, COUNT(*) AS n FROM support_cases GROUP BY status`
    ).all();
    byStatus = {};
    for (const r of rows.results || []) byStatus[String(r.status || "open")] = Number(r.n || 0);
    open = byStatus.open || 0;
  } catch (e) {
    byStatus = null;
    open = null;
  }
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM support_cases WHERE status = 'open' AND first_response_at IS NULL`
    ).first();
    awaiting = Number((row && row.n) || 0);
  } catch (e) {
    awaiting = null;
  }
  let chatsNeedingHuman = null;
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM chat_sessions WHERE status = 'active' AND needs_human = 1`
    ).first();
    chatsNeedingHuman = Number((row && row.n) || 0);
  } catch (e) {
    chatsNeedingHuman = null;
  }
  return {
    by_status: byStatus,
    open,
    awaiting_first_response: awaiting,
    chats_needing_human: chatsNeedingHuman,
  };
}

async function toolAiUsageToday(db) {
  const day = new Date().toISOString().slice(0, 10);
  let totals = { questions: 0, actions: 0 };
  let byTier = [];
  let top = [];
  try {
    const row = await db.prepare(
      `SELECT COALESCE(SUM(count), 0) AS q, COALESCE(SUM(actions), 0) AS a FROM ai_usage WHERE day = ?`
    ).bind(day).first();
    totals = { questions: Number((row && row.q) || 0), actions: Number((row && row.a) || 0) };
  } catch (e) { /* table may not exist yet */ }
  try {
    const rows = await db.prepare(
      `SELECT COALESCE(s.tier, 'free') AS tier, COALESCE(SUM(au.count), 0) AS q, COALESCE(SUM(au.actions), 0) AS a
       FROM ai_usage au
       LEFT JOIN businesses b ON b.id = CAST(au.business_id AS INTEGER)
       LEFT JOIN account_subscriptions s ON s.user_id = b.owner_user_id
       WHERE au.day = ?
       GROUP BY COALESCE(s.tier, 'free') ORDER BY q DESC`
    ).bind(day).all();
    byTier = (rows.results || []).map((r) => ({ tier: r.tier, questions: Number(r.q || 0), actions: Number(r.a || 0) }));
  } catch (e) { /* degrade to empty */ }
  try {
    const rows = await db.prepare(
      `SELECT au.business_id, b.name AS name, COALESCE(SUM(au.count), 0) AS q, COALESCE(SUM(au.actions), 0) AS a
       FROM ai_usage au
       LEFT JOIN businesses b ON b.id = CAST(au.business_id AS INTEGER)
       WHERE au.day = ?
       GROUP BY au.business_id ORDER BY q DESC LIMIT 5`
    ).bind(day).all();
    top = (rows.results || []).map((r) => ({
      business_id: r.business_id, name: r.name || null,
      questions: Number(r.q || 0), actions: Number(r.a || 0),
    }));
  } catch (e) { /* degrade to empty */ }
  return { day, total_questions: totals.questions, total_actions: totals.actions, questions: totals.questions, actions: totals.actions, by_tier: byTier, top_businesses: top };
}

async function toolDormant(db, args) {
  const daysRaw = Number(args && args.days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 365) : 14;
  const cutoff = toSqliteDate(new Date(Date.now() - days * 86400000));
  const baseSql = `
    SELECT b.id, b.name, b.created_at, u.email AS owner_email,
           MAX(s.created_at) AS last_sale
    FROM businesses b
    LEFT JOIN users u ON u.id = b.owner_user_id
    LEFT JOIN sales s ON s.business_id = b.id
    WHERE (b.status IS NULL OR b.status = 'active')
    GROUP BY b.id
    HAVING (last_sale IS NOT NULL AND last_sale < ?) OR (last_sale IS NULL AND b.created_at < ?)`;
  const countRows = await db.prepare(`SELECT COUNT(*) AS n FROM (${baseSql})`).bind(cutoff, cutoff).all();
  // COUNT over a grouped subquery returns one row per group in SQLite when
  // wrapped this way only via the outer aggregate; fall back to row count.
  let count = 0;
  const cr = countRows.results || [];
  if (cr.length === 1 && cr[0].n != null && cr[0].last_sale === undefined) count = Number(cr[0].n || 0);
  const rows = await db.prepare(baseSql + ` ORDER BY (last_sale IS NULL) ASC, last_sale ASC LIMIT 15`).bind(cutoff, cutoff).all();
  const list = rows.results || [];
  if (!count) count = list.length >= 15 ? list.length : list.length;
  // Accurate count: re-run without limit when the capped list is full is
  // overkill; the grouped count above is authoritative when present.
  const nowMs = Date.now();
  const businesses = list.map((r) => {
    const ref = r.last_sale || r.created_at;
    let daysInactive = null;
    if (ref) {
      const ms = new Date(String(ref).replace(" ", "T") + "Z").getTime();
      if (Number.isFinite(ms)) daysInactive = Math.floor((nowMs - ms) / 86400000);
    }
    return {
      id: r.id, name: r.name, owner_email: r.owner_email || null,
      last_sale_at: r.last_sale || null, created_at: r.created_at, days_inactive: daysInactive,
    };
  });
  return { days, count, businesses };
}

async function enrichAccount(db, user) {
  const sub = await db.prepare(
    `SELECT tier, status, billing_cycle, current_period_start, current_period_end FROM account_subscriptions WHERE user_id = ? LIMIT 1`
  ).bind(user.id).first();
  const bizRows = await db.prepare(
    `SELECT b.id, b.name, b.status,
            (SELECT COUNT(*) FROM sales s WHERE s.business_id = b.id) AS sales_count,
            (SELECT COUNT(*) FROM products p WHERE p.business_id = b.id AND p.is_active = 1) AS products_count,
            (SELECT COUNT(*) FROM customers c WHERE c.business_id = b.id) AS customers_count
     FROM businesses b WHERE b.owner_user_id = ? ORDER BY b.id ASC LIMIT 20`
  ).bind(user.id).all();
  const paidRow = await db.prepare(
    `SELECT COALESCE(SUM(amount_kobo), 0) AS kobo FROM subscription_payments WHERE user_id = ? AND status = 'paid'`
  ).bind(user.id).first();
  const lastPay = await db.prepare(
    `SELECT tier, amount_kobo, payment_method, paid_at FROM subscription_payments WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC, id DESC LIMIT 1`
  ).bind(user.id).first();
  let support = { open: null, total: null };
  try {
    const sRow = await db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open
       FROM support_cases WHERE user_id = ?`
    ).bind(String(user.id)).first();
    support = { open: Number((sRow && sRow.open) || 0), total: Number((sRow && sRow.total) || 0) };
  } catch (e) { /* support tables may not exist */ }
  let promoClaims = [];
  try {
    const pRows = await db.prepare(
      `SELECT promo_slug, status, claimed_at, expires_at, prior_tier FROM promo_claims WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 5`
    ).bind(user.id).all();
    promoClaims = (pRows.results || []).map((r) => ({ promo: r.promo_slug, status: r.status, expires_at: r.expires_at, prior_tier: r.prior_tier }));
  } catch (e) { /* promo tables may not exist */ }
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    status: user.status,
    is_platform_admin: !!user.is_platform_admin,
    joined: user.created_at,
    subscription: sub
      ? { tier: sub.tier, status: sub.status, billing_cycle: sub.billing_cycle, current_period_start: sub.current_period_start, current_period_end: sub.current_period_end }
      : { tier: "free", status: "active", billing_cycle: null, current_period_start: null, current_period_end: null },
    businesses: (bizRows.results || []).map((b) => ({
      id: b.id, name: b.name, status: b.status || "active",
      sales_count: Number(b.sales_count || 0), products_count: Number(b.products_count || 0), customers_count: Number(b.customers_count || 0),
    })),
    paid_total_ngn: Number((paidRow && paidRow.kobo) || 0) / 100,
    last_payment: lastPay
      ? { tier: lastPay.tier, amount_ngn: Number(lastPay.amount_kobo || 0) / 100, payment_method: lastPay.payment_method || null, paid_at: lastPay.paid_at }
      : null,
    support_cases: support,
    promo_claims: promoClaims,
  };
}

async function toolAccountLookup(db, args) {
  const query = String((args && (args.query || args.email || args.q)) || "").trim();
  if (!query) return { query, accounts: [], error: "A search query is required." };
  let users = [];
  const exact = await db.prepare(
    `SELECT id, email, full_name, status, is_platform_admin, created_at FROM users WHERE LOWER(email) = LOWER(?) LIMIT 5`
  ).bind(query).all();
  users = exact.results || [];
  if (!users.length) {
    const like = `%${query}%`;
    const fuzzy = await db.prepare(
      `SELECT id, email, full_name, status, is_platform_admin, created_at FROM users
       WHERE email LIKE ? OR full_name LIKE ? ORDER BY id DESC LIMIT 5`
    ).bind(like, like).all();
    users = fuzzy.results || [];
  }
  const accounts = [];
  for (const u of users.slice(0, 5)) accounts.push(await enrichAccount(db, u));
  return { query, accounts };
}

async function toolBusinessLookup(db, args) {
  const query = String((args && (args.query || args.name || args.q)) || "").trim();
  if (!query) return { query, businesses: [], error: "A search query is required." };
  const like = `%${query}%`;
  const rows = await db.prepare(
    `SELECT b.id, b.name, b.status, b.created_at,
            u.email AS owner_email, COALESCE(s.tier, 'free') AS owner_tier,
            (SELECT COUNT(*) FROM sales sl WHERE sl.business_id = b.id) AS sales_count,
            (SELECT COALESCE(SUM(total_amount), 0) FROM sales sl WHERE sl.business_id = b.id) AS sales_volume,
            (SELECT COUNT(*) FROM products p WHERE p.business_id = b.id AND p.is_active = 1) AS products_count,
            (SELECT COUNT(*) FROM customers c WHERE c.business_id = b.id) AS customers_count,
            (SELECT MAX(created_at) FROM sales sl WHERE sl.business_id = b.id) AS last_sale
     FROM businesses b
     LEFT JOIN users u ON u.id = b.owner_user_id
     LEFT JOIN account_subscriptions s ON s.user_id = b.owner_user_id
     WHERE b.name LIKE ? ORDER BY b.id DESC LIMIT 5`
  ).bind(like).all();
  return {
    query,
    businesses: (rows.results || []).map((r) => ({
      id: r.id, name: r.name, status: r.status || "active", created_at: r.created_at,
      owner_email: r.owner_email || null, owner_tier: r.owner_tier,
      sales_count: Number(r.sales_count || 0),
      sales_volume_ngn: Math.round(Number(r.sales_volume || 0) * 100) / 100,
      products_count: Number(r.products_count || 0),
      customers_count: Number(r.customers_count || 0),
      last_sale_at: r.last_sale || null,
    })),
  };
}

async function toolFullBriefing(db) {
  const overview = await toolPlatformOverview(db);
  const signupsToday = await toolSignups(db, { period: "today" });
  const revenueToday = await toolRevenue(db, { period: "today" });
  const revenueAll = await toolRevenue(db, { period: "all" });
  const pending = await toolPendingPayments(db);
  const support = await toolSupportLoad(db);
  const expiring = await toolExpiring(db, { days: 7 });
  const tiers = await toolAccountsByTier(db);
  const ai = await toolAiUsageToday(db);

  let byMonth = [];
  try {
    const rows = await db.prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS n FROM users
       GROUP BY month ORDER BY month DESC LIMIT 6`
    ).all();
    byMonth = (rows.results || []).map((r) => ({ month: r.month, count: Number(r.n || 0) })).reverse();
  } catch (e) { /* degrade */ }
  let paidUpgradesTotal = 0;
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM subscription_payments WHERE status = 'paid'`
    ).first();
    paidUpgradesTotal = Number((row && row.n) || 0);
  } catch (e) { /* degrade */ }

  return {
    today: {
      signups: signupsToday.count,
      revenue_ngn: revenueToday.total_ngn,
      pending_payments: pending.pending_count,
      manual_pending: pending.manual_pending,
      support_open: support.open,
      awaiting_first_response: support.awaiting_first_response,
      chats_needing_human: support.chats_needing_human,
      expiring_7d: expiring.count,
    },
    all_time: {
      users: overview.users,
      businesses: overview.businesses,
      active_businesses: overview.active_businesses,
      paying: overview.paying,
      subscription_revenue_ngn: overview.revenue_ngn,
      revenue_by_method: revenueAll.by_method,
      manual_approved_ngn: revenueAll.manual_ngn,
      sales_recorded_count: overview.sales,
      sales_recorded_volume_ngn: overview.sales_volume_ngn,
      tiers: tiers.by_tier,
    },
    growth: {
      signups_by_month: byMonth,
      paid_upgrades_total: paidUpgradesTotal,
    },
    ai_today: { questions: ai.total_questions, actions: ai.total_actions },
  };
}

export async function executeReadTool(db, name, args = {}) {
  const a = args || {};
  switch (String(name || "")) {
    case "platform_overview": return toolPlatformOverview(db);
    case "signups": return toolSignups(db, a);
    case "accounts_by_tier": return toolAccountsByTier(db);
    case "revenue": return toolRevenue(db, a);
    case "pending_payments": return toolPendingPayments(db);
    case "expiring_subscriptions": return toolExpiring(db, a);
    case "promo_state": return toolPromoState(db);
    case "support_load": return toolSupportLoad(db);
    case "ai_usage_today": return toolAiUsageToday(db);
    case "dormant_businesses": return toolDormant(db, a);
    case "account_lookup": return toolAccountLookup(db, a);
    case "business_lookup": return toolBusinessLookup(db, a);
    case "full_briefing": return toolFullBriefing(db);
    default: return { error: `Unknown tool: ${String(name || "")}` };
  }
}

export const READ_TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

function tierLine(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return "Tiers: no data.";
  return "Tiers: " + tiers.map((t) => `${t.tier} ${Number(t.count || 0)}`).join(", ") + ".";
}

// Deterministic, figures-first plain-text briefing. No model involved,
// so the numbers are exactly what the tools returned. No em dashes.
export function composeBriefingText(pack) {
  const p = pack || {};
  const today = p.today || {};
  const all = p.all_time || {};
  const growth = p.growth || {};
  const ai = p.ai_today || {};
  const L = [];
  L.push("KopaBook briefing");
  L.push(`Today: ${Number(today.signups || 0)} new signups, subscription revenue ${fmtNGN(today.revenue_ngn)}, ${Number(today.pending_payments || 0)} pending Paystack payments, ${today.manual_pending == null ? "unknown" : Number(today.manual_pending)} pending manual transfers.`);
  L.push(`Support today: ${today.support_open == null ? "unknown" : Number(today.support_open)} open cases, ${today.awaiting_first_response == null ? "unknown" : Number(today.awaiting_first_response)} awaiting first response, ${today.chats_needing_human == null ? "unknown" : Number(today.chats_needing_human)} live chats needing a human.`);
  L.push(`Expiring in the next 7 days: ${Number(today.expiring_7d || 0)} paid subscriptions.`);
  L.push(`AI today: ${Number(ai.questions || 0)} questions, ${Number(ai.actions || 0)} actions.`);
  L.push(`All time: ${Number(all.users || 0)} users, ${Number(all.businesses || 0)} businesses (${Number(all.active_businesses || 0)} active), ${Number(all.paying || 0)} paying accounts.`);
  L.push(`All-time subscription revenue: ${fmtNGN(all.subscription_revenue_ngn)}, manual approved: ${all.manual_approved_ngn == null ? "unknown" : fmtNGN(all.manual_approved_ngn)}.`);
  if (Array.isArray(all.revenue_by_method) && all.revenue_by_method.length) {
    L.push("Revenue by method: " + all.revenue_by_method.map((m) => `${m.method} ${fmtNGN(m.total_ngn)} (${Number(m.count || 0)})`).join(", ") + ".");
  }
  L.push(`Sales recorded by businesses: ${Number(all.sales_recorded_count || 0)} sales, volume ${fmtNGN(all.sales_recorded_volume_ngn)}.`);
  L.push(tierLine(all.tiers));
  if (Array.isArray(growth.signups_by_month) && growth.signups_by_month.length) {
    L.push("Signups by month: " + growth.signups_by_month.map((m) => `${m.month}: ${Number(m.count || 0)}`).join(", ") + ".");
  }
  L.push(`Paid upgrades all time: ${Number(growth.paid_upgrades_total || 0)}.`);
  return L.join("\n");
}

// Short daily text for the briefing endpoint. Accepts the full briefing
// pack, optionally with an anomalies object:
// { manual_pending_older_48h, failed_payments_today }.
export function composeDailyText(pack) {
  const p = pack || {};
  const base = composeBriefingText(p);
  const anomalies = p.anomalies || {};
  const L = [base];
  const notes = [];
  if (anomalies.manual_pending_older_48h != null && Number(anomalies.manual_pending_older_48h) > 0) {
    notes.push(`${Number(anomalies.manual_pending_older_48h)} manual payments have been pending for over 48 hours and need review.`);
  }
  if (anomalies.failed_payments_today != null && Number(anomalies.failed_payments_today) > 0) {
    notes.push(`${Number(anomalies.failed_payments_today)} payments failed today.`);
  }
  if (p.today && Number(p.today.expiring_7d || 0) > 0) {
    notes.push(`${Number(p.today.expiring_7d)} paid subscriptions expire in the next 7 days.`);
  }
  if (p.today && p.today.awaiting_first_response != null && Number(p.today.awaiting_first_response) > 0) {
    notes.push(`${Number(p.today.awaiting_first_response)} support cases are still awaiting a first response.`);
  }
  if (notes.length) {
    L.push("Needs attention:");
    for (const n of notes) L.push("- " + n);
  } else {
    L.push("Needs attention: nothing flagged today.");
  }
  return L.join("\n");
}
