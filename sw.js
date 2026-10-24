const BASE_URL = new URL('./', self.location.href);
const CACHE_PREFIX = `bubble-pop-${encodeURIComponent(BASE_URL.pathname)}-`;
// Change this release suffix whenever the worker or any precached file changes.
const CACHE_NAME = `${CACHE_PREFIX}v11`;
const PAGE_URL = new URL('./index.html', BASE_URL).href;
const ASSET_PATHS = ['./', './index.html', './styles.css', './game.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const ASSETS = ASSET_PATHS.map(path => new URL(path, BASE_URL).href);
self.addEventListener('install', event => {
  // Fetch fresh assets for a new release instead of copying the browser's old HTTP cache.
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
      const staged = await Promise.all(ASSETS.map(url => cache.match(url)));
      if (staged.some(response => !response)) throw new Error('Bubble Pop release cache is incomplete.');
      await self.skipWaiting();
    } catch (error) {
      // The versioned candidate is separate from the active release. Discard it on failure.
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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

