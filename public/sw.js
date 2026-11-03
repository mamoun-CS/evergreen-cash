const CACHE_NAME = "evergreen-cash-v1";
const STATIC_ASSETS = [
  "/",
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
  if (!url.origin.includes(self.location.origin)) {
    return;
  }

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
          const fallback = await caches.match("/");
          return fallback || Response.error();
        })
    );
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
