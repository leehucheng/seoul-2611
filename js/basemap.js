// Which base map the app draws, and how it gets there. No DOM at import time; everything the browser provides comes in as an argument.
//
//   vector  our own map: MapLibre GL draws OpenFreeMap vector tiles with app/map-style.json (cream paper, white streets, no road names),
//           inside Leaflet through @maplibre/maplibre-gl-leaflet. Leaflet keeps the pins, the names, the lobes and every tap.
//   raster  the fallback: OpenStreetMap's picture tiles, turned into quiet paper with a CSS filter (css/app.css, "G2α").
//
// The vector map is used when the phone has WebGL and the two libraries arrive within 6 s; it is given up (once, for good) on a style
// error, on tile errors before a single tile has arrived, or when nothing has arrived in 10 s. The map is never left blank.
// MapLibre is loaded from here, not from index.html: a slow CDN must not hold the whole app back.

export const MAPLIBRE_VERSION = '4.7.1';
export const BRIDGE_VERSION = '0.1.4'; // @maplibre/maplibre-gl-leaflet, released 2026-08-16; its peer range covers maplibre-gl 4.x and Leaflet 1.9
// The bridge is the file as published on npm (not jsDelivr's re-minified .min.js, whose bytes jsDelivr itself says not to pin with SRI).
export const LIB_URLS = Object.freeze({
  maplibreJs: `https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/${MAPLIBRE_VERSION}/maplibre-gl.js`,
  maplibreCss: `https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/${MAPLIBRE_VERSION}/maplibre-gl.css`,
  bridgeJs: `https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@${BRIDGE_VERSION}/leaflet-maplibre-gl.js`,
});
// Subresource integrity of exactly those files (sha384 of the bytes the CDNs serve; the cdnjs ones also equal cdnjs's own published sha512,
// the bridge equals the npm tarball's file). A changed byte means the library is refused and the map falls back to the picture tiles.
export const LIB_INTEGRITY = Object.freeze({
  maplibreJs: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj',
  maplibreCss: 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V',
  bridgeJs: 'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS',
});

export const GL_WAIT_MS = 6000; // libraries that have not arrived by then: raster
export const GL_GIVE_UP_MS = 10_000; // no vector tile in this long (page visible) after the map started: raster
export const TILE_ERROR_LIMIT = 3;
/** An outage after the map has drawn: this many tile errors, with no good tile in between for OUTAGE_MS (page shown), means the picture map. */
export const OUTAGE_ERRORS = 5;
export const OUTAGE_MS = 20_000;
export const CONTEXT_LOST_MS = 3500; // WebGL context lost and not restored in this long (page visible): raster
export const MAX_GL_RESTARTS = 2; // vector maps started again in a row after a lost-and-restored context, before the picture map
export const GL_STABLE_MS = 60_000; // a restarted vector map that has drawn this long before the next loss gets the count started over

/** The style, next to index.html (precached by sw.js). */
export const STYLE_URL = new URL('../map-style.json', import.meta.url).href;

/** The id of the style's one vector source (OpenFreeMap's tiles). The style has a GeoJSON source of our own too (`lobes`), which is no sign the server is up. */
export const VECTOR_SOURCE = 'openmaptiles';

/** Is this MapLibre `sourcedata` event a tile of the OpenFreeMap vector source arriving? Only that ends a run of tile errors; our own layers never do. */
export const isVectorTileEvent = (e) => Boolean(e && e.tile && e.sourceId === VECTOR_SOURCE);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** chooseBasemap({webgl, maplibreLoaded}) -> 'vector' | 'raster'. Only a real `true` for both gives vector. */
export function chooseBasemap({ webgl, maplibreLoaded } = {}) {
  return webgl === true && maplibreLoaded === true ? 'vector' : 'raster';
}

/** `?nogl=1` on localhost: use the raster fallback (to test it). On the real site it does nothing, like ?nosw=1. `loc` = {hostname, search}. */
export function glForcedOff(loc) {
  if (!loc || !LOCAL_HOSTS.has(loc.hostname)) return false;
  try {
    return new URLSearchParams(loc.search ?? '').get('nogl') === '1';
  } catch {
    return false;
  }
}

/**
 * Has the vector map failed? `styleFailed`: the style or its tile description would not load. `tileErrors` / `tilesLoaded`: vector tile
 * requests that failed / arrived. `waitedMs`: since the map started.
 * Before the first tile: 3 errors, or 10 s of nothing, is a failure. After it a short loss of network (a tunnel) must not throw a
 * working map away, but an outage must not leave it blank either: `errorsSinceTile` tile errors since the last good tile (>= 5) with
 * `msSinceTile` (page shown) of at least 20 s since that tile (or since the map started drawing) means OpenFreeMap is gone: picture map.
 */
export function shouldFallBack({
  styleFailed = false, tileErrors = 0, tilesLoaded = 0, waitedMs = 0, errorsSinceTile = 0, msSinceTile = 0,
  tileErrorLimit = TILE_ERROR_LIMIT, giveUpMs = GL_GIVE_UP_MS, outageErrors = OUTAGE_ERRORS, outageMs = OUTAGE_MS,
} = {}) {
  if (styleFailed) return true;
  if (tilesLoaded > 0) return errorsSinceTile >= outageErrors && msSinceTile >= outageMs;
  return tileErrors >= tileErrorLimit || waitedMs >= giveUpMs;
}

/** Does this browser give a WebGL context? (MapLibre needs one; a phone with hardware acceleration off does not have it.) */
export function webglAvailable(doc = globalThis.document) {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const librariesThere = (win) => Boolean(win?.maplibregl && win?.L?.maplibreGL);

/** Loads MapLibre GL JS and then the Leaflet bridge (in this order: the bridge reads `maplibregl` when it starts). Resolves true/false, never rejects. */
export function loadVectorLibs({ doc = globalThis.document, win = globalThis, timeoutMs = GL_WAIT_MS, urls = LIB_URLS, integrity = LIB_INTEGRITY } = {}) {
  if (librariesThere(win)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok); };
    const script = (src, integrity) => new Promise((ok, fail) => {
      const el = doc.createElement('script');
      el.src = src;
      el.integrity = integrity;
      el.crossOrigin = 'anonymous'; // needed for the integrity check, and lets sw.js keep a real (not opaque) copy for offline
      el.async = true;
      el.onload = ok;
      el.onerror = () => fail(new Error(`could not load ${src}`));
      doc.head.append(el);
    });
    try {
      timer = setTimeout(() => finish(false), timeoutMs);
      const css = doc.createElement('link'); // in parallel; app.css has the few rules the map cannot do without
      css.rel = 'stylesheet';
      css.href = urls.maplibreCss;
      css.integrity = integrity.maplibreCss;
      css.crossOrigin = 'anonymous';
      doc.head.append(css);
      script(urls.maplibreJs, integrity.maplibreJs).then(() => script(urls.bridgeJs, integrity.bridgeJs)).then(() => finish(librariesThere(win)), () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/**
 * A stopwatch that only counts while the page is shown: switching to another app must not use up the time the vector map is given to
 * show its first tile (a hidden page's requests are throttled or paused, not failed). `now` is a function returning ms.
 */
export function createActiveClock(now = Date.now, hidden = false) {
  let total = 0;
  let since = hidden ? null : now();
  return {
    pause() { if (since !== null) { total += now() - since; since = null; } },
    resume() { if (since === null) since = now(); },
    elapsed: () => total + (since === null ? 0 : now() - since),
  };
}

/**
 * The WebGL context of the vector map was lost (the phone took the GPU back; common after the app was in the background). The browser
 * usually gives it back within a moment; if it has not after `waitMs` of the page being shown, `onGiveUp()` is called (once) and the
 * app switches to the picture map. A lost context that is restored in time is forgotten. While the page is hidden the clock is stopped
 * and starts again, from zero, when it is shown. Timers are injected so this runs in Node tests.
 */
export function createContextWatch({ onGiveUp, waitMs = CONTEXT_LOST_MS, setTimer = setTimeout, clearTimer = clearTimeout, visible = () => true } = {}) {
  let lost = false;
  let done = false;
  let timer = null;
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const arm = () => {
    stop();
    if (!lost || done || !visible()) return;
    timer = setTimer(() => { timer = null; if (lost && !done) { done = true; onGiveUp?.(); } }, waitMs);
  };
  return {
    lost() { lost = true; arm(); },
    restored() { lost = false; stop(); },
    hide() { stop(); },
    show() { arm(); },
    isLost: () => lost,
    isDone: () => done,
  };
}

/**
 * How many times in a row the vector map may be started again after its WebGL context was lost and came back. A phone that loses the
 * context whenever the app goes to the background (iOS) must not run out of restarts over a trip day, but a GPU that takes it away again
 * and again right after each restart must not loop either. So the count starts over once the map that was started has drawn tiles for
 * `stableMs` (60 s) before the next loss. Clock injected (`now`, ms) so this runs in Node tests.
 *
 *   mapDrew()        the (new) vector map painted its first tile; the stable time counts from the first call only
 *   contextLost()    the context was lost: if the map had been drawing for `stableMs`, the count starts over; either way it is not stable now
 *   allowRestart()   a restart is wanted: true (and counted) while fewer than `max` have been used since the count started, else false
 */
export function createRestartBudget({ max = MAX_GL_RESTARTS, stableMs = GL_STABLE_MS, now = Date.now } = {}) {
  let used = 0;
  let drawingSince = null;
  return {
    mapDrew() { if (drawingSince === null) drawingSince = now(); },
    contextLost() {
      if (drawingSince !== null && now() - drawingSince >= stableMs) used = 0;
      drawingSince = null;
    },
    allowRestart() {
      drawingSince = null;
      used += 1;
      return used <= max;
    },
    used: () => used,
  };
}
