/* KopaBook service worker: offline-first app shell, network-first API reads.
   Non-GET API calls are never intercepted so queued mutations flow through. */

// Bump this version on shell-affecting releases: the activate handler
// deletes every other cache, so installed apps drop the old shell and
// pick up the current bundle (v7: PIN app lock gate restored in the
// shell, with the owner's own re-lock timer; navigation is now
// stale-while-revalidate so a repeat cold open paints from the cached
// shell at once instead of waiting on the network first. v8: Android
// install pop-up ships in the main bundle. v9: /index.html drops out of
// the precache and out of the navigation shell key. Cloudflare Pages
// 308s /index.html to / (Pages normalises it to the canonical /), so
// cache.addAll stored the redirect-followed 200 under the /index.html
// key with redirected=true, and navigationHandler then served that
// redirected response for every navigation. Safari rejects a
// service-worker-served navigation response that went through a
// redirect ("Response served by service worker has redirections"), which
// is the error Fortune saw on his phone. The shell key is now "/"
// (200 clean, no redirect), and no handler ever caches or serves a
// redirected response again.)
const SHELL_CACHE = "kopabook-shell-v9";
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
      // v9: /index.html is NOT precached. Pages 308s it to /, so addAll
      // would store a redirect-followed response under that key. "/"
      // is the canonical shell URL and returns 200 clean.
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/logo.png", "/icon-maskable-512.png"]))
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
      // Self-heal: drop any stored response that went through a
      // redirect, so a poisoned entry can never be served again, with
      // or without a version bump.
      .then(() => sweepRedirectedEntries())
      .then(() => self.clients.claim())
  );
});

// Delete every cached entry whose stored response went through a
// redirect (Response.redirected). Only the two current caches are
// scanned; older cache names are already deleted above.
async function sweepRedirectedEntries() {
  for (const name of [SHELL_CACHE, API_CACHE]) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (const key of keys) {
      const res = await cache.match(key);
      if (res && res.redirected) await cache.delete(key);
    }
  }
}

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/assets/");
}

// Re-fetch the final URL of a redirect-followed response once and return
// the clean copy (redirected false), or null when no clean copy could be
// had. Used so no handler ever caches or serves a redirected response.
async function refetchClean(res) {
  try {
    const clean = await fetch(res.url);
    if (clean && clean.ok && !clean.redirected) return clean;
    return null;
  } catch (err) {
    return null;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    if (!res.redirected) {
      cache.put(request, res.clone());
      return res;
    }
    // Redirected shell asset (e.g. /index.html 308s to /): cache the
    // clean re-fetch of the final URL under the requested key, and serve
    // the clean copy too, never the redirected one.
    const clean = await refetchClean(res);
    if (clean) {
      cache.put(request, clean.clone());
      return clean;
    }
    return res;
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
  let shell = await caches.match("/", { cacheName: SHELL_CACHE });
  if (shell && shell.redirected) {
    // Poisoned entry (stored when a shell URL 308'd): delete it and
    // treat it as no shell, so the network is used and a clean copy cached.
    const cache = await caches.open(SHELL_CACHE);
    await cache.delete("/");
    shell = null;
  }
  const networkUpdate = fetch(request)
    .then((res) => refreshShellFromNetwork(res))
    .catch(() => null);
  if (shell) {
    if (event && event.waitUntil) event.waitUntil(networkUpdate);
    return shell;
  }
  const res = await networkUpdate;
  if (res && res.ok && !res.redirected) return res;
  return new Response("You are offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

// Cache a clean copy of a navigation response under "/" and return the
// response to serve. A response that went through a redirect is never
// cached and never served: Safari rejects a service-worker-served
// navigation response that went through a redirect. Re-fetch the final
// URL once and cache that clean copy instead; return null when no clean
// copy could be had, so the caller falls through to the offline message.
async function refreshShellFromNetwork(res) {
  if (!res || !res.ok) return res;
  if (!res.redirected) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/", res.clone());
    return res;
  }
  const clean = await refetchClean(res);
  if (clean) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/", clean.clone());
    return clean;
  }
  return null;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && !res.redirected) {
      cache.put(request, res.clone());
      const keys = await cache.keys();
      if (keys.length > API_MAX_ENTRIES) {
        await cache.delete(keys[0]);
      }
    }
    // A redirected API response is returned to the caller as-is (the
    // data is identical) but is never cached: a redirect-followed copy
    // must not sit in the cache waiting to be served later.
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
