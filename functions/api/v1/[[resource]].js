// /api/v1/* — KopaBook Developer API (read-only).
// Auth: Authorization: Bearer kbk_live_...
// Resources: business, dashboard, sales, products, debts, expenses
import { json } from "../_utils.js";
import { getApiKeyAuth, requireApiKey, requireScope, parseKeyOrigin } from "../_apikey.js";

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
  // Phase 4.1: cost_price is never returned by the Developer API. Keys
  // carry no role or permission, and they are embedded in third-party
  // websites, so the fail-closed answer is to omit cost always.
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.unit_price AS price, p.unit, p.is_active,
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

// Phase 3.5 (2026-11-16): no more Access-Control-Allow-Origin: *.
// A browser may read a v1 response only from the exact website the key
// owner registered (api_keys.website_url, set in Settings > Developer
// API). That is the site the connect.js snippet runs on. Server-to-server
// calls send no Origin and are unaffected; same-origin calls from
// kopabook.com need no CORS at all. A key with no website registered
// gets no CORS headers: it still works server-side, and its owner must
// add the website before a browser app can use it.
// Scopes: every v1 route requires the 'read' scope (see requireScope in
// _apikey.js). All keys minted today carry 'read'.
// This file stays read-only. Phase 4.1: cost_price is no longer returned
// by /products — Developer API keys carry no role or permission, so the
// fail-closed answer is to omit cost for every key.
const CORS_PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "3600",
};

// Headers for an actual (non-preflight) response: reflect the request
// Origin only when it is exactly the origin registered on this key.
// Anything else gets no Access-Control-Allow-Origin, so the browser
// refuses to hand the response to the calling page. Vary: Origin is
// always sent so shared caches never serve one origin's CORS headers
// to another.
function corsHeaders(origin, allowedOrigin) {
  const headers = { Vary: "Origin" };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function withCors(res, origin, allowedOrigin) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function corsJson(data, status = 200, origin = null, allowedOrigin = null) {
  return withCors(json(data, status), origin, allowedOrigin);
}

// Preflight carries no Authorization header (browsers strip credentials
// from preflights), so the key cannot be resolved here. Answer only
// when SOME active key registered this exact origin as its website;
// otherwise 204 with no CORS headers and the browser blocks the call.
// The website URLs are the owners' own public sites, not secrets.
// A DB failure answers the same header-less 204: fail closed.
async function preflightAllowedOrigin(db, origin) {
  if (!origin) return null;
  try {
    const rows = await db.prepare(
      `SELECT website_url FROM api_keys WHERE status = 'active' LIMIT 500`
    ).all();
    for (const r of rows.results || []) {
      if (parseKeyOrigin(r.website_url) === origin) return origin;
    }
  } catch {
    return null;
  }
  return null;
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || null;
  const headers = new Headers({ Vary: "Origin" });
  const allowed = await preflightAllowedOrigin(context.env.KOPABOOK_DB, origin);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    for (const [k, v] of Object.entries(CORS_PREFLIGHT)) headers.set(k, v);
  }
  return new Response(null, { status: 204, headers });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || null;
  try {
    const auth = await getApiKeyAuth(context);
    const denied = requireApiKey(auth);
    if (denied) {
      // No valid key, so no origin to bind CORS to: the 401/429 goes
      // out without CORS headers and a cross-origin page cannot read it.
      return denied;
    }
    const scopeDenied = requireScope(auth, "read");
    if (scopeDenied) {
      return withCors(scopeDenied, origin, auth.allowedOrigin);
    }

    const url = new URL(context.request.url);
    // [[resource]] captures the path after /api/v1/
    const m = url.pathname.match(/^\/api\/v1\/([a-z]+)\/?$/);
    const resource = m ? m[1] : "";
    const handler = HANDLERS[resource];
    if (!handler) {
      return corsJson({ ok: false, error: "unknown-resource",
        message: "Available resources: business, dashboard, sales, products, debts, expenses." }, 404, origin, auth.allowedOrigin);
    }
    const res = await handler(context.env.KOPABOOK_DB, auth, url);
    return withCors(res, origin, auth.allowedOrigin);
  } catch (e) {
    return corsJson({ ok: false, error: "server-error" }, 500, origin, null);
  }
}
