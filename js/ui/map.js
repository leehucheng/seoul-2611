// Leaflet map with one round pin per place. `L` is the global from the CDN <script> in index.html.
//
// initMap(el, {insets}) -> {
//   setPlaces(places, {me, starred, fit, translations}), focus(placeId, {zoom}), setSelected(placeId|null),
//   onPinClick(fn) / onMapClick(fn) -> off(), locate() -> Promise<{lat,lng}|null>, lastLocation(),
//   fitAll(), flyTo(lat, lng, zoom), getMap()
// }
// `insets()` (optional) returns {top, bottom} in px: screen space covered by the chips and the bottom of the screen (tab bar,
// place card, add form), so focus() can place the pin in the part of the map that is actually visible.
//
// Pins are 3+1: below zoom 16 a round coloured dot with the category icon; from zoom 16 up the dot also gets a white capsule
// with the place's name (pin-labels.js). Capsules that would overlap are hidden, the lower priority first (selected, starred,
// wanted by me, the rest); the dot always stays. Every capsule is in the page all the time: the map gets class `labels-on`
// at zoom >= 16 and each hidden capsule gets class `is-off`. Both are recomputed ~100 ms after zoomend / moveend (and after
// the places or the selection change): no pin is rebuilt while the map moves.
import { initialOf } from '../people.js';
import { dotRect, labelPriority, labelRect, labelText, labelsShownAt, pickVisibleLabels, placeName } from '../pin-labels.js';
import { categoryOf, hasCoords, isHidden, toCoord } from '../place-view.js';
import { h, icon } from './dom.js';

// The brief named CARTO Voyager (https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png), but on
// 2026-11-02 every CARTO raster tile is one and the same "API KEY REQUIRED" watermark image, so the base map is
// OpenStreetMap's own tile server: no key, and five people for ten days is well inside its usage policy.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'; // OSM's policy asks for a link

const SEOUL = [37.5665, 126.978];
const PIN_BOX = 44; // touch target of a pin; the drawn circle (DOT_SIZE) is smaller
const LOCATE_TIMEOUT_MS = 8000;
const LABEL_DELAY_MS = 100; // wait this long after the map stopped moving before the names are laid out
const LABEL_VIEW_MARGIN = 120; // px outside the screen that still count (a name next to the edge)

/**
 * The dot (and, in the same box, the name capsule behind it). `labelHidden`: the capsule lost its spot to a stronger neighbour.
 * `translations`: the snapshot's Korean -> Chinese map, so a place with only a Korean name shows its Chinese name.
 */
function pinElement(place, { wanted, recommended, starred }, { labelHidden = false, translations } = {}) {
  const cat = categoryOf(place.category);
  const dot = h('div', { class: ['pin', wanted && 'pin--want', recommended && 'pin--rec'].filter(Boolean).join(' ') }, icon(cat.icon));
  dot.style.setProperty('--c', cat.color);
  if (starred) dot.append(h('span', { class: 'pin-star' }, icon('i-star')));
  const label = h('span', { class: `pin-label${labelHidden ? ' is-off' : ''}` }, labelText(place, undefined, translations));
  return h('div', { class: 'pin-stack' }, label, dot); // the capsule first: the dot sits on top of its left end
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
  let translations = {}; // the snapshot's Korean -> Chinese map (setPlaces): names of Korean-only places are shown in Chinese

  // ---- pins -------------------------------------------------------------------------------------------------
  const buildIcon = (place, flags, selected, labelHidden) => L.divIcon({
    className: `pin-icon${selected ? ' is-selected' : ''}`,
    html: pinElement(place, flags, { labelHidden, translations }),
    iconSize: [PIN_BOX, PIN_BOX],
    iconAnchor: [PIN_BOX / 2, PIN_BOX / 2],
  });
  const setAria = (entry) => { // the spoken label and the hover tooltip, both the same Chinese-first name
    const el = entry.marker.getElement();
    el?.setAttribute('aria-label', entry.label);
    el?.setAttribute('title', entry.label);
  };

  function render(entry) {
    const { place, flags } = entry;
    const selected = place.id === selectedId;
    const name = placeName(place, translations); // one name for the spoken label, the tooltip and (cut) the capsule
    const sig = JSON.stringify([place.lat, place.lng, place.category, name, flags, selected]);
    if (sig === entry.sig) return;
    entry.sig = sig;
    entry.label = name;
    entry.marker.options.title = name;
    entry.marker.setLatLng([toCoord(place.lat), toCoord(place.lng)]);
    entry.marker.setIcon(buildIcon(place, flags, selected, entry.labelHidden));
    entry.marker.setZIndexOffset(selected ? 2000 : flags.wanted ? 1000 : 0);
    setAria(entry);
    scheduleLabels(); // a rebuilt pin has a new capsule (a new name, a new width)
  }

  function createEntry(place, flags) {
    const marker = L.marker([toCoord(place.lat), toCoord(place.lng)], {
      icon: buildIcon(place, flags, false, false), keyboard: true, title: placeName(place, translations),
    });
    const entry = { marker, place, flags, sig: '', label: placeName(place, translations), labelHidden: false };
    marker.on('click', () => { for (const fn of [...pinHandlers]) fn(entry.place.id); });
    marker.on('add', () => setAria(entry));
    entries.set(place.id, entry);
    layer.addLayer(marker);
    return entry;
  }

  function fitAll() {
    const pts = [...entries.values()].map((e) => e.marker.getLatLng());
    if (pts.length === 0) return;
    const { top = 0, bottom = 0 } = insets(); // keep every pin clear of the chips and the tab bar
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [24, Math.max(76, top + 16)], paddingBottomRight: [24, Math.max(24, bottom + 16)], maxZoom: 16, animate: false,
    });
    fitted = true;
  }

  // ---- name capsules (see the header) -----------------------------------------------------------------------
  let labelTimer = 0;
  function scheduleLabels() {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(updateLabels, LABEL_DELAY_MS);
  }

  function updateLabels() {
    labelTimer = 0;
    const on = labelsShownAt(map.getZoom());
    el.classList.toggle('labels-on', on); // CSS shows every capsule that is not `is-off`
    if (!on) return;
    const size = map.getSize();
    const items = [];
    const dots = [];
    const live = [];
    for (const [id, entry] of entries) {
      const node = entry.marker.getElement()?.querySelector('.pin-label');
      if (!node) continue;
      const pt = map.latLngToContainerPoint(entry.marker.getLatLng());
      if (pt.x < -LABEL_VIEW_MARGIN || pt.y < -LABEL_VIEW_MARGIN || pt.x > size.x + LABEL_VIEW_MARGIN || pt.y > size.y + LABEL_VIEW_MARGIN) continue;
      live.push([entry, node]);
      items.push({
        id, ...labelRect(pt.x, pt.y, node.offsetWidth), // measured with the capsules displayed (a single layout pass for all of them)
        priority: labelPriority({ selected: id === selectedId, starred: entry.flags.starred, mine: entry.flags.wanted }),
      });
      dots.push({ id, ...dotRect(pt.x, pt.y) });
    }
    const keep = pickVisibleLabels(items, { dots });
    for (const [entry, node] of live) {
      const hide = !keep.has(entry.place.id);
      entry.labelHidden = hide;
      node.classList.toggle('is-off', hide);
    }
  }

  map.on('zoomend moveend resize', scheduleLabels);

  function setPlaces(places, { me = '', starred = [], fit, translations: tr } = {}) {
    if (tr && typeof tr === 'object') translations = tr; // before the pins are built; a pin whose Chinese name just arrived is rebuilt by render()
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
    scheduleLabels(); // pins came or went
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
      meCircle = L.circle([lat, lng], { radius: 0, interactive: false, stroke: false, fillColor: '#1d5fd6', fillOpacity: 0.12 }).addTo(map);
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
