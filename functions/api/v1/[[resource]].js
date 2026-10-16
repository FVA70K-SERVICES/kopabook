// /api/v1/* — KopaBook Developer API (read-only).
// Auth: Authorization: Bearer kbk_live_...
// Resources: business, dashboard, sales, products, debts, expenses
import { json } from "../_utils.js";
import { getApiKeyAuth, requireApiKey } from "../_apikey.js";

async function handleBusiness(db, auth) {
  const b = auth.business;
  return json({ ok: true, business: {
    id: b.id, name: b.name, type: b.business_type,
    currency: b.currency, country: b.country, timezone: b.timezone,
  }});
}

async function handleDashboard(db, auth) {
  const bid = auth.business.id;
  const todaySales = await db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
     FROM sales WHERE business_id = ? AND date(created_at) = date('now')`
  ).bind(bid).first();
  const products = await db.prepare(
    `SELECT COUNT(*) AS count FROM products WHERE business_id = ? AND is_active = 1`
  ).bind(bid).first();
  const debtRows = await db.prepare(
    `SELECT (SELECT balance_after FROM customer_ledger
             WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS outstanding
     FROM customers c WHERE c.business_id = ?`
  ).bind(bid).all();
  let outstandingDebt = 0, openDebts = 0;
  for (const r of debtRows.results || []) {
    const o = Number(r.outstanding || 0);
    if (o > 0) { outstandingDebt += o; openDebts++; }
  }
  const lowStock = await db.prepare(
    `SELECT COUNT(*) AS count FROM products p
     LEFT JOIN inventory_items i ON i.product_id = p.id
     WHERE p.business_id = ? AND p.is_active = 1
       AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_level, p.low_stock_threshold, 5)`
  ).bind(bid).first();
  return json({ ok: true, dashboard: {
    currency: auth.business.currency,
    todaySalesTotal: Number(todaySales?.total || 0),
    todaySalesCount: Number(todaySales?.count || 0),
    activeProducts: Number(products?.count || 0),
    outstandingDebt, openDebts,
    lowStockCount: Number(lowStock?.count || 0),
  }});
}

async function handleSales(db, auth, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rows = await db.prepare(
    `SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.balance_due,
            s.payment_method, s.created_at, c.name AS customer_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.business_id = ? ORDER BY s.id DESC LIMIT ? OFFSET ?`
  ).bind(auth.business.id, limit, offset).all();
  return json({ ok: true, sales: rows.results || [], limit, offset });
}

async function handleProducts(db, auth, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.price, p.cost_price, p.is_active,
            COALESCE(i.quantity_on_hand, 0) AS stock
     FROM products p LEFT JOIN inventory_items i ON i.product_id = p.id
     WHERE p.business_id = ? ORDER BY p.name ASC LIMIT ? OFFSET ?`
  ).bind(auth.business.id, limit, offset).all();
  return json({ ok: true, products: rows.results || [], limit, offset });
}

async function handleDebts(db, auth) {
  const rows = await db.prepare(
    `SELECT c.id, c.name, c.phone,
            (SELECT balance_after FROM customer_ledger
             WHERE customer_id = c.id ORDER BY id DESC LIMIT 1) AS outstanding
     FROM customers c WHERE c.business_id = ?`
  ).bind(auth.business.id).all();
  const debts = (rows.results || [])
    .map((r) => ({ id: r.id, name: r.name, phone: r.phone, outstanding: Number(r.outstanding || 0) }))
    .filter((d) => d.outstanding > 0);
  return json({ ok: true, debts, count: debts.length });
}

async function handleExpenses(db, auth, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rows = await db.prepare(
    `SELECT id, amount, category, description, incurred_on, created_at
     FROM expenses WHERE business_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(auth.business.id, limit, offset).all();
  return json({ ok: true, expenses: rows.results || [], limit, offset });
}

const HANDLERS = {
  business: handleBusiness,
  dashboard: handleDashboard,
  sales: handleSales,
  products: handleProducts,
  debts: handleDebts,
  expenses: handleExpenses,
};

// Any website can connect: allow cross-origin browser calls to this
// read-only API. Keys stay secret because they live in the site owner's
// own backend or are restricted to public (non-sensitive) reads.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function corsJson(data, status = 200) {
  const res = json(data, status);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const auth = await getApiKeyAuth(context);
    const denied = requireApiKey(auth);
    if (denied) {
      const res = denied;
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    const url = new URL(context.request.url);
    // [[resource]] captures the path after /api/v1/
    const m = url.pathname.match(/^\/api\/v1\/([a-z]+)\/?$/);
    const resource = m ? m[1] : "";
    const handler = HANDLERS[resource];
    if (!handler) {
      return corsJson({ ok: false, error: "unknown-resource",
        message: "Available resources: business, dashboard, sales, products, debts, expenses." }, 404);
    }
    const res = await handler(context.env.KOPABOOK_DB, auth, url);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return corsJson({ ok: false, error: "server-error" }, 500);
  }
}
