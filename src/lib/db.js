// Tiny promise-wrapped IndexedDB helper for KopaBook offline storage.
// No external dependencies. Database "kopabook", version 1.

const DB_NAME = "kopabook";
const DB_VERSION = 1;
const STORES = ["cache", "outbox", "meta"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = work(s);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function idbGet(store, key) {
  if (!STORES.includes(store)) return Promise.reject(new Error("Unknown store: " + store));
  return tx(store, "readonly", (s) => s.get(key)).then((row) => row || null);
}

export function idbPut(store, val) {
  if (!STORES.includes(store)) return Promise.reject(new Error("Unknown store: " + store));
  return tx(store, "readwrite", (s) => s.put(val));
}

export function idbAll(store) {
  if (!STORES.includes(store)) return Promise.reject(new Error("Unknown store: " + store));
  return tx(store, "readonly", (s) => s.getAll()).then((rows) => rows || []);
}

export function idbDelete(store, key) {
  if (!STORES.includes(store)) return Promise.reject(new Error("Unknown store: " + store));
  return tx(store, "readwrite", (s) => s.delete(key));
}

export function idbClear(store) {
  if (!STORES.includes(store)) return Promise.reject(new Error("Unknown store: " + store));
  return tx(store, "readwrite", (s) => s.clear());
}
