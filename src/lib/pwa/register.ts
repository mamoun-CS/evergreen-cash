export function registerServiceWorker(hooks: { onWaiting: (worker: ServiceWorker) => void }): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
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
  });
}
