const CACHE = "homehub-v1";
const CORE_ASSETS = ["/", "/styles.css", "/app.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero para la API, caché primero para el resto (para que la app cargue offline)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // no cachear llamadas a la API

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
