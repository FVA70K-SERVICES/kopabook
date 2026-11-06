// Tiny API client for KopaBook.

// Every request gets a 30s ceiling so a stalled network can never hang the app.
const REQUEST_TIMEOUT_MS = 30000;

// Speed (2026-11-06): cold open used to run api.me() and then, only
// after it resolved, the app-lock state GET, and any second identical
// GET started a whole new request. Two fixes, both scoped narrowly:
//   - In-flight GET dedupe: concurrent identical GETs share one fetch.
//   - A short-lived cache for the two slow-changing session reads only
//     (/api/auth/me and /api/auth/app-lock, 60s). Nothing else is
//     cached: dashboard, sales, products and every other read still
//     hits the network every time, so figures never go stale. Any
//     mutation (POST/PUT/PATCH/DELETE) clears the session cache, so a
//     PIN setup, change or reset is never followed by a stale read.
//     Error responses are never cached.
const SESSION_CACHE_TTL_MS = 60000;
const SESSION_CACHE_PATHS = ["/api/auth/me", "/api/auth/app-lock"];
const sessionCache = new Map();
const inflightGets = new Map();

function isSessionCachePath(path) {
  return SESSION_CACHE_PATHS.includes(String(path).split("?")[0]);
}

export function invalidateSessionCache() {
  sessionCache.clear();
}

async function doRequest(path, fetchOptions, _timeoutMs) {
  const controller = new AbortController();
  // Per-call override for long-running calls only (Admin AI chat, 100s).
  // Every other call keeps the 30s ceiling below.
  const timeoutMs = typeof _timeoutMs === "number" ? _timeoutMs : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...fetchOptions,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      if (data.upgradeRequired) err.upgradeRequired = true;
      if (typeof data.retryAfterSeconds === "number") err.retryAfterSeconds = data.retryAfterSeconds;
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function request(path, options = {}) {
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};
  const method = String(fetchOptions.method || "GET").toUpperCase();
  if (method === "GET" && isSessionCachePath(path)) {
    const cached = sessionCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const inflight = inflightGets.get(path);
    if (inflight) return inflight;
    const p = doRequest(path, fetchOptions, _timeoutMs);
    inflightGets.set(path, p);
    try {
      const data = await p;
      sessionCache.set(path, { data, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
      return data;
    } finally {
      if (inflightGets.get(path) === p) inflightGets.delete(path);
    }
  }
  const data = await doRequest(path, fetchOptions, _timeoutMs);
  if (method !== "GET") invalidateSessionCache();
  return data;
}

// Fresh session read: skips the cache and any in-flight duplicate, hits
// the network, and refreshes the cache with what comes back. For checks
// where a seconds-old answer is the wrong answer (the background-return
// re-lock check: the owner may have turned the lock off elsewhere).
async function requestFresh(path, options = {}) {
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};
  const data = await doRequest(path, fetchOptions, _timeoutMs);
  if (isSessionCachePath(path)) {
    sessionCache.set(path, { data, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  getFresh: (path) => requestFresh(path),
  post: (path, body, opts) => request(path, { method: "POST", body: JSON.stringify(body || {}), timeoutMs: opts && opts.timeoutMs }),
  put: (path, body) => request(path, { method: "PUT", body: JSON.stringify(body || {}) }),
  patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body || {}) }),
  del: (path) => request(path, { method: "DELETE" }),

  me: () => request("/api/auth/me"),
  login: (identifier, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
};

const CURRENCY_SYMBOLS = {
  NGN: "₦", GHS: "₵", USD: "$", EUR: "€", GBP: "£", KES: "KSh ", UGX: "USh ",
  TZS: "TSh ", ZAR: "R ", INR: "₹", PHP: "₱", CNY: "¥", JPY: "¥", AED: "د.إ ",
};

// The active business currency, set from the session after sign-in.
let activeCurrency = "NGN";
export function setCurrency(code) {
  if (/^[A-Z]{3}$/.test(String(code || ""))) activeCurrency = code;
}
export function getCurrency() { return activeCurrency; }

export function fmt(n, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : activeCurrency;
  const v = Number(n || 0);
  const sym = CURRENCY_SYMBOLS[code] || (code + " ");
  return sym + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function nav(path) {
  window.location.href = path;
}
