/* KopaBook service worker: offline-first app shell, network-first API reads.
   Non-GET API calls are never intercepted so queued mutations flow through. */

// Bump this version on shell-affecting releases: the activate handler
// deletes every other cache, so installed apps drop the old shell and
// pick up the current bundle (v7: PIN app lock gate restored in the
// shell, with the owner's own re-lock timer; navigation is now
// stale-while-revalidate so a repeat cold open paints from the cached
// shell at once instead of waiting on the network first).
const SHELL_CACHE = "kopabook-shell-v7";
const API_CACHE = "kopabook-api-v1";
const API_MAX_ENTRIES = 50;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Speed (2026-11-06): founder.jpg is marketing-only (the About
      // story), not shell, so it no longer rides the install precache;
      // it still loads normally from the network when that page opens.
      // logo.png stays: it is the sidebar brand on every app screen.
      .then((cache) => cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/logo.png", "/icon-maskable-512.png"]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/");
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

// Navigation requests (page loads and deep links like /app/*, /login, /pricing):
// serve the cached shell at once when there is one, and refresh it in
// the background, so a repeat cold open paints immediately instead of
// waiting a full network round trip first. With no cached shell yet,
// fall back to the network, then the cached shell, then the offline
// message. The background refresh never delays the paint; waitUntil
// keeps the worker alive long enough to finish writing it.
async function navigationHandler(request, event) {
  const shell = await caches.match("/index.html", { cacheName: SHELL_CACHE });
  const networkUpdate = fetch(request)
    .then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put("/index.html", res.clone());
      }
      return res;
    })
    .catch(() => null);
  if (shell) {
    if (event && event.waitUntil) event.waitUntil(networkUpdate);
    return shell;
  }
  const res = await networkUpdate;
  if (res && res.ok) return res;
  return new Response("You are offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone());
      const keys = await cache.keys();
      if (keys.length > API_MAX_ENTRIES) {
        await cache.delete(keys[0]);
      }
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ ok: false, message: "You are offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET API calls: let mutations hit the network directly.
  if (url.pathname.startsWith("/api/") && request.method !== "GET") return;

  if (request.method === "GET" && url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.method === "GET" && request.mode === "navigate") {
    event.respondWith(navigationHandler(request, event));
    return;
  }

  if (request.method === "GET" && isAppShell(url)) {
    event.respondWith(cacheFirst(request));
  }
});
