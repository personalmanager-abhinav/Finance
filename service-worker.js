/* Paisa service worker — offline app-shell caching.
   Bump CACHE_VERSION whenever any cached asset changes to force update. */
const CACHE_VERSION = 'paisa-v12';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/format.js',
  './js/crypto.js',
  './js/gist.js',
  './js/store.js',
  './js/charts.js',
  './js/insights.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// Install: pre-cache the app shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: drop old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//  - Never cache GitHub API calls (always network so data stays fresh).
//  - App shell + CDN: cache-first, fall back to network, then cache the network copy.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname === 'api.github.com') return; // let the app handle it over network

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          // Only cache same-origin or known CDN GETs that succeed.
          const cacheableHosts = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
          if (resp && resp.status === 200 && (url.origin === self.location.origin || cacheableHosts.includes(url.hostname))) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});
