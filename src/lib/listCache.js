// Stale-while-revalidate list cache for KopaBook list screens.
//
// Two tiers:
//  - In-memory Map: always used. It lives only for this page load, and
//    switching business does a full navigation (window.location.href in
//    BusinessSwitcher), which clears it. Safe for pages that do not
//    receive a session prop and so cannot name their business.
//  - localStorage: only when a real business id is supplied. The key
//    always includes the business id, so one business's cached list can
//    never paint inside another business.
//
// Nothing here is hardcoded to any business, product, amount, currency
// or plan. Cached entries expire after CACHE_TTL_MS (default 5 minutes);
// an expired entry is never painted, it is dropped.
const PREFIX = "kopabook:list-cache:v1:";
export const CACHE_TTL_MS = 5 * 60 * 1000;

const memoryCache = new Map();

export function businessKey(sessionOrId) {
  if (!sessionOrId) return "";
  if (typeof sessionOrId === "string" || typeof sessionOrId === "number") return String(sessionOrId);
  if (sessionOrId.business && sessionOrId.business.id !== undefined && sessionOrId.business.id !== null) {
    return String(sessionOrId.business.id);
  }
  if (sessionOrId.id !== undefined && sessionOrId.id !== null) return String(sessionOrId.id);
  return "";
}

function storageKey(listName, businessId) {
  return PREFIX + String(businessId || "anon") + ":" + String(listName);
}

function isEntry(value) {
  return value && typeof value === "object" && value.v === 1 && "data" in value && typeof value.updatedAt === "number";
}

// Returns { data, updatedAt, fresh } or null. Never throws.
export function getCachedList(listName, businessId, options) {
  const maxAgeMs = options && typeof options.maxAgeMs === "number" ? options.maxAgeMs : CACHE_TTL_MS;
  const key = storageKey(listName, businessId);
  const mem = memoryCache.get(key);
  if (isEntry(mem)) {
    if (Date.now() - mem.updatedAt <= maxAgeMs) return { data: mem.data, updatedAt: mem.updatedAt, fresh: true };
    memoryCache.delete(key);
  }
  const biz = businessKey(businessId);
  if (!biz) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isEntry(parsed)) return null;
    if (Date.now() - parsed.updatedAt > maxAgeMs) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    memoryCache.set(key, parsed);
    return { data: parsed.data, updatedAt: parsed.updatedAt, fresh: true };
  } catch { return null; }
}

// Stores data for a later instant first paint. Never throws.
export function setCachedList(listName, businessId, data) {
  const entry = { v: 1, data, updatedAt: Date.now() };
  const key = storageKey(listName, businessId);
  memoryCache.set(key, entry);
  const biz = businessKey(businessId);
  if (!biz) return;
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* storage full or unavailable: memory tier still works */ }
}

export function clearCachedList(listName, businessId) {
  const key = storageKey(listName, businessId);
  memoryCache.delete(key);
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// Drops every cached list for one business (used after a business switch
// or sign out). Never touches another business's entries.
export function clearBusinessCache(businessId) {
  const biz = businessKey(businessId);
  if (!biz) return;
  const prefix = PREFIX + biz + ":";
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// "14:32" in the device's local time, for the "Updated HH:MM" note.
export function formatUpdatedTime(updatedAt) {
  if (!updatedAt) return "";
  try {
    const d = new Date(updatedAt);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  } catch { return ""; }
}

// True when the failure looks like no connection rather than a server
// answer, so the screen can say so in plain words.
export function isNetworkError(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timed out") || msg.includes("offline") || msg.includes("load failed");
}
