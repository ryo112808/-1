const CACHE = "tango_plus_v2_cache_1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 最低限だけプリキャッシュ（壊れた固定を避けるため少なめ）
    await cache.addAll(["./", "./index.html", "./styles.css", "./app.js"]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// 更新優先：HTML/JS/CSSは常にネット優先、失敗した時だけキャッシュ
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GitHub Pages内だけ
  if (url.origin !== location.origin) return;

  const isCore =
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css");

  if (isCore) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response("offline", { status: 200 });
      }
    })());
    return;
  }

  // 画像などはキャッシュ優先でOK
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
