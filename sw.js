// Service worker: the app opens without a network, and map tiles the person looked at stay on the phone.
//
//   app files      precached on install (PRECACHE below) into a cache named after BUILD, and served cache-first from it, so
//                  one open page never mixes files of two versions. An update is a new worker: tools/stamp-sw.mjs puts a
//                  hash of all the files into BUILD, so any changed file changes this script, the browser installs the new
//                  worker, it fills seoul-shell-<new BUILD> completely, takes over, and deletes the old cache. The open page
//                  is told (js/ui/update-bar.js shows 「新版本好了」, a button reloads it); the new version shows on the next
//                  open anyway. A page can ask which build it runs: {type: 'version'} is answered with BUILD (see the message
//                  listener below; js/sw-version.js). A file that is not listed but sits under the app folder is cached
//                  when first fetched and refreshed in the background (stale-while-revalidate).
//   Leaflet (CDN)  precached; the version is in its URL, so the cached copy is used as is.
//   map-style.json precached with the app files: the style of our own vector map (js/basemap.js).
//   vector map     best effort, OUTSIDE the all-or-nothing precache (a failed download here never fails the install; js/basemap.js falls back
//                  to the picture tiles below whenever the vector map cannot start):
//                    GL_LIBS      MapLibre GL, its stylesheet and the Leaflet bridge (exact versions in the URLs, equal to js/basemap.js):
//                                 cache-first in LIB_CACHE; fetched at the first activate (with their integrity values: only the pinned
//                                 bytes are kept) and kept whenever the page loads them (the page's request carries the integrity).
//                    vector tiles and fonts of tiles.openfreemap.org (only ones the person looked at): cache-first in VTILE_CACHE,
//                                 never revalidated (a tile seen once is shown from the phone for the rest of the trip, so a dead
//                                 connection or a dead server does not thin the map out). A tile is kept under a key WITHOUT its
//                                 planet-build version segment (vectorTileKey), so a new build of the planet does not orphan every kept
//                                 tile. About VTILE_LIMIT entries (trimmed every VTILE_TRIM_EVERY puts, so up to that many more for a
//                                 while), the oldest dropped first.
//                    the TileJSON (/planet, which names the current tile version): network first (TILEJSON_WAIT_MS), the last copy offline
//                                 when the network is slow, or when it answers with an error (429, 5xx). Not stale-first: an old copy may
//                                 name a tile version the server has dropped.
//   web fonts      the Google Fonts stylesheet (fonts.googleapis.com/css2) and its woff2 files (fonts.gstatic.com): cache-first in FONT_CACHE,
//                  about FONT_LIMIT font files (the stylesheet is never trimmed: it is the oldest entry, and the files are of no use without it),
//                  so the display face (Archivo, Noto Sans TC / KR) survives streets without data. They are
//                  loaded without blocking the page (index.html), so a font that was never fetched here simply is not there.
//   map tiles      cache-first, filled only by tiles that were actually displayed (OpenStreetMap forbids bulk pre-fetching),
//                  at most TILE_LIMIT of them, the oldest dropped first. These are the picture fallback's tiles.
//   everything else (the Apps Script API and the googleusercontent.com address it redirects to, any POST, and anything
//                  outside the app folder, such as the mock snapshot of the dev server) is never touched here: no
//                  respondWith, no cache. The data cache is api.js's own (localStorage), and it is what makes the
//                  「離線，資料時間」 banner appear: a cached API answer in here would hide that the phone is offline.
//
// Every URL is relative to this file, so the app works under a sub-path such as /seoul-2611/ (GitHub Pages).
// Adding a file under app/? Add it to PRECACHE too, then run `node tools/stamp-sw.mjs` (after ANY change under app/):
// tests/sw-precache.test.mjs fails while PRECACHE or the BUILD stamp is out of date.
'use strict';

const BUILD = '1b492ec76e'; // written by tools/stamp-sw.mjs: a hash of every precached app file (this file excluded)
const SHELL_CACHE = `seoul-shell-${BUILD}`; // activate removes every other seoul-shell-* cache
const TILE_CACHE = 'seoul-tiles-v1'; // not tied to BUILD: viewed tiles survive an app update
const TILE_LIMIT = 300;
const TILE_HOSTS = ['tile.openstreetmap.org'];
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';

// The vector map (see the header). GL_LIBS must be exactly js/basemap.js LIB_URLS: tests/basemap.test.mjs compares the two.
const LIB_CACHE = 'seoul-libs-v1'; // the versions are in the URLs: never needs to change with BUILD
// url -> subresource integrity of those bytes (the same values as js/basemap.js LIB_INTEGRITY; a test compares). The activate-time download is
// made with it, so a CDN serving other bytes at that moment is not kept for ever by a cache that never asks again; the copies the page's own
// requests leave here were checked by the browser against the integrity the page put on them.
const GL_LIBS = {
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js': 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj',
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css': 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V',
  'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js': 'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS',
};
const VTILE_CACHE = 'seoul-vtiles-v1';
const VTILE_LIMIT = 2000;
const VTILE_TRIM_EVERY = 50; // the cache is trimmed on the first put after the worker starts and then every this many puts (see trimSometimes)
const TILEJSON_WAIT_MS = 3000;
const OPENFREEMAP = 'tiles.openfreemap.org';
const VECTOR_TILE = /^\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/; // /planet/<version>/<z>/<x>/<y>.pbf
const VECTOR_TILE_KEY = /^\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/; // the same, with the part after the version captured
const VECTOR_FONT = /^\/fonts\/[^/]+\/\d+-\d+\.pbf$/; // /fonts/<font name>/<first>-<last>.pbf

// The web fonts of index.html (Google Fonts): the stylesheet and the font files it names.
const FONT_CACHE = 'seoul-fonts-v1';
const FONT_LIMIT = 200; // the stylesheet has ~680 slices, a page loads only the few it needs; a trip day touches a few dozen
const FONT_CSS_HOST = 'fonts.googleapis.com';
const FONT_FILE_HOST = 'fonts.gstatic.com';

const PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'map-style.json',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/add-place-logic.js',
  'js/api.js',
  'js/area-lobes.js',
  'js/back-stack.js',
  'js/basemap.js',
  'js/categories.js',
  'js/colors.js',
  'js/config.js',
  'js/done.js',
  'js/fallback-guard.js',
  'js/fields.js',
  'js/first-view.js',
  'js/follow.js',
  'js/geo.js',
  'js/ginkgo.js',
  'js/heading.js',
  'js/hotel-view.js',
  'js/hours.js',
  'js/i18n.js',
  'js/july-layer.js',
  'js/links.js',
  'js/main.js',
  'js/match.js',
  'js/next-stop.js',
  'js/packing-ticks.js',
  'js/packing.js',
  'js/people.js',
  'js/phrases.js',
  'js/pin-labels.js',
  'js/place-input.js',
  'js/place-view.js',
  'js/plan-names.js',
  'js/register-sw.js',
  'js/sheet-parse.js',
  'js/shopping.js',
  'js/stars.js',
  'js/stations.js',
  'js/sw-version.js',
  'js/sync.js',
  'js/today-view.js',
  'js/today.js',
  'js/ui/add-place.js',
  'js/ui/basemap-layer.js',
  'js/ui/card.js',
  'js/ui/dom.js',
  'js/ui/hotel-card.js',
  'js/ui/lists.js',
  'js/ui/lobe-layer.js',
  'js/ui/map.js',
  'js/ui/me-layer.js',
  'js/ui/nextbar.js',
  'js/ui/packing.js',
  'js/ui/panel.js',
  'js/ui/person.js',
  'js/ui/phrase-cards.js',
  'js/ui/preview-pin.js',
  'js/ui/setup.js',
  'js/ui/shopping.js',
  'js/ui/station-badges.js',
  'js/ui/tabbar.js',
  'js/ui/today-panel.js',
  'js/ui/unmapped.js',
  'js/ui/update-bar.js',
  `${LEAFLET}leaflet.min.css`,
  `${LEAFLET}leaflet.min.js`,
];

const ROOT = new URL('./', self.location.href); // the app folder, with its trailing slash
const INDEX_URL = new URL('index.html', ROOT).href;
const PRECACHE_URLS = PRECACHE.map((p) => new URL(p, ROOT).href);
const PRECACHED = new Set(PRECACHE_URLS);

/** 'tile' | 'lib' | 'vtile' | 'tilejson' | 'font' | 'shell' | 'pass' for one request. 'pass' means: leave it to the network, untouched. */
function routeOf(rawUrl, method = 'GET') {
  if (method !== 'GET') return 'pass';
  let u;
  try { u = new URL(rawUrl); } catch { return 'pass'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'pass';
  if (TILE_HOSTS.includes(u.hostname)) return 'tile';
  if (Object.hasOwn(GL_LIBS, u.origin + u.pathname + u.search)) return 'lib'; // exactly these pinned files, never another version
  if (u.protocol === 'https:' && u.hostname === OPENFREEMAP) {
    if (u.pathname === '/planet' && u.search === '') return 'tilejson';
    if (VECTOR_TILE.test(u.pathname) || VECTOR_FONT.test(u.pathname)) return 'vtile';
  }
  if (u.protocol === 'https:' && u.hostname === FONT_CSS_HOST && u.pathname === '/css2' && u.search.startsWith('?family=')) return 'font'; // the stylesheet of index.html
  if (u.protocol === 'https:' && u.hostname === FONT_FILE_HOST && /^\/s\/[^/]+\/[^/]+\/[^/]+\.woff2$/.test(u.pathname)) return 'font'; // its font files
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

/**
 * Keep the newest `limit` entries of a cache (Cache.keys() lists them oldest first). One run at a time. An entry `spare(request)` says
 * yes to is never deleted and is not counted against the limit.
 */
function trimCache(cache, limit, spare = () => false) {
  trimming = trimming.then(async () => {
    const keys = (await cache.keys()).filter((key) => !spare(key));
    for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
  }).catch(() => {});
  return trimming;
}

const putsSinceTrim = new Map(); // cache name -> puts since its last trim (lives as long as the worker does)

/**
 * trimCache() for a cache that is big (the vector tiles: up to 2000 entries, and Cache.keys() lists them all): not after every put but on
 * the first put after the worker starts (a worker that is stopped and started again between map views still trims) and then once per
 * `every` puts. So the cache may hold up to `every - 1` entries more than `limit` for a while, never more.
 */
function trimSometimes(name, cache, limit, every = VTILE_TRIM_EVERY, spare = undefined) {
  const n = (putsSinceTrim.get(name) ?? every) + 1; // not seen yet: due now
  if (n < every) { putsSinceTrim.set(name, n); return Promise.resolve(); }
  putsSinceTrim.set(name, 0);
  return trimCache(cache, limit, spare);
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

// ---- the vector map: libraries, tiles, fonts, TileJSON (best effort; see the header) -----------------------------------

// Always asked for with CORS and kept as a real response: the page loads the libraries with integrity="..." and crossorigin, which
// needs it, and an opaque copy could not be handed to such a request.
const cors = (req) => new Request(req, { mode: 'cors', credentials: 'omit' });

async function libResponse(event) {
  const req = event.request;
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(cors(req));
  if (res.ok) event.waitUntil(cache.put(req.url, res.clone()));
  return res;
}

/** Fetch every pinned library that is not kept yet. Never throws: a failure only means the next page load asks again. */
async function prefetchLibs() {
  const cache = await caches.open(LIB_CACHE);
  await Promise.all(Object.entries(GL_LIBS).map(async ([url, integrity]) => {
    try {
      if (await cache.match(url)) return;
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', integrity }); // other bytes than the pinned ones: the fetch fails, nothing is kept
      if (res.ok) await cache.put(url, res);
    } catch { /* offline now: it is tried again later */ }
  }));
}

/**
 * The key a vector tile is kept under: its address without the planet-build version segment (/planet/<version>/<z>/<x>/<y>.pbf ->
 * /planet/<z>/<x>/<y>.pbf), so a tile seen under one build is found again under the next. Anything else (fonts, the TileJSON, another
 * host, text that is no address) is its own key.
 */
function vectorTileKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'https:' && u.hostname === OPENFREEMAP) {
      const m = VECTOR_TILE_KEY.exec(u.pathname);
      if (m) return `${u.origin}/planet/${m[1]}`;
    }
  } catch { /* not an address: keep it as it is */ }
  return rawUrl;
}

/** Cache-first, never revalidated: what was seen before is shown at once (offline too), whatever the network or the server is doing. */
async function vectorTileResponse(event) {
  const req = event.request;
  const key = vectorTileKey(req.url);
  const cache = await caches.open(VTILE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(cors(req));
  if (res.ok) event.waitUntil(cache.put(key, res.clone()).then(() => trimSometimes(VTILE_CACHE, cache, VTILE_LIMIT)).catch(() => {}));
  return res;
}

/** The stylesheet is the first font entry of a page and so the oldest of the cache, but without it the woff2 files are of no use: a trim never takes it. */
const isFontStylesheet = (key) => { try { return new URL(key.url ?? key).hostname === FONT_CSS_HOST; } catch { return false; } };

/** The Google Fonts stylesheet and font files: cache-first in FONT_CACHE (the files have versions in their addresses and never change). */
async function fontResponse(event) {
  const req = event.request;
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(cors(req)); // CORS, so a real (not opaque) copy is kept: the stylesheet is allowed to be read that way, the font files are asked for that way
  if (res.ok) event.waitUntil(cache.put(req.url, res.clone()).then(() => trimSometimes(FONT_CACHE, cache, FONT_LIMIT, VTILE_TRIM_EVERY, isFontStylesheet)).catch(() => {}));
  return res;
}

/** Network first for the TileJSON (it names the current tile version), the last copy when offline or when the network takes too long. */
async function tileJsonResponse(event) {
  const req = event.request;
  const cache = await caches.open(VTILE_CACHE);
  const net = fetch(cors(req)).then(async (res) => {
    if (res.ok) await cache.put(req.url, res.clone()).catch(() => {});
    return res;
  });
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), TILEJSON_WAIT_MS); });
  let answer = null; // what the network said in time (null: too slow, or it failed)
  try {
    answer = await Promise.race([net, slow]);
    if (answer && answer.ok) return answer;
  } catch { /* offline or refused: the last copy below */ } finally {
    clearTimeout(timer);
  }
  // Too slow, failed, or answered 429 / 5xx: the last good copy is better than an error page for the map's own description.
  const hit = await cache.match(req.url);
  if (hit) { net.catch(() => {}); return hit; } // a slow answer still refreshes the copy when it arrives
  return answer ?? net; // nothing kept: the error answer as it came, or wait for the network, or fail like any other request
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
      if (name.startsWith('seoul-') && ![SHELL_CACHE, TILE_CACHE, LIB_CACHE, VTILE_CACHE, FONT_CACHE].includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
    prefetchLibs(); // not awaited: activation never waits for 800 KB of optional files (prefetchLibs never rejects)
  })());
});

// A page asks which build it runs ({type: 'version'}, js/sw-version.js); the answer goes to the private port the page sent along, else to the page.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'version') return;
  const answer = { type: 'version', build: BUILD };
  const port = event.ports?.[0];
  if (port) port.postMessage(answer);
  else event.source?.postMessage(answer);
});

self.addEventListener('fetch', (event) => {
  const route = routeOf(event.request.url, event.request.method);
  if (route === 'tile') event.respondWith(tileResponse(event));
  else if (route === 'shell') event.respondWith(shellResponse(event));
  else if (route === 'lib') event.respondWith(libResponse(event));
  else if (route === 'vtile') event.respondWith(vectorTileResponse(event));
  else if (route === 'tilejson') event.respondWith(tileJsonResponse(event));
  else if (route === 'font') event.respondWith(fontResponse(event));
});
