// Leaflet map with one round pin per place. `L` is the global from the CDN <script> in index.html.
//
// initMap(el, {insets}) -> {
//   setPlaces(places, {me, starred, ginkgo, fit, translations, lobePlaces, firstView}), focus(placeId, {zoom}), setSelected(placeId|null),
//   setNextStop(placeId|null) (today's next stop, the one in the 下一站 strip: its capsule ranks just below the selected pin's),
//   onPinClick(fn) / onMapClick(fn) -> off(), locate() -> Promise<{lat,lng}|null>, lastLocation(),
//   pressLocate() -> Promise<{status, pos}>, onFollowChange(fn) -> off(), isFollowing(), basemapMode(),
//   fitAll(), flyTo(lat, lng, zoom), getMap()
// }
// The base map (ui/basemap-layer.js) is our own vector map, or OpenStreetMap's pictures as a fallback; under the pins sit the yellow
// district lobes of the areas with 3+ places (ui/lobe-layer.js; `lobePlaces` = the places they are made from, default `places`, so a
// category filter does not shrink a district). The first setPlaces that has a pin near Seoul sets the first view: the district named by
// `firstView` ({area, include, zoom}, or a function that returns one, called then; first-view.js chooseFirstView): a district at zoom 14
// to 16 with the pin that chose it in frame, or that one pin; pins far from Seoul (Gwangju, Jeonju) are never part of a district view,
// nor of fitAll(). Me (ui/me-layer.js) is a blue dot with a heading wedge. Follow-me (follow.js): after
// pressLocate() every new position pans the map (zoom unchanged) until the person drags the map, taps the button again, or the app
// sends the map somewhere else (focus, flyTo, fitAll); onFollowChange(fn(on)) tells the button.
// `insets()` (optional) returns {top, bottom} in px: screen space covered by the chips and the bottom of the screen (tab bar,
// place card, add form), so focus() can place the pin in the part of the map that is actually visible.
// `starred` / `ginkgo` are Sets of place ids: the ginkgo leaf at the end of the name (收藏, only on this phone) and the small leaf at
// the pin's top right (the places of the Sheet's 銀杏 tab, ginkgo.js).
//
// Pins (the ginkgo fold-out look): a round family-coloured dot with a 2 px white ring and a thin ink ring. Below zoom 16 it is a small
// plain dot; from zoom 16 up it is the full pin with the category icon and gets a white capsule with the place's name: Chinese bold,
// the Korean name small under it (pin-labels.js; the name is never cut: a capsule may run up to 60% of the map's width, --cap-max, and
// only a longer name gets an ellipsis there). My wish-list pins (`want`: a 3 px ginkgo ring) and the 推薦 ones (`rec`: a dashed ink ring)
// carry their ring at every zoom. Capsules that would overlap are hidden whole, the lower priority first (selected, next stop, starred,
// wanted by me, the rest, then the pins of the 7 月 layer: a `july` pin is muted (paper fill, a light ink ring, a dimmed icon), is drawn under
// the others and never takes a capsule's room from one of ours; main.js only hands them over while that layer is on); the dot always stays.
// Every capsule is in the page all the time: the map gets class `labels-on` at zoom >= 16, each
// capsule carries data-side (right, left, below or above the dot), --dy (a few px up or down) and data-lines (1 or 2), and the hidden
// ones class `is-off`. All of it is recomputed ~100 ms after zoomend / moveend (and after the places or the selection change): no pin
// is rebuilt while the map moves.
import { viewFrame, viewPoints } from '../first-view.js';
import { FOLLOW_OFF, followReducer, locateWaitMs } from '../follow.js';
import { initialOf } from '../people.js';
import {
  CAP_MAX_SHARE, capsuleRect, dotRect, dotSizeFor, labelLines, labelPriority, labelsShownAt, pickLabelLayout, pinClass, pinFlags, placeName, ringFor,
} from '../pin-labels.js';
import { categoryOf, hasCoords, isHidden, toCoord } from '../place-view.js';
import { attachBasemap } from './basemap-layer.js';
import { famStyle, h, icon, leaf } from './dom.js';
import { createLobeLayer } from './lobe-layer.js';
import { createMeLayer } from './me-layer.js';

const SEOUL = [37.5665, 126.978];
const PIN_BOX = 44; // touch target of a pin; the drawn circle (DOT_SIZE) is smaller
const LABEL_DELAY_MS = 100; // wait this long after the map stopped moving before the names are laid out
const LABEL_VIEW_MARGIN = 120; // px outside the screen that still count (a name next to the edge)
const VIEW_PAD = 6; // px a name keeps from the screen's left and right edge
const FOCUS_ANCHOR_X = 0.32; // a focused pin lands this far from the left, as a share of the width
// How far (px, up / down) a capsule beside its dot may be moved to find room, in order of preference.
const SIDE_SHIFTS = [0, -8, 8, -14, 14];

/**
 * The dot and, in the same box, the name capsule behind it (data-side: which side of the dot; data-lines: Chinese + Korean, or only
 * Chinese). `flags` = pinFlags(): the box's classes say what the pin shows (star leaf, 銀杏 leaf, `want` ring, `rec` ring).
 * `labelHidden`: the capsule lost its spot to a stronger neighbour. `translations`: the snapshot's Korean -> Chinese map, so a place with
 * only a Korean name shows its Chinese name first. The Korean line is never shown without its Chinese line above.
 */
function pinElement(place, flags, { labelHidden = false, translations } = {}) {
  const { starred, ginkgo } = flags;
  const cat = categoryOf(place.category);
  const lines = labelLines(place, translations);
  const cap = h('span', { class: `pin-cap${labelHidden ? ' is-off' : ''}` },
    h('span', { class: 'pin-txt' }, h('span', { class: 'pin-zh' }, lines.zh), lines.kr ? h('span', { class: 'pin-kr', lang: 'ko' }, lines.kr) : null),
    h('span', { class: 'pin-chip' }, starred ? leaf() : null)); // a family dot at the end of the name; a ginkgo leaf instead when starred
  const dot = h('span', { class: 'pin-dot' }, icon(cat.icon), ginkgo ? leaf('pin-gl') : null);
  return famStyle(h('div', { class: pinClass(flags), 'data-side': 'r', 'data-lines': lines.kr ? '2' : '1' }, cap, dot), cat);
}

export function initMap(el, { insets = () => ({ top: 0, bottom: 0 }) } = {}) {
  if (typeof L === 'undefined') throw new Error('leaflet_missing');

  const map = L.map(el, { zoomControl: false, attributionControl: false, center: SEOUL, zoom: 12, zoomSnap: 0.5, maxZoom: 19 });
  if (!L.Browser.mobile) L.control.zoom({ position: 'topleft' }).addTo(map); // phones pinch; the +/- buttons are for a desktop browser
  const basemap = attachBasemap(map, el); // vector or picture tiles + their attribution line; the cream paper shows until it is decided
  const lobes = createLobeLayer(map, el, { onShapes: basemap.setLobeShapes }); // under the pins (its panes sit below the marker pane)
  const meLayer = createMeLayer(map);
  const layer = L.layerGroup().addTo(map);

  const entries = new Map(); // place id -> {marker, place, flags, sig}
  const pinHandlers = new Set();
  const mapHandlers = new Set();
  let selectedId = null;
  let nextId = null; // today's next stop (the 下一站 strip), or null
  let fitted = false;
  let follow = FOLLOW_OFF;
  const followHandlers = new Set();
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
    const sig = JSON.stringify([place.lat, place.lng, place.category, name, labelLines(place, translations), flags, selected]);
    if (sig === entry.sig) return;
    entry.sig = sig;
    entry.label = flags.july ? `${name}（7 月）` : name;
    entry.marker.options.title = entry.label;
    entry.marker.setLatLng([toCoord(place.lat), toCoord(place.lng)]);
    entry.marker.setIcon(buildIcon(place, flags, selected, entry.labelHidden));
    entry.marker.setZIndexOffset(selected ? 2000 : flags.wanted ? 1000 : flags.july ? -1000 : 0); // a 7 月 pin lies under ours at the same spot
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

  /**
   * Show [[lat, lng], ...] as large as fits between the chips and the tab bar, at a zoom of at most `maxZoom` (and, with `minZoom`, at
   * least that: a district that is bigger than the screen is cut off rather than shown as dots). `must` (points of `points`): the ones
   * that stay on screen even if that takes a zoom below `minZoom`. Nothing to show: the map stays.
   */
  function fitPoints(points, { minZoom, maxZoom = 16, must = [] } = {}) {
    if (points.length === 0) return;
    const { top = 0, bottom = 0 } = insets(); // keep every pin clear of the chips and the tab bar
    const padTop = Math.max(76, top + 16);
    const padBottom = Math.max(24, bottom + 16);
    const bounds = L.latLngBounds(points);
    const fits = Math.min(maxZoom, map.getBoundsZoom(bounds, false, L.point(48, padTop + padBottom))); // the zoom at which every point shows
    const show = (z) => {
      const centre = map.project(bounds.getCenter(), z).add([0, (padBottom - padTop) / 2]); // what fitBounds does: the middle of the uncovered part
      map.setView(map.unproject(centre, z), z, { animate: false });
    };
    const size = map.getSize();
    const onScreen = (pt) => {
      const p = map.latLngToContainerPoint(pt);
      return p.x >= 24 && p.x <= size.x - 24 && p.y >= padTop && p.y <= size.y - padBottom;
    };
    const z = minZoom === undefined ? fits : Math.max(minZoom, fits);
    show(z);
    if (z > fits && must.some((pt) => !onScreen(pt))) show(fits); // the pin that chose this view must not be cut off by the zoom limit
    fitted = true;
  }

  /** The first view (first-view.js chooseFirstView): one district at district zoom, or one pin. No pin near Seoul: the map stays. */
  function fitFirst(placesForView, view) {
    const { points, ...limits } = viewFrame(placesForView, view);
    fitPoints(points, limits);
  }

  /** Every pin near Seoul (first-view.js: the ones in Gwangju and Jeonju are left out). */
  function fitAll() {
    fitPoints(viewPoints([...entries.values()].map((e) => e.place), ''));
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
    el.style.setProperty('--cap-max', `${Math.round(size.x * CAP_MAX_SHARE)}px`); // the longest a capsule gets; past it the name ends in an ellipsis
    const live = [];
    for (const [id, entry] of entries) {
      const stack = entry.marker.getElement()?.querySelector('.pin-stack');
      const cap = stack?.querySelector('.pin-cap');
      if (!cap) continue;
      const pt = map.latLngToContainerPoint(entry.marker.getLatLng());
      if (pt.x < -LABEL_VIEW_MARGIN || pt.y < -LABEL_VIEW_MARGIN || pt.x > size.x + LABEL_VIEW_MARGIN || pt.y > size.y + LABEL_VIEW_MARGIN) continue;
      live.push({ id, entry, stack, cap, pt, lines: stack.querySelector('.pin-kr') ? '2' : '1' });
    }
    // Measure every capsule in one write pass and one read pass (two layouts, not one per pin), as the lines it has: a capsule is never
    // narrowed or shortened to fit, so this is the size it keeps. Always measured on the right side: that is where the end chip shows,
    // so the width is the widest the capsule can be.
    for (const l of live) { l.stack.dataset.side = 'r'; l.stack.dataset.lines = l.lines; }
    for (const l of live) l.size = { w: l.cap.offsetWidth, h: l.cap.offsetHeight };

    // The alternatives of a pin, in order of preference: to the right of its dot, then to its left (each also shifted a little up or
    // down), then under and over the dot. A capsule must lie inside the part of the map that shows (clear of the top strip, the filters,
    // the card and the tab bar), or it is not drawn (the dot stays); the selected pin keeps every alternative, so its name always shows.
    // A crowded place hides the capsules of the weaker pins whole; it never trims one.
    const { top: coverTop = 0, bottom: coverBottom = 0 } = insets();
    const inside = (o) => o.x >= VIEW_PAD && o.x + o.w <= size.x - VIEW_PAD && o.y >= coverTop + 4 && o.y + o.h <= size.y - coverBottom - 4;
    const items = live.map((l) => {
      const opts = [];
      const ring = ringFor(l.entry.flags); // a wanted / recommended pin's rings push a capsule above or below it further away
      const add = (side, dy = 0) => opts.push({ side, dy, ...capsuleRect(l.pt.x, l.pt.y, l.size.w, l.size.h, side, dy, ring) });
      for (const dy of SIDE_SHIFTS) for (const side of ['r', 'l']) add(side, dy);
      for (const side of ['b', 't']) add(side);
      l.options = l.id === selectedId ? opts : opts.filter(inside);
      return { id: l.id, options: l.options, priority: labelPriority({ selected: l.id === selectedId, next: l.id === nextId, starred: l.entry.flags.starred, mine: l.entry.flags.wanted, july: l.entry.flags.july }) };
    });
    // the dot with its rings: no capsule is laid over it (but one of ours may lie over a 7 月 dot: that pin is drawn under it, pin-labels.js `under`)
    const dots = live.map((l) => ({ id: l.id, ...dotRect(l.pt.x, l.pt.y, dotSizeFor(l.entry.flags)), ...(l.entry.flags.july ? { under: true } : {}) }));
    const layout = pickLabelLayout(items, { dots });
    for (const l of live) {
      const pick = layout.get(l.id);
      const o = pick === undefined ? null : l.options[pick];
      l.entry.labelHidden = !o;
      l.stack.dataset.side = o ? o.side : 'r';
      l.stack.style.setProperty('--dy', `${o ? o.dy : 0}px`);
      l.cap.classList.toggle('is-off', !o);
    }
  }

  map.on('zoomend moveend resize', scheduleLabels);
  // The web fonts arrive after the first draw (they load without blocking the page): every capsule gets another width, so lay them out again.
  try {
    document.fonts?.ready.then(scheduleLabels);
    document.fonts?.addEventListener?.('loadingdone', scheduleLabels);
  } catch { /* no font events: the next map move lays them out */ }

  function setPlaces(places, { me = '', starred = [], ginkgo = [], fit, translations: tr, lobePlaces, firstView } = {}) {
    if (tr && typeof tr === 'object') translations = tr; // before the pins are built; a pin whose Chinese name just arrived is rebuilt by render()
    const mine = initialOf(me) ?? '';
    const starSet = starred instanceof Set ? starred : new Set(starred);
    const ginkgoSet = ginkgo instanceof Set ? ginkgo : new Set(ginkgo);
    const seen = new Set();
    for (const place of places ?? []) {
      if (!place || !place.id || isHidden(place) || !hasCoords(place)) continue; // no coordinates -> no pin; wrong beats missing
      seen.add(place.id);
      const flags = pinFlags(place, { mine, starred: starSet, ginkgo: ginkgoSet }); // wanted by me (ring), 推薦 (dashed ring), star and 銀杏 leaves
      let entry = entries.get(place.id);
      if (entry) { entry.place = place; entry.flags = flags; } else entry = createEntry(place, flags);
      render(entry);
    }
    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      layer.removeLayer(entry.marker);
      entries.delete(id);
    }
    if (fit === true || (fit !== false && !fitted)) {
      dispatchFollow('away');
      fitFirst(lobePlaces ?? places ?? [], typeof firstView === 'function' ? firstView() : firstView ?? {});
    }
    lobes.update(lobePlaces ?? places, { translations }); // the district shapes (only the ones that changed are redrawn)
    scheduleLabels(); // pins came or went
  }

  function setSelected(id) {
    const before = selectedId;
    selectedId = id ?? null;
    for (const key of [before, selectedId]) if (key && entries.has(key)) render(entries.get(key));
  }

  /** Today's next stop (a place id, or null): its name wins a crowded spot over every pin but the selected one. Only the capsules are laid out again; no pin is rebuilt. */
  function setNextStop(id) {
    const next = id ?? null;
    if (next === nextId) return;
    nextId = next;
    scheduleLabels();
  }

  /** The map centre that puts [lat, lng] in the middle of the uncovered part of the map at zoom `z`; `anchorX` (0..1, optional): the share of the width it lands at. */
  function viewTarget(lat, lng, z, anchorX) {
    const { top = 0, bottom = 0 } = insets();
    const dx = Number.isFinite(anchorX) ? (0.5 - anchorX) * map.getSize().x : 0;
    return map.unproject(map.project([lat, lng], z).add([dx, (bottom - top) / 2]), z);
  }

  function moveTo(lat, lng, zoom, { anchorX } = {}) {
    const z = Math.max(map.getZoom(), zoom ?? 16);
    map.setView(viewTarget(lat, lng, z, anchorX), z, { animate: true });
  }

  // These three are how the rest of the app sends the map somewhere: that ends follow-me (the person is looking at something else now).
  function flyTo(lat, lng, zoom, opts) {
    dispatchFollow('away');
    moveTo(lat, lng, zoom, opts);
  }

  // A selected pin's name runs to the right of its dot (two lines, up to ~230 px): the pin lands left of centre so the whole name shows.
  function focus(placeId, { zoom } = {}) {
    const entry = entries.get(placeId);
    if (!entry) return false;
    const { lat, lng } = entry.marker.getLatLng();
    flyTo(lat, lng, zoom, { anchorX: FOCUS_ANCHOR_X });
    return true;
  }

  function fitEverything() {
    dispatchFollow('away');
    fitAll();
  }

  map.on('click', (e) => {
    const pos = { lat: e.latlng.lat, lng: e.latlng.lng };
    for (const fn of [...mapHandlers]) fn(pos);
  });

  const subscribe = (set, fn) => { set.add(fn); return () => set.delete(fn); };

  // ---- follow me ----------------------------------------------------------------------------------------------
  function dispatchFollow(event) {
    const next = followReducer(follow, event);
    if (next === follow) return;
    follow = next;
    for (const fn of [...followHandlers]) { try { fn(follow.following); } catch { /* a listener must not break the map */ } }
  }
  map.on('dragstart', () => dispatchFollow('drag')); // only a finger on the map fires this, not a pan the app makes

  // ---- my position (blue dot, heading wedge) ----------------------------------------------------------------------
  let watching = false;

  function showMe(coords) {
    const me = meLayer.show(coords);
    if (me && follow.following) { // every new position: keep me in view, at the zoom the person has now
      map.panTo(viewTarget(me.lat, me.lng, map.getZoom()), { animate: true, duration: 0.6, noMoveStart: true });
    }
    return me;
  }

  function watchMe() {
    if (watching) return;
    try {
      navigator.geolocation.watchPosition((pos) => { try { showMe(pos.coords); } catch { /* keep the last dot */ } }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
      watching = true;
    } catch { /* no geolocation: nothing to keep fresh */ }
  }

  /** The Permissions API's state of 'geolocation' ('granted' | 'denied' | 'prompt'), or 'unknown' (no API, or no answer in 300 ms). Never rejects. */
  function geoPermissionState() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('unknown'), 300);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      try {
        navigator.permissions.query({ name: 'geolocation' }).then((r) => done(r.state), () => done('unknown'));
      } catch {
        done('unknown');
      }
    });
  }

  /** Resolves {lat,lng}, or null when location is denied / unavailable / slower than 8 s (a minute when the phone is still asking). Never throws or rejects. */
  function locate() {
    return geoPermissionState().then((state) => new Promise((resolve) => {
      // Permission already given or refused: 8 s. Not decided yet: the person may still be answering the phone's prompts (location, and on
      // iOS the motion sensors too), so wait up to a minute: a false "can't get your position" would also turn follow-me off.
      const waitMs = locateWaitMs(state);
      let timer;
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
      timer = setTimeout(() => finish(null), waitMs + 500); // some browsers ignore the `timeout` option while a permission prompt is open
      try {
        const geo = navigator.geolocation;
        if (!geo) { finish(null); return; }
        geo.getCurrentPosition(
          (pos) => { let me = null; try { me = showMe(pos.coords); if (me) watchMe(); } catch { me = null; } finish(me); },
          () => finish(null),
          { enableHighAccuracy: true, timeout: waitMs, maximumAge: 30000 },
        );
      } catch {
        finish(null);
      }
    }));
  }

  /**
   * The locate button. Following -> stop. Otherwise: ask for the compass (iOS only answers inside a tap, so this is the first thing
   * done), get my position, put it in the middle and follow it. -> {status: 'stopped' | 'following' | 'denied', pos}. Never throws.
   */
  async function pressLocate() {
    const wasFollowing = follow.following;
    dispatchFollow('press');
    if (wasFollowing) return { status: 'stopped', pos: meLayer.last() };
    meLayer.startCompass({ ask: true }).catch(() => {}); // synchronous part first: still inside the tap
    const pos = await locate();
    if (!follow.following) return { status: pos ? 'stopped' : 'denied', pos }; // tapped again, or dragged the map, while waiting
    if (!pos) { dispatchFollow('lost'); return { status: 'denied', pos: null }; }
    moveTo(pos.lat, pos.lng, 16); // not flyTo: that would end the follow it just started
    return { status: 'following', pos };
  }

  // Already allowed on this phone: show the blue dot right away, without a prompt and without moving the map. (An Android phone
  // needs no permission for the compass, so the wedge can show too; iOS asks at the first tap of the locate button.)
  try {
    navigator.permissions?.query({ name: 'geolocation' }).then((r) => {
      if (r.state !== 'granted') return;
      locate();
      meLayer.startCompass({ ask: false }).catch(() => {});
    }, () => {});
  } catch { /* Permissions API missing: the locate button still works */ }

  return {
    setPlaces,
    focus,
    flyTo,
    fitAll: fitEverything,
    setSelected,
    setNextStop,
    locate,
    pressLocate,
    onFollowChange: (fn) => subscribe(followHandlers, fn),
    isFollowing: () => follow.following,
    basemapMode: basemap.mode,
    onBasemapMode: basemap.onMode,
    lobeCount: lobes.count,
    meHeading: meLayer.heading,
    setViewShown: meLayer.setViewShown, // false while a full-height view covers the map (the compass listeners go off)
    compassListening: meLayer.listening,
    lastLocation: meLayer.last,
    onPinClick: (fn) => subscribe(pinHandlers, fn),
    onMapClick: (fn) => subscribe(mapHandlers, fn),
    pinCount: () => entries.size,
    getMap: () => map,
  };
}
