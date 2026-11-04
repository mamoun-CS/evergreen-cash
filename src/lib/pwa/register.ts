export function registerServiceWorker(hooks: { onWaiting: (worker: ServiceWorker) => void }): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") {
    void removeDevelopmentServiceWorker();
    return;
  }
  const register = () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting) hooks.onWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            hooks.onWaiting(worker);
          }
        });
      });
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

async function removeDevelopmentServiceWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some((worker) => {
        if (!worker) return false;
        return new URL(worker.scriptURL).pathname === "/sw.js";
      }),
    );
    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("evergreen-cash-")).map((key) => caches.delete(key)));
    }

    const reloadKey = "egc:dev-service-worker-cleared";
    if (appRegistrations.length && navigator.serviceWorker.controller && sessionStorage.getItem(reloadKey) !== "1") {
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    }
  } catch (error) {
    console.warn("تعذر تنظيف Service Worker في بيئة التطوير:", error);
  }
}
