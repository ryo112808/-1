// sw.js  (v8)
// 目的：HTMLは常に最新（network-first）
//      CSS/JS/アイコンなどだけキャッシュ（offline用）

const VERSION = "v8";
const CACHE = `tango-plus-${VERSION}`;

// キャッシュしていいのは “静的ファイルだけ”
const ASSETS = [
  "./",
  "./index.html?v=8",
  "./styles.css?v=8",
  "./app.js?v=8",
  "./manifest.json?v=8",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// HTMLは常に network-first（最新を取りに行く）
// それ以外は cache-first（速さ優先）
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ扱う
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHTML = accept.includes("text/html") || url.pathname.endsWith("/") || url.pathname.endsWith(".html");

  if (isHTML) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: "no-store" });
    const c = await caches.open(CACHE);
    c.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    return cached || new Response("offline", { status: 503 });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  const c = await caches.open(CACHE);
  c.put(req, res.clone());
  return res;
}
