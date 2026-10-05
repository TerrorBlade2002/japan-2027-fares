// App shell is cached for instant/offline start; flight data is always fetched fresh
// (falling back to the last copy when offline).
const CACHE = "japan27-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // network first for everything, so app updates and new data show up immediately
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      const key = url.pathname.endsWith("data.json") ? new Request(url.pathname) : e.request;
      caches.open(CACHE).then(c => c.put(key, copy));
    }
    return res;
  }).catch(() => caches.match(url.pathname.endsWith("data.json") ? new Request(url.pathname) : e.request)));
});
