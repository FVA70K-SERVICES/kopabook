// Dashboard snapshot cache (KopaBook speed build, worker W2).
//
// The Dashboard paints instantly from the last known snapshot for the
// signed-in business, then replaces it with fresh data when
// /api/dashboard resolves. The snapshot lives in sessionStorage first
// (per tab, gone when the tab closes) with an in-memory fallback when
// sessionStorage is unavailable (private mode, quota, SSR). localStorage
// is deliberately NOT used: a snapshot must never survive into another
// session or leak across accounts on a shared device.
//
// Key: kopabook:dashboard-snapshot:v1:<businessId>:<YYYY-MM-DD>.
// The business id is part of the key, so switching businesses (or
// accounts) in the same tab can never paint another business's figures.
// The day is the client local date at save time; a snapshot is only ever
// read back for the same business and the same day, and only when its
// savedAt is within the last 24 hours. The payload is validated on read:
// corrupt, partial or wrong-shape snapshots are ignored, never painted.
//
// No money figure is ever invented here: the cache only stores what the
// server already returned. When no snapshot exists the Dashboard shows a
// loading skeleton, never money zeros presented as data.

export const DASHBOARD_SNAPSHOT_PREFIX = "kopabook:dashboard-snapshot:v1:";
export const DASHBOARD_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const memoryStore = new Map();

function isUsableStorage(store) {
  return (
    store &&
    typeof store.getItem === "function" &&
    typeof store.setItem === "function" &&
    typeof store.removeItem === "function"
  );
}

// sessionStorage first; in-memory fallback. The caller may inject a
// storage-like object (tests do); otherwise sessionStorage is used.
export function dashboardSnapshotStorage(injected) {
  if (isUsableStorage(injected)) return injected;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // sessionStorage throws in some private modes: fall through.
  }
  return {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => { memoryStore.set(k, String(v)); },
    removeItem: (k) => { memoryStore.delete(k); },
  };
}

export function dashboardSnapshotKey(businessId, day) {
  const bid = String(businessId ?? "").trim();
  const d = String(day ?? "").trim();
  if (!bid || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${DASHBOARD_SNAPSHOT_PREFIX}${bid}:${d}`;
}

// "HH:MM" for the "Updated HH:MM" note, in the device locale.
export function formatSnapshotTime(savedAt) {
  try {
    return new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function isValidSnapshot(value, businessId, day) {
  if (!value || typeof value !== "object") return false;
  if (String(value.businessId ?? "") !== String(businessId)) return false;
  if (String(value.day ?? "") !== String(day)) return false;
  if (!value.metrics || typeof value.metrics !== "object") return false;
  // The money fields the Dashboard paints must be real numbers. A
  // snapshot missing them is not painted at all.
  for (const field of ["todaySalesTotal", "todayExpensesTotal", "outstandingDebtTotal"]) {
    if (typeof value.metrics[field] !== "number" || Number.isNaN(value.metrics[field])) return false;
  }
  if (!Array.isArray(value.recentSales)) return false;
  const savedAt = Number(value.savedAt || 0);
  if (!savedAt || savedAt > Date.now()) return false;
  if (Date.now() - savedAt > DASHBOARD_SNAPSHOT_MAX_AGE_MS) return false;
  return true;
}

export function readDashboardSnapshot(businessId, day, storage) {
  const key = dashboardSnapshotKey(businessId, day);
  if (!key) return null;
  try {
    const raw = dashboardSnapshotStorage(storage).getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidSnapshot(parsed, businessId, day)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDashboardSnapshot(businessId, day, payload, storage) {
  const key = dashboardSnapshotKey(businessId, day);
  if (!key) return false;
  if (!payload || !payload.metrics || typeof payload.metrics !== "object") return false;
  if (!Array.isArray(payload.recentSales)) return false;
  const snapshot = {
    v: 1,
    businessId: String(businessId),
    day: String(day),
    savedAt: Date.now(),
    metrics: payload.metrics,
    recentSales: payload.recentSales,
  };
  try {
    const store = dashboardSnapshotStorage(storage);
    store.setItem(key, JSON.stringify(snapshot));
    pruneDashboardSnapshots(businessId, day, store);
    return true;
  } catch {
    return false;
  }
}

// Drop snapshots for the same business on other days, so a stale day can
// never be read back. Other businesses' snapshots are left alone.
export function pruneDashboardSnapshots(businessId, keepDay, storage) {
  const store = dashboardSnapshotStorage(storage);
  const prefix = `${DASHBOARD_SNAPSHOT_PREFIX}${String(businessId)}:`;
  try {
    if (typeof store.length === "number" && typeof store.key === "function") {
      const doomed = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(prefix) && !k.endsWith(`:${keepDay}`)) doomed.push(k);
      }
      for (const k of doomed) store.removeItem(k);
    } else if (store instanceof Map) {
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix) && !k.endsWith(`:${keepDay}`)) store.delete(k);
      }
    }
    // The in-memory fallback Map is module-private; prune it directly.
    for (const k of [...memoryStore.keys()]) {
      if (k.startsWith(prefix) && !k.endsWith(`:${keepDay}`)) memoryStore.delete(k);
    }
  } catch {
    // Pruning is housekeeping: never break the save path.
  }
  return true;
}
