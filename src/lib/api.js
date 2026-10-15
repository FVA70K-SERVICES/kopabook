// Tiny API client for KopaBook.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body || {}) }),
  patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body || {}) }),
  del: (path) => request(path, { method: "DELETE" }),

  me: () => request("/api/auth/me"),
  login: (email, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  bootstrap: (payload) => request("/api/auth/bootstrap", { method: "POST", body: JSON.stringify(payload) }),
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
