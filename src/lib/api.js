// Tiny API client for KopaBook.

// Every request gets a 30s ceiling so a stalled network can never hang the app.
const REQUEST_TIMEOUT_MS = 30000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options,
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

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body || {}) }),
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
