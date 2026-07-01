// Service worker: minimal offline shell + Web Push handler.
// iOS requires the PWA be installed to the Home Screen for push to work, and a
// notification must be shown for every push (no silent pushes).
const SHELL = "dobby-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/index.html"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first for navigation so live state is fresh; fall back to cached shell.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  }
});

self.addEventListener("push", (e) => {
  const data = (() => { try { return e.data.json(); } catch { return { title: "dobby", body: e.data?.text() ?? "" }; } })();
  e.waitUntil(
    self.registration.showNotification(data.title ?? "dobby", {
      body: data.body ?? "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Tiered delivery: critical alerts stay on screen; info arrives quietly.
      requireInteraction: data.tier === "critical",
      silent: data.tier === "info",
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow("/"));
});
