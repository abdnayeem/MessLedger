// MessLedger service worker
// Bump CACHE_VERSION whenever any precached file below changes, so old
// clients pick up the new files instead of serving stale cached copies.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `messledger-${CACHE_VERSION}`;

// Core app-shell files needed to load the app. Keep this list in sync with
// the <script>/<link> tags in index.html.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/firebase-config.js',
  './js/storage.js',
  './js/app/bundle.js',
  './js/responsive-tables.js',
  './favicon.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('messledger-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Lets the page force an already-waiting service worker to activate
// immediately (used for an "update available, refresh?" prompt if one is
// ever added to the UI).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests. Everything else (Firestore/Auth
  // calls to googleapis.com, Google Fonts, Font Awesome CDN, etc.) goes
  // straight to the network untouched — this app's live data must never
  // be served from cache.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Page navigations: try the network first (so users always get the
  // latest index.html when online), falling back to the cached shell
  // when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets (css/js/images/manifest): stale-while-revalidate — serve
  // the cached copy instantly if there is one, while quietly fetching a
  // fresh copy in the background for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});