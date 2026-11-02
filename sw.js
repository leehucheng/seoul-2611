// Service worker: the app opens without a network, and map tiles the person looked at stay on the phone.
//
//   app files      precached on install (PRECACHE below) into a cache named after BUILD, and served cache-first from it, so
//                  one open page never mixes files of two versions. An update is a new worker: tools/stamp-sw.mjs puts a
//                  hash of all the files into BUILD, so any changed file changes this script, the browser installs the new
//                  worker, it fills seoul-shell-<new BUILD> completely, takes over, and deletes the old cache. The new
//                  version shows on the next open. A file that is not listed but sits under the app folder is cached
//                  when first fetched and refreshed in the background (stale-while-revalidate).
//   Leaflet (CDN)  precached; the version is in its URL, so the cached copy is used as is.
//   map tiles      cache-first, filled only by tiles that were actually displayed (OpenStreetMap forbids bulk pre-fetching),
//                  at most TILE_LIMIT of them, the oldest dropped first.
//   everything else (the Apps Script API and the googleusercontent.com address it redirects to, any POST, and anything
//                  outside the app folder, such as the mock snapshot of the dev server) is never touched here: no
//                  respondWith, no cache. The data cache is api.js's own (localStorage), and it is what makes the
//                  「離線，資料時間」 banner appear: a cached API answer in here would hide that the phone is offline.
//
// Every URL is relative to this file, so the app works under a sub-path such as /seoul-2611/ (GitHub Pages).
// Adding a file under app/? Add it to PRECACHE too, then run `node tools/stamp-sw.mjs` (after ANY change under app/):
// tests/sw-precache.test.mjs fails while PRECACHE or the BUILD stamp is out of date.
'use strict';

const BUILD = 'bd589ed186'; // written by tools/stamp-sw.mjs: a hash of every precached app file (this file excluded)
const SHELL_CACHE = `seoul-shell-${BUILD}`; // activate removes every other seoul-shell-* cache
const TILE_CACHE = 'seoul-tiles-v1'; // not tied to BUILD: viewed tiles survive an app update
const TILE_LIMIT = 300;
const TILE_HOSTS = ['tile.openstreetmap.org'];
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';

const PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/add-place-logic.js',
  'js/api.js',
  'js/back-stack.js',
  'js/categories.js',
  'js/config.js',
  'js/fallback-guard.js',
  'js/fields.js',
  'js/geo.js',
  'js/hotel-view.js',
  'js/hours.js',
  'js/i18n.js',
  'js/links.js',
  'js/main.js',
  'js/match.js',
  'js/people.js',
  'js/place-input.js',
  'js/place-view.js',
  'js/plan-names.js',
  'js/register-sw.js',
  'js/sheet-parse.js',
  'js/stars.js',
  'js/sync.js',
  'js/today-view.js',
  'js/today.js',
  'js/ui/add-place.js',
  'js/ui/card.js',
  'js/ui/dom.js',
  'js/ui/hotel-card.js',
  'js/ui/map.js',
  'js/ui/menu.js',
  'js/ui/panel.js',
  'js/ui/person.js',
  'js/ui/preview-pin.js',
  'js/ui/setup.js',
  'js/ui/today-panel.js',
  'js/ui/unmapped.js',
  `${LEAFLET}leaflet.min.css`,
  `${LEAFLET}leaflet.min.js`,
];

const ROOT = new URL('./', self.location.href); // the app folder, with its trailing slash
const INDEX_URL = new URL('index.html', ROOT).href;
const PRECACHE_URLS = PRECACHE.map((p) => new URL(p, ROOT).href);
const PRECACHED = new Set(PRECACHE_URLS);

/** 'tile' | 'shell' | 'pass' for one request. 'pass' means: leave it to the network, untouched. */
function routeOf(rawUrl, method = 'GET') {
  if (method !== 'GET') return 'pass';
  let u;
  try { u = new URL(rawUrl); } catch { return 'pass'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'pass';
  if (TILE_HOSTS.includes(u.hostname)) return 'tile';
  if (PRECACHED.has(u.origin + u.pathname + u.search)) return 'shell';
  if (u.origin === ROOT.origin && u.pathname.startsWith(ROOT.pathname)) return 'shell';
  return 'pass';
}

// ---- app shell --------------------------------------------------------------------------------------------

async function shellResponse(event) {
  const req = event.request;
  const url = req.mode === 'navigate' ? INDEX_URL : req.url; // every address of the page (a share-target query included) is the same index.html
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(url);

  if (PRECACHED.has(url)) {
    // Cache-first, no refresh: the cache holds one complete build (see the header). Leaflet is here too (versioned URL).
    if (cached) return cached;
    const res = await fetch(url); // not there (the browser may evict storage): ask the network and keep the answer
    if (res.ok && !res.redirected) event.waitUntil(cache.put(url, res.clone()));
    return res;
  }

  const refresh = fetch(url, { cache: 'no-cache' }).then(async (res) => { // no-cache: revalidate with the server, not the browser's HTTP cache
    if (res.ok && !res.redirected) await cache.put(url, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {})); // offline: the cached copy was already returned
    return cached;
  }
  return refresh;
}

// ---- map tiles --------------------------------------------------------------------------------------------

let trimming = Promise.resolve();

/** Keep the newest `limit` entries of a cache (Cache.keys() lists them oldest first). One run at a time. */
function trimCache(cache, limit) {
  trimming = trimming.then(async () => {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
  }).catch(() => {});
  return trimming;
}

async function tileResponse(event) {
  const req = event.request;
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res;
  try {
    // An <img> asks without CORS and gets an opaque answer: it cannot be checked, and Chrome counts each one as about 7 MB
    // of storage. The tile server allows CORS, so ask that way and store a real, small response.
    res = await fetch(new Request(req, { mode: 'cors', credentials: 'omit' }));
  } catch {
    try { return await fetch(req); } catch { return Response.error(); } // CORS refused or offline: show it if the network has it, keep nothing
  }
  if (res.ok) event.waitUntil(cache.put(req.url, res.clone()).then(() => trimCache(cache, TILE_LIMIT)));
  return res;
}

// ---- lifecycle --------------------------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // all or nothing: a half-filled shell would break offline worse than no worker (the browser retries on the next visit)
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      const res = await fetch(url, { cache: 'reload' }); // past the browser's HTTP cache, so the new version is really new
      if (!res.ok) throw new Error(`precache ${res.status} ${url}`);
      await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('seoul-') && name !== SHELL_CACHE && name !== TILE_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const route = routeOf(event.request.url, event.request.method);
  if (route === 'tile') event.respondWith(tileResponse(event));
  else if (route === 'shell') event.respondWith(shellResponse(event));
});
