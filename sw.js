const BASE_URL = new URL('./', self.location.href);
const CACHE_PREFIX = `bubble-pop-${encodeURIComponent(BASE_URL.pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const PAGE_URL = new URL('./index.html', BASE_URL).href;
const ASSET_PATHS = ['./', './index.html', './styles.css', './game.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const ASSETS = ASSET_PATHS.map(path => new URL(path, BASE_URL).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)))), self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    // Prefer the newest page online and use the cached project page offline.
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(PAGE_URL, copy)));
      }
      return response;
    }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(PAGE_URL)).then(response => response || Response.error())));
  } else {
    event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(event.request, { ignoreSearch: true })).then(hit => hit || fetch(event.request)));
  }
});
