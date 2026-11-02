// The base map under the pins: our own vector map (MapLibre GL inside Leaflet), or OpenStreetMap's picture tiles as the fallback.
// See js/basemap.js for the rules. `L` is the Leaflet global; `L.maplibreGL` appears once the two libraries have loaded.
//
//   const basemap = attachBasemap(map, el)   -> {mode(), onMode(fn) -> off()}
//   mode(): 'pending' (the libraries are on their way: the cream paper shows) | 'vector' | 'raster'
//
// The container `el` carries class `basemap-pending` / `basemap-vector` / `basemap-raster`: css/app.css gives the raster one its filter.
// It starts vector-or-raster once and switches to raster at most once (never back): a map that flaps between two looks is worse than either.
import {
  GL_GIVE_UP_MS, OUTAGE_MS, STYLE_URL, chooseBasemap, createActiveClock, createContextWatch, createRestartBudget, glForcedOff, isVectorTileEvent, loadVectorLibs, shouldFallBack,
  webglAvailable,
} from '../basemap.js';
import { installStationBadges } from './station-badges.js';

// The brief named CARTO Voyager (https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png), but on
// 2026-11-02 every CARTO raster tile is one and the same "API KEY REQUIRED" watermark image, so the picture base map is
// OpenStreetMap's own tile server: no key, and five people for ten days is well inside its usage policy.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'; // OSM's policy asks for a link
export const GL_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · '
  + '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';

// Chinese and Korean text in the vector map is drawn with the phone's own font (no CJK glyphs are downloaded).
const LOCAL_FONT = "'PingFang TC', 'Noto Sans CJK TC', 'Noto Sans TC', 'Microsoft JhengHei', 'Apple SD Gothic Neo', sans-serif";
const PAPER_PANE = 'paper'; // its class is leaflet-paper-pane (css/app.css multiplies it over the tiles)

/** A cream sheet that is multiplied over the filtered picture tiles (the "paper" of the G2α look). It follows the map: three screens big, re-centred on every move. */
function paperLayer() {
  const Paper = L.Layer.extend({
    onAdd(map) {
      if (!map.getPane(PAPER_PANE)) map.createPane(PAPER_PANE).style.zIndex = 250; // above the tiles, below the lobes and the pins
      this._el = L.DomUtil.create('div', 'paper-sheet');
      map.getPane(PAPER_PANE).appendChild(this._el);
      this._reset();
    },
    onRemove() { L.DomUtil.remove(this._el); },
    getEvents() { return { move: this._reset, zoomend: this._reset, resize: this._reset }; },
    _reset() {
      const size = this._map.getSize();
      this._el.style.width = `${size.x * 3}px`;
      this._el.style.height = `${size.y * 3}px`;
      L.DomUtil.setPosition(this._el, this._map.containerPointToLayerPoint([-size.x, -size.y]));
    },
  });
  return new Paper();
}

/** Anchors in the attribution line open in a new tab (the app must not navigate away); the text is rewritten whenever a layer comes or goes. */
function keepLinksInNewTab(control) {
  const fix = () => {
    for (const a of control.getContainer().querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  };
  try {
    new MutationObserver(fix).observe(control.getContainer(), { childList: true, subtree: true });
  } catch { /* no MutationObserver: the links keep their default */ }
  fix();
}

/**
 * Leaflet's own scale control, metric only, drawn as an ink bar (as long as the distance it stands for) and the distance beside it, inside a
 * capsule (css/app.css). It sits over the credit line in the map's bottom strip, which rides above the tab bar or the open place card.
 */
function scaleControl() {
  const Scale = L.Control.Scale.extend({
    _updateScale(scale, text, ratio) {
      scale.replaceChildren();
      const bar = L.DomUtil.create('i', 'scale-bar', scale);
      bar.style.width = `${Math.round(this.options.maxWidth * ratio)}px`;
      L.DomUtil.create('b', 'scale-num', scale).textContent = text;
    },
  });
  return new Scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 84 });
}

export function attachBasemap(map, el, { win = window, doc = document } = {}) {
  const attribution = L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(map);
  keepLinksInNewTab(attribution);
  scaleControl().addTo(map); // added after the credit line, so it stands over it

  let mode = 'pending';
  let glLayer = null;
  let rasterLayers = [];
  let stopWatching = null;
  const budget = createRestartBudget(); // restarts after a lost WebGL context: 2 in a row, the count starts over after a minute of stable drawing
  const handlers = new Set();

  const setMode = (m) => {
    mode = m;
    for (const name of ['pending', 'vector', 'raster']) el.classList.toggle(`basemap-${name}`, name === m);
    for (const fn of [...handlers]) { try { fn(m); } catch { /* a listener must not break the map */ } }
  };

  /**
   * Take the vector layer off the map. One that failed in the middle of starting (no WebGL context) is a trap: Leaflet had already hooked
   * its zoom handlers to the map and they would throw on every zoom, and its own removal stops at the same failure. So: give it
   * something to remove, remove it, and let go of its events either way.
   */
  function dropGlLayer(layer) {
    try { if (!layer.getMaplibreMap?.()) layer._glMap = { remove() {} }; } catch { /* the bridge changed its insides: the next step still lets go of the events */ }
    try { map.removeLayer(layer); } catch { /* stopped halfway */ }
    try { layer.fire('remove'); } catch { /* already gone */ } // Leaflet unhooks the layer's map events on this
  }

  // ---- the district wash inside the vector map ----------------------------------------------------------------------------------
  // At street zoom the pale yellow wash of the districts is a fill layer of the vector map itself (style layer `lobe-wash`, fed from the
  // shapes the app computes), so the station names stay crisp above it. While the vector map has not drawn it, and in the picture fallback,
  // Leaflet draws the same wash (css/app.css: .lobe-fill is hidden only under `wash-gl`, which this class says is the vector map's job).
  let lobeShapes = { type: 'FeatureCollection', features: [] };
  const pushShapes = (gl) => {
    try {
      const source = gl.getSource('lobes');
      if (!source) return false;
      source.setData(lobeShapes);
      return true;
    } catch { return false; }
  };
  /** Put the current shapes into the map `gl` as soon as its style has made the source, and say so (wash-gl) once it has drawn a frame. */
  function washInto(gl) {
    const apply = () => {
      if (!pushShapes(gl)) return;
      gl.once('idle', () => { if (mode === 'vector' && glLayer?.getMaplibreMap?.() === gl) el.classList.add('wash-gl'); });
    };
    if (gl.getSource('lobes')) apply(); else gl.once('style.load', apply);
  }
  /** `shapes`: [{polygon: [[lat, lng], ...]}] (js/area-lobes.js). */
  function setLobeShapes(shapes) {
    lobeShapes = {
      type: 'FeatureCollection',
      features: (shapes ?? []).filter((s) => Array.isArray(s?.polygon) && s.polygon.length > 2).map((s) => {
        const ring = s.polygon.map(([lat, lng]) => [lng, lat]);
        return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
      }),
    };
    const gl = mode === 'vector' ? glLayer?.getMaplibreMap?.() : null;
    if (gl) { if (gl.getSource('lobes')) pushShapes(gl); else gl.once('style.load', () => pushShapes(gl)); }
  }

  function useRaster(reason) {
    if (mode === 'raster') return; // once, for good
    stopWatching?.();
    el.classList.remove('wash-gl');
    if (glLayer) {
      dropGlLayer(glLayer);
      glLayer = null;
    }
    rasterLayers = [
      L.tileLayer(TILE_URL, { maxZoom: 19, maxNativeZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map),
      paperLayer().addTo(map),
    ];
    setMode('raster');
    if (reason) console.info(`basemap: picture tiles (${reason})`);
  }

  /**
   * Watch the GL map -> raster when: a style error; tile errors before any tile has come; no tile at all for GL_GIVE_UP_MS of the page being
   * shown (the clock stops while the page is hidden, and errors of a hidden page are not counted: a phone that went to another app throttles
   * or cuts the requests); an outage after the first tile (OUTAGE_ERRORS tile errors in a row with no good tile for OUTAGE_MS of the page
   * being shown: OpenFreeMap is down, the map would drift into blank paper); or the WebGL context was lost and did not come back in
   * CONTEXT_LOST_MS (the map would stay without streets).
   */
  function watch(gl) {
    const clock = createActiveClock(Date.now, Boolean(doc.hidden));
    const stats = { styleFailed: false, tileErrors: 0, tilesLoaded: 0, errorsSinceTile: 0 };
    let lastTileMs = 0; // the active clock when the last good tile arrived (0: none yet, so the map's own start counts)
    let timer = 0;
    let outageTimer = 0;
    const check = (why) => {
      if (mode !== 'vector') return;
      if (shouldFallBack({ ...stats, waitedMs: clock.elapsed(), msSinceTile: clock.elapsed() - lastTileMs })) useRaster(why);
    };
    const armOutage = () => { // a quiet map (nothing asked, nothing failed) is not an outage: only errors since the last good tile start the count
      clearTimeout(outageTimer);
      if (doc.hidden || mode !== 'vector' || stats.tilesLoaded === 0 || stats.errorsSinceTile === 0) return;
      const left = OUTAGE_MS - (clock.elapsed() - lastTileMs);
      if (left <= 0) return; // the next error decides
      outageTimer = setTimeout(() => { check('OpenFreeMap stopped answering'); armOutage(); }, left + 100);
    };
    const armGiveUp = () => {
      clearTimeout(timer);
      if (doc.hidden || stats.tilesLoaded > 0) return;
      timer = setTimeout(() => {
        check('no vector tile arrived in time');
        if (mode === 'vector') armGiveUp(); // not yet (the clock lost time while the timer ran): wait the rest
      }, Math.max(0, GL_GIVE_UP_MS - clock.elapsed()) + 100);
    };
    const context = createContextWatch({ onGiveUp: () => useRaster('WebGL context lost'), visible: () => !doc.hidden });
    const onVisibility = () => {
      if (doc.hidden) { clock.pause(); clearTimeout(timer); clearTimeout(outageTimer); context.hide(); } else { clock.resume(); armGiveUp(); armOutage(); context.show(); }
    };

    gl.on('error', (e) => {
      if (doc.hidden) return;
      const url = String(e?.error?.url ?? '');
      if (e?.tile) { stats.tileErrors += 1; stats.errorsSinceTile += 1; }
      else if (/\/fonts\//.test(url) || /glyph|sprite/i.test(String(e?.error?.message ?? ''))) return; // a missing letter shape is not a failed map
      else stats.styleFailed = true;
      check(`map error: ${e?.error?.message ?? 'unknown'}`);
      armOutage();
    });
    gl.on('sourcedata', (e) => {
      if (!isVectorTileEvent(e)) return; // not our own GeoJSON (the district wash) and not the TileJSON: neither says OpenFreeMap answers
      stats.tilesLoaded += 1;
      stats.errorsSinceTile = 0; // a good tile ends the run of errors
      lastTileMs = clock.elapsed();
      clearTimeout(outageTimer);
      budget.mapDrew();
    });
    gl.on('webglcontextlost', () => { budget.contextLost(); context.lost(); });
    // MapLibre 4.7 gets a context back but then draws nothing (its buffers and textures belonged to the lost one; checked with
    // WEBGL_lose_context: a blank cream map that only a pan half-repaints). So a restored context means a fresh vector map in place of the old.
    gl.on('webglcontextrestored', () => { context.restored(); setTimeout(restartVector, 0); });
    doc.addEventListener('visibilitychange', onVisibility);
    armGiveUp();
    stopWatching = () => { clearTimeout(timer); clearTimeout(outageTimer); context.restored(); doc.removeEventListener('visibilitychange', onVisibility); stopWatching = null; };
  }

  /** Replace the vector map by a new one (its tiles come from the browser's and the service worker's caches). A GPU that keeps taking its context away gets the picture map. */
  function restartVector() {
    if (mode !== 'vector' || !glLayer) return;
    if (!budget.allowRestart()) { useRaster('WebGL context lost again and again'); return; }
    stopWatching?.();
    el.classList.remove('wash-gl'); // the new map has not drawn the wash yet: Leaflet's own shows meanwhile
    dropGlLayer(glLayer);
    glLayer = null;
    useVector();
  }

  function useVector() {
    try {
      glLayer = L.maplibreGL({
        style: STYLE_URL,
        localIdeographFontFamily: LOCAL_FONT,
        pixelRatio: Math.min(win.devicePixelRatio || 1, 2), // a 3x phone draws 2x: the map is made of flat colours, and the battery lasts longer
        attributionControl: { customAttribution: GL_ATTRIBUTION },
      });
      glLayer.addTo(map); // throws when MapLibre cannot make its WebGL context
      setMode('vector');
      installStationBadges(glLayer.getMaplibreMap(), { doc, ratio: Math.min(win.devicePixelRatio || 1, 2) }); // the line badges in front of the station names
      washInto(glLayer.getMaplibreMap());
      watch(glLayer.getMaplibreMap());
    } catch (e) {
      if (mode === 'vector') mode = 'pending';
      useRaster(`MapLibre would not start: ${e?.message ?? e}`); // takes the half-started layer off the map again
    }
  }

  const forced = glForcedOff(win.location);
  const webgl = !forced && webglAvailable(doc);
  if (forced || !webgl) {
    useRaster(forced ? '?nogl=1' : 'no WebGL');
  } else {
    setMode('pending');
    loadVectorLibs({ doc, win }).then((maplibreLoaded) => {
      if (mode !== 'pending') return;
      if (chooseBasemap({ webgl, maplibreLoaded }) === 'vector') useVector();
      else useRaster('MapLibre did not load');
    });
  }

  return {
    mode: () => mode,
    onMode(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    setLobeShapes, // the districts' shapes, for the wash the vector map draws itself
  };
}
