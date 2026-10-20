/* KopaBook service worker: offline-first app shell, network-first API reads.
   Non-GET API calls are never intercepted so queued mutations flow through. */

// Bump this version on shell-affecting releases: the activate handler
// deletes every other cache, so installed apps drop the old shell and
// pick up the current bundle (v5: Projects in every business's menu).
const SHELL_CACHE = "kopabook-shell-v5";
const API_CACHE = "kopabook-api-v1";
const API_MAX_ENTRIES = 50;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/logo.png", "/founder.jpg", "/icon-maskable-512.png"]))
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
// try the network first for freshness, but fall back to the cached /index.html
// so offline refreshes never show the browser error page.
async function navigationHandler(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) return res;
  } catch (err) { /* offline: serve the cached shell below */ }
  const shell = await caches.match("/index.html", { cacheName: SHELL_CACHE });
  if (shell) return shell;
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
    event.respondWith(navigationHandler(request));
    return;
  }

  if (request.method === "GET" && isAppShell(url)) {
    event.respondWith(cacheFirst(request));
  }
});
