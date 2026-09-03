// MessLedger service worker
// Bump CACHE_VERSION whenever any precached file below changes, so old
// clients pick up the new files instead of serving stale cached copies.
const CACHE_VERSION = 'v13';
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

// Cross-origin resources loaded in index.html that also need to work
// offline — separate from PRECACHE_URLS above since cross-origin caching
// needs different handling (see the install/fetch handlers below).
//   - Firebase SDK: without it cached, opening the app fully offline hit a
//     "Cannot access 'authReady' before initialization" crash (see the
//     BUGFIX comment in firebase-config.js) — the whole SDK, and so
//     firebase-config.js's own setup code, had nowhere to load from.
//   - Font Awesome: without ITS files cached, every icon in the app quietly
//     disappears offline (the tab icons, buttons, everywhere .fa-* is
//     used) — the CSS/webfont files simply had nowhere to load from
//     either, same root cause as the Firebase issue above, just a
//     visual/UX bug instead of a crash. Only the two icon styles actually
//     used in this app are listed (see the fa-solid-900 = "fas" class and
//     fa-regular-400 = "far" class usage throughout js/app/*.js) — this
//     app has no "fab" (brands) icons, so that font isn't cached.
// All of these URLs are version-pinned (Firebase's URL has the SDK version
// in the path; Font Awesome's likewise), so caching them long-term is
// safe — a version bump in index.html naturally becomes a new URL, which
// this cache simply doesn't have yet and fetches fresh.
const CROSS_ORIGIN_CACHE_URLS = [
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // BUGFIX: a plain fetch (which is what addAll(PRECACHE_URLS) does
      // internally for an array of URL strings) honors the HTTP
      // Cache-Control headers Firebase Hosting sends for these files
      // (firebase.json sets `max-age=3600` on css/js/png/etc). That means
      // install could silently pull a STALE copy straight from the
      // browser's own HTTP cache instead of the real, current file on the
      // server — and then bake that stale copy into this SW version's
      // Cache Storage, where it would then get served on every normal
      // load. Building each precache request with `cache: 'reload'`
      // forces a genuine network fetch, bypassing HTTP cache entirely, so
      // installs are always seeded from the real current files.
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
        // Cross-origin requests need mode:'no-cors' — without it, addAll()
        // would reject the whole install if the response doesn't include
        // CORS headers. The response this returns is "opaque" (we can't
        // read its contents from JS), but the browser can still cache it
        // and serve it back to satisfy a real <script src>/<link> load
        // later, which is all this needs to do.
        .then(() => Promise.all(
          CROSS_ORIGIN_CACHE_URLS.map((url) =>
            fetch(url, { mode: 'no-cors' })
              .then((res) => cache.put(url, res))
              .catch((err) => console.warn('Could not precache (will just be fetched live instead):', url, err))
          )
        )))
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

  // Cross-origin resources we deliberately cache (see CROSS_ORIGIN_CACHE_URLS
  // above): cache-first, since every URL in that list is version-pinned so
  // a cached copy is never stale. This has to be checked BEFORE the
  // same-origin-only check below, since these are the deliberate exception
  // to "cross-origin always goes straight to network" — everything else
  // cross-origin (Firestore/Auth API calls, Google Fonts) still bypasses
  // the cache entirely, unchanged.
  if (req.method === 'GET' && CROSS_ORIGIN_CACHE_URLS.includes(req.url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req, { mode: 'no-cors' }))
    );
    return;
  }

  // Only handle same-origin GET requests. Everything else (Firestore/Auth
  // calls to googleapis.com, Google Fonts, etc.) goes straight to the
  // network untouched — this app's live data must never be served from
  // cache.
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
  //
  // BUGFIX 1: the background "fetch a fresh copy" step below is NOT part of
  // the value handed to respondWith() when a cached copy already exists
  // (respondWith() resolves immediately with `cached`). Once a fetch event
  // is considered "handled", the browser is free to kill this service
  // worker at any moment — so without event.waitUntil() keeping it alive,
  // that background update routinely got cut off before cache.put() ran.
  // Wrapping the revalidation in event.waitUntil() lets it actually
  // finish, so the cache genuinely catches up after one normal load
  // instead of staying stuck forever.
  //
  // BUGFIX 2: even with BUGFIX 1 in place, a PLAIN fetch(req) still honors
  // ordinary HTTP caching — and Firebase Hosting sends `max-age=3600` on
  // these files (see firebase.json). So the "revalidate" fetch could
  // itself be silently served from the browser's own HTTP cache instead
  // of the real network, and re-save that same stale bytes right back
  // into this SW's Cache Storage — a no-op "update" that looks identical
  // to the icon never refreshing. This is why the bug came back
  // intermittently: it self-heals roughly an hour after each deploy, once
  // that HTTP cache entry expires on its own, and a hard reload always
  // "fixes" it because a hard reload bypasses both the service worker AND
  // the HTTP cache for that load. Passing `cache: 'reload'` forces this
  // fetch to hit the real network every time, closing that gap entirely.
  event.respondWith(
    caches.match(req).then((cached) => {
      const revalidate = fetch(req, { cache: 'reload' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      event.waitUntil(revalidate.catch(() => {}));
      return cached || revalidate;
    })
  );
});