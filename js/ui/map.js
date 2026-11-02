// Leaflet map with one round pin per place. `L` is the global from the CDN <script> in index.html.
//
// initMap(el, {insets}) -> {
//   setPlaces(places, {me, starred, fit}), focus(placeId, {zoom}), setSelected(placeId|null),
//   onPinClick(fn) / onMapClick(fn) -> off(), locate() -> Promise<{lat,lng}|null>, lastLocation(),
//   fitAll(), flyTo(lat, lng, zoom), getMap()
// }
// `insets()` (optional) returns {top, bottom} in px: screen space covered by the chips and the bottom sheet,
// so focus() can place the pin in the part of the map that is actually visible.
import { initialOf } from '../people.js';
import { categoryOf, hasCoords, isHidden, toCoord } from '../place-view.js';
import { h, icon } from './dom.js';

// The brief named CARTO Voyager (https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png), but on
// 2026-11-02 every CARTO raster tile is one and the same "API KEY REQUIRED" watermark image, so the base map is
// OpenStreetMap's own tile server: no key, and five people for ten days is well inside its usage policy.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'; // OSM's policy asks for a link

const SEOUL = [37.5665, 126.978];
const PIN_BOX = 44; // touch target of a pin; the drawn circle is smaller
const LOCATE_TIMEOUT_MS = 8000;
const FIT_PADDING = { topLeft: [24, 76], bottomRight: [24, 24] };

function pinElement(place, { wanted, recommended, starred }) {
  const cat = categoryOf(place.category);
  const pin = h('div', { class: ['pin', wanted && 'pin--want', recommended && 'pin--rec'].filter(Boolean).join(' ') }, icon(cat.icon));
  pin.style.setProperty('--c', cat.color);
  if (starred) pin.append(h('span', { class: 'pin-star' }, icon('i-star')));
  return pin;
}

export function initMap(el, { insets = () => ({ top: 0, bottom: 0 }) } = {}) {
  if (typeof L === 'undefined') throw new Error('leaflet_missing');

  const map = L.map(el, { zoomControl: false, attributionControl: false, center: SEOUL, zoom: 12, zoomSnap: 0.5, maxZoom: 19 });
  if (!L.Browser.mobile) L.control.zoom({ position: 'topleft' }).addTo(map); // phones pinch; the +/- buttons are for a desktop browser
  const attribution = L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(map);
  attribution.addAttribution(TILE_ATTRIBUTION);
  for (const a of attribution.getContainer().querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } // do not navigate the app away
  L.tileLayer(TILE_URL, { maxZoom: 19, maxNativeZoom: 19 }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  const entries = new Map(); // place id -> {marker, place, flags, sig}
  const pinHandlers = new Set();
  const mapHandlers = new Set();
  let selectedId = null;
  let fitted = false;
  let lastMe = null;

  // ---- pins -------------------------------------------------------------------------------------------------
  const buildIcon = (place, flags, selected) => L.divIcon({
    className: `pin-icon${selected ? ' is-selected' : ''}`,
    html: pinElement(place, flags),
    iconSize: [PIN_BOX, PIN_BOX],
    iconAnchor: [PIN_BOX / 2, PIN_BOX / 2],
  });
  const labelOf = (place) => place.name_zh || place.name_kr || place.name_en || '店家';
  const setAria = (entry) => entry.marker.getElement()?.setAttribute('aria-label', entry.label);

  function render(entry) {
    const { place, flags } = entry;
    const selected = place.id === selectedId;
    const sig = JSON.stringify([place.lat, place.lng, place.category, place.name_zh, place.name_kr, flags, selected]);
    if (sig === entry.sig) return;
    entry.sig = sig;
    entry.label = labelOf(place);
    entry.marker.setLatLng([toCoord(place.lat), toCoord(place.lng)]);
    entry.marker.setIcon(buildIcon(place, flags, selected));
    entry.marker.setZIndexOffset(selected ? 2000 : flags.wanted ? 1000 : 0);
    setAria(entry);
  }

  function createEntry(place, flags) {
    const marker = L.marker([toCoord(place.lat), toCoord(place.lng)], {
      icon: buildIcon(place, flags, false), keyboard: true, title: labelOf(place),
    });
    const entry = { marker, place, flags, sig: '', label: labelOf(place) };
    marker.on('click', () => { for (const fn of [...pinHandlers]) fn(entry.place.id); });
    marker.on('add', () => setAria(entry));
    entries.set(place.id, entry);
    layer.addLayer(marker);
    return entry;
  }

  function fitAll() {
    const pts = [...entries.values()].map((e) => e.marker.getLatLng());
    if (pts.length === 0) return;
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: FIT_PADDING.topLeft, paddingBottomRight: FIT_PADDING.bottomRight, maxZoom: 16, animate: false });
    fitted = true;
  }

  function setPlaces(places, { me = '', starred = [], fit } = {}) {
    const mine = initialOf(me);
    const starSet = starred instanceof Set ? starred : new Set(starred);
    const seen = new Set();
    for (const place of places ?? []) {
      if (!place || !place.id || isHidden(place) || !hasCoords(place)) continue; // no coordinates -> no pin; wrong beats missing
      seen.add(place.id);
      const flags = {
        wanted: Boolean(mine) && String(place.who ?? '').split('|').map((s) => s.trim()).includes(mine),
        recommended: place.source === 'recommend',
        starred: starSet.has(place.id),
      };
      let entry = entries.get(place.id);
      if (entry) { entry.place = place; entry.flags = flags; } else entry = createEntry(place, flags);
      render(entry);
    }
    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      layer.removeLayer(entry.marker);
      entries.delete(id);
    }
    if (fit === true || (fit !== false && !fitted)) fitAll();
  }

  function setSelected(id) {
    const before = selectedId;
    selectedId = id ?? null;
    for (const key of [before, selectedId]) if (key && entries.has(key)) render(entries.get(key));
  }

  function flyTo(lat, lng, zoom) {
    const z = Math.max(map.getZoom(), zoom ?? 16);
    const { top = 0, bottom = 0 } = insets();
    const shifted = map.project([lat, lng], z).add([0, (bottom - top) / 2]); // pin lands in the middle of the uncovered part
    map.setView(map.unproject(shifted, z), z, { animate: true });
  }

  function focus(placeId, { zoom } = {}) {
    const entry = entries.get(placeId);
    if (!entry) return false;
    const { lat, lng } = entry.marker.getLatLng();
    flyTo(lat, lng, zoom);
    return true;
  }

  map.on('click', (e) => {
    const pos = { lat: e.latlng.lat, lng: e.latlng.lng };
    for (const fn of [...mapHandlers]) fn(pos);
  });

  const subscribe = (set, fn) => { set.add(fn); return () => set.delete(fn); };

  // ---- my position (blue dot) --------------------------------------------------------------------------------
  let meMarker = null;
  let meCircle = null;
  let watching = false;

  function showMe(coords) {
    const lat = Number(coords.latitude);
    const lng = Number(coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    lastMe = { lat, lng };
    const accuracy = Number(coords.accuracy);
    if (!meMarker) {
      meMarker = L.marker([lat, lng], {
        interactive: false, keyboard: false, zIndexOffset: 3000,
        icon: L.divIcon({ className: 'me-icon', html: h('div', { class: 'me-dot' }), iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(map);
      meCircle = L.circle([lat, lng], { radius: 0, interactive: false, stroke: false, fillColor: '#2563eb', fillOpacity: 0.12 }).addTo(map);
    }
    meMarker.setLatLng([lat, lng]);
    meCircle.setLatLng([lat, lng]);
    meCircle.setRadius(Number.isFinite(accuracy) && accuracy > 0 && accuracy < 500 ? accuracy : 0);
    return { lat, lng };
  }

  function watchMe() {
    if (watching) return;
    try {
      navigator.geolocation.watchPosition((pos) => { try { showMe(pos.coords); } catch { /* keep the last dot */ } }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
      watching = true;
    } catch { /* no geolocation: nothing to keep fresh */ }
  }

  /** Resolves {lat,lng}, or null when location is denied / unavailable / slower than 8 s. Never throws or rejects. */
  function locate() {
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
      timer = setTimeout(() => finish(null), LOCATE_TIMEOUT_MS + 500); // some browsers ignore the `timeout` option while a permission prompt is open
      try {
        const geo = navigator.geolocation;
        if (!geo) { finish(null); return; }
        geo.getCurrentPosition(
          (pos) => { let me = null; try { me = showMe(pos.coords); if (me) watchMe(); } catch { me = null; } finish(me); },
          () => finish(null),
          { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 30000 },
        );
      } catch {
        finish(null);
      }
    });
  }

  // Already allowed on this phone: show the blue dot right away, without a prompt and without moving the map.
  try {
    navigator.permissions?.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') locate(); }, () => {});
  } catch { /* Permissions API missing: the locate button still works */ }

  return {
    setPlaces,
    focus,
    flyTo,
    fitAll,
    setSelected,
    locate,
    lastLocation: () => lastMe,
    onPinClick: (fn) => subscribe(pinHandlers, fn),
    onMapClick: (fn) => subscribe(mapHandlers, fn),
    pinCount: () => entries.size,
    getMap: () => map,
  };
}
