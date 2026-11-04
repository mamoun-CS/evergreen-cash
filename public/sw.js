// Increment this release identifier whenever a production build changes its static assets.
const CACHE_NAME = "evergreen-cash-2026-11-04-2";
const STATIC_ASSETS = [
  "/",
  "/offline",
  "/transactions",
  "/people",
  "/invoices",
  "/reconcile",
  "/reports",
  "/backup",
  "/settings",
  "/manifest.json",
  "/logo.jpg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/fonts/Cairo-Regular.ttf",
  "/fonts/Cairo-Bold.ttf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Skip chrome-extension or external Google API calls from caching
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc") || req.headers.has("RSC") || [...req.headers.keys()].some((name) => name.toLowerCase().startsWith("next-router-"))) return;

  // Network-first for navigation, fallback to cache for offline-first support
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (url.pathname === "/offline") return (await caches.match("/offline")) || Response.error();
          return new Response(offlineShell(url.pathname), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
        })
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req).then((response) => {
        if (response.ok) void cache.put(req, response.clone());
        return response;
      });
      return cached || network;
    })());
    return;
  }

  // Cache-first for static assets, fonts, images
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== "basic") {
          return res;
        }
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      });
    })
  );
});

function offlineShell(path) {
  const safePath = String(path).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EverGreen CASH — أوفلاين</title><body style="font-family:system-ui;background:#f7f5eb;color:#173c2b;padding:2rem"><main data-requested-path="${safePath}"><h1>تعذر تحميل هذه الصفحة حالياً</h1><p>المسار المطلوب: <b>${safePath}</b></p><p>تحقق من اتصالك ثم أعد المحاولة. بياناتك المحلية محفوظة.</p><button onclick="location.reload()">إعادة المحاولة</button></main></body></html>`;
}
