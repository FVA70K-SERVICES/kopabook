// Offline mutation queue and read mirror for KopaBook.
// Wraps the fetch layer without touching src/lib/api.js.

import { useEffect, useState } from "react";
import { idbGet, idbPut, idbAll, idbDelete } from "./db.js";

function rawRequest(method, url, body) {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body || {}),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  });
}

function isNetworkFailure(err) {
  return err instanceof TypeError;
}

async function pendingCount() {
  try {
    const items = await idbAll("outbox");
    return items.length;
  } catch {
    return 0;
  }
}

// Try the mutation on the network. If there is no network, store it in the
// outbox so it can be replayed later. Server-side errors (4xx/5xx) are
// returned to the caller, not queued.
export async function queueOrSend(method, url, body) {
  try {
    return await rawRequest(method, url, body);
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    await idbPut("outbox", { method, url, body: body || null, ts: Date.now() });
    return { ok: true, queued: true, offline: true };
  }
}

// Replay queued mutations in FIFO order. Items that fail stay queued and the
// rest are still attempted. Network failures do not throw out of this.
export async function replayOutbox() {
  let items;
  try {
    items = await idbAll("outbox");
  } catch {
    return { attempted: 0, sent: 0, failed: 0 };
  }
  items.sort((a, b) => a.id - b.id);
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await rawRequest(item.method, item.url, item.body === null ? undefined : item.body);
      await idbDelete("outbox", item.id);
      sent++;
    } catch (err) {
      failed++;
      if (!isNetworkFailure(err)) {
        // Keep server-rejected items queued so the merchant can review them.
      }
    }
  }
  return { attempted: items.length, sent, failed };
}

// Cache successful read results in IndexedDB for offline viewing.
const MIRROR_PATHS = [
  { key: "products", url: "/api/products" },
  { key: "customers", url: "/api/customers" },
  { key: "expenses", url: "/api/expenses" },
];

export async function mirrorReads() {
  for (const { key, url } of MIRROR_PATHS) {
    try {
      const data = await rawRequest("GET", url);
      await idbPut("cache", { key, data, ts: Date.now() });
    } catch {
      // Stay silent: stale cache is better than a broken page.
    }
  }
}

// Fetch fresh data, falling back to the cached mirror when offline.
// Returns { data, fromCache }.
export async function cachedGet(key, fallbackFetcher) {
  try {
    const data = await fallbackFetcher();
    return { data, fromCache: false };
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    const row = await idbGet("cache", key).catch(() => null);
    if (row && row.data) return { data: row.data, fromCache: true };
    throw err;
  }
}

let listenersAttached = false;

export function startSyncListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("online", () => {
    replayOutbox();
  });
  // Kick off a replay when the app starts, in case items queued earlier.
  if (navigator.onLine) replayOutbox();
}

// React hook for the sync status UI: { online, pending }.
export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    startSyncListeners();
    let alive = true;
    const refresh = () => pendingCount().then((n) => alive && setPending(n));
    const onOnline = () => {
      setOnline(true);
      replayOutbox().then(() => alive && refresh());
    };
    const onOffline = () => {
      setOnline(false);
      refresh();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, []);

  return { online, pending };
}
