// Boot and wiring of the main screen: config -> map -> "who am I" -> snapshot -> pins, chips, card.
//
// Later tasks plug in through the exported `app` object (also on window.seoulApp):
//   state     app.cfg, app.me, app.snapshot, app.places, app.purchases, app.translations, app.config,
//             app.stars (Set of ids), app.filter, app.map (initMap handle), app.fromCache, app.fetchedAt,
//             app.placesKept (App_Places was unreadable, the places shown are this phone's last good ones)
//             The places of the July trip (source 'july', july-layer.js) are NOT in app.places: that is ours only, so the 今天 page, the 未上地圖
//             count, the first view and the district shapes never see a July place. They are app.julyPlaces, a layer of the map that is off by
//             default (app.julyOn(), per phone in localStorage `seoul.layer.july`; the 「7 月」 chip, app.setJulyLayer(on)): app.mapPlaces() is
//             what the map may draw (ours, and the July ones while the layer is on); app.placeById finds a July place too, app.openPlace(id) of
//             one turns the layer on first; app.emit('layer', {july}) after a switch
//   actions   app.actions.add / today / hotel (the tab bar calls these); today(dateISO?) and hotel(dateISO?) open the 今天 view /
//             the hotel card (app.openToday / app.openHotelCard); app.currentDate() is the date they use (see today-view.js);
//             app.currentNightDate() is the date the hotel lookup uses (before 06:00 still the night before)
//   data      app.applySnapshot({snapshot, fromCache, fetchedAt}) - for polling; app.reload() - fetch now;
//             app.addPlaceLocal(place) - show a just-saved place at once
//   ui        app.openPlace(id) / app.openPlaceCard(place) / app.closeCard(); app.showToast(text);
//             app.mapMode (set a string while picking a spot on the map so a tap on the map is not treated as
//             "dismiss the card"); app.on('snapshot'|'me'|'card'|'view', fn)
//             app.openAddPlace({mode, presetName, presetQuery, presetAlias, presetText, onAdded(place), onClose()}); app.revealMap(on) (the 今天 page's
//             editor asks for the map while it has the add form open); app.openUnmapped({from}) (the 未上地圖 view; from: 'lists'
//             adds 「← 清單」); app.openLists({focusRow}) (the 清單 view, the 5th tab: 代購, 行李, 未上地圖; ui/lists.js)
//             app.coverBottom() - px of the bottom of the screen a sheet other than the card covers (map insets)
//             app.currentView() -> 'map' | 'today' | 'hotel' | 'lists' | 'list' (the full-height view above the map, ui/panel.js; 'list' is the 未上地圖 view);
//             app.closeView() shows the map; app.unmappedCount() is the number on the 未上地圖 row of the 清單 view
//   today     app.todayStops() -> my stops today (today-view.js item views of the lines that are mine; [] when I am not in Korea or the
//             Sheet has none);
//             app.doneSet(date) -> Set of the item keys ticked on this phone for that date; app.toggleDone(date, key) flips one and
//             emits 'done' (the 下一站 strip, the 今天 page and the card follow); app.ginkgo -> Set of the places on the 銀杏 tab;
//             app.switchPerson() opens the who-am-I picker
//             app.packing -> the 行李清單 ticks of this phone (packing-ticks.js createPacking: count(), toggle(id), reset()); emits 'packing'
//           app.getVersion() -> Promise of the running build (sw.js BUILD), null without a worker or an answer; the 今天 page shows it
//           app.shopping -> the 代購清單 (ui/shopping.js initShopping): items(), mine(), apply(row), api; emits 'shopping' when the items change
//           app.trending -> the 熱門必買 list (ui/trending.js initTrending): load() reads data/trending.json the first time its screen opens, data(),
//             count(), group() / setGroup(id) (the chip kept on this phone); emits 'trending' once the file is read
//           app.schedule -> the itinerary kept in the app (ui/schedule.js initSchedule): rows(), version(date), saveDay(payload), resetDay(payload),
//             addPlace(place, date), api; every loadTripData call passes app.schedule.rows(); emits 'schedule' when the rows change. The 今天 page edits it
//             (ui/schedule-editor.js) and the place card's 「加入行程」 adds a place to a day (ui/day-picker.js)
// Start: once the person is picked, the 今天 view opens over the map (openStartView; not for an Android share, which opens the add form).
// Update: ui/update-bar.js shows 「新版本好了」 + 「更新」 above the tab bar when a new service worker takes over an already controlled page.
// Sync: startPolling(app.cfg, applySnapshot) runs from boot; a place saved here stays on the map until a snapshot has it.
import { fetchSnapshot, startPolling } from './api.js';
import { parseShareParams } from './add-place-logic.js';
import { TOKENS } from './colors.js';
import { readConfig } from './config.js';
import { loadDone, toggleDone } from './done.js';
import { chooseFirstView } from './first-view.js';
import { ginkgoPlaceIds } from './ginkgo.js';
import { findHotelPlace } from './hotel-view.js';
import { createJulyLayer, mapPlaces, splitJuly } from './july-layer.js';
import { myItems } from './next-stop.js';
import { GINKGO_FILTER, chipCategories, hasCoords, isHidden, isJulyPlace, matchesFilter } from './place-view.js';
import { registerServiceWorker } from './register-sw.js';
import { parsePurchase } from './sheet-parse.js';
import { loadStars, toggleStar } from './stars.js';
import { askVersion } from './sw-version.js';
import { cardSignature, createRefreshGate, isTextEntry, mergePending, statusLine } from './sync.js';
import { buildToday } from './today.js';
import { currentDate, currentNightDate, loadTripData, stopName, todayView } from './today-view.js';
import { initAddPlace } from './ui/add-place.js';
import { cardPlaceId, cardVisibleHeight, closeCard, openCard } from './ui/card.js';
import { openDayPicker } from './ui/day-picker.js';
import { append, clear, famStyle, h, icon } from './ui/dom.js';
import { initHotel } from './ui/hotel-card.js';
import { initLists } from './ui/lists.js';
import { initMap } from './ui/map.js';
import { describeNext, initNextBar } from './ui/nextbar.js';
import { initPacking } from './ui/packing.js';
import { closeView, currentView, onViewChange } from './ui/panel.js';
import { pickPerson, showMeButton } from './ui/person.js';
import { showSetup } from './ui/setup.js';
import { initSchedule } from './ui/schedule.js';
import { initShopping } from './ui/shopping.js';
import { initTabbar } from './ui/tabbar.js';
import { initTrending } from './ui/trending.js';
import { initToday } from './ui/today-panel.js';
import { initUnmapped } from './ui/unmapped.js';
import { initUpdateBar } from './ui/update-bar.js';

const $ = (id) => document.getElementById(id);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** localStorage, or an in-memory stand-in when the browser blocks site data (private mode). */
function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem('seoul.probe');
    return s;
  } catch {
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  }
}

const listeners = new Map();
const versionAsked = askVersion(); // asked once, as the page loads: which build the service worker that controls this page runs (null: none / no answer)

export const app = {
  storage: null,
  cfg: null,
  me: null,
  snapshot: null,
  places: [],
  julyPlaces: [], // the places whose source is 'july': a layer of the map, off by default (see the header)
  julyLayer: null, // createJulyLayer(storage), once the storage is known (boot)
  purchases: [],
  translations: {},
  config: {},
  stars: new Set(),
  ginkgo: new Set(), // ids of the places the Sheet's 銀杏 tab lists (ginkgo.js)
  filter: 'all',
  map: null,
  fromCache: false,
  placesKept: false,
  fetchedAt: null,
  loading: false,
  mapMode: null,
  actions: {},
  coverBottom: () => 0, // the add-place sheet replaces this while it is open
  /** The date the app treats as today: Seoul's date, or `?debug=1&date=YYYY-MM-DD` from the address (testing only). */
  currentDate: () => currentDate(new Date(), window.location.search),
  /** The night the hotel lookup uses: the Seoul date of (now - 6 h), so 00:00-06:00 is still last night; the debug date is never shifted. */
  currentNightDate: () => currentNightDate(new Date(), window.location.search),
  /** The build this page runs (sw.js BUILD) as a Promise: a string, or null with no worker or no answer within 2 s. The 今天 page shows it. */
  getVersion: () => versionAsked,

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try { fn(payload); } catch (e) { console.error(e); }
    }
  },

  placeById: (id) => app.places.find((p) => p.id === id) ?? app.julyPlaces.find((p) => p.id === id) ?? null,
  /** Is the 「7 月」 layer on (this phone's choice, off until it is pressed)? */
  julyOn: () => Boolean(app.julyLayer?.isOn()),
  /** What the map may draw: our places, and the July ones while their layer is on. */
  mapPlaces: () => mapPlaces(app.places, app.julyPlaces, app.julyOn()),
  /** Places that pass the category chip and are not hidden (they may still lack coordinates). */
  visiblePlaces: () => app.mapPlaces().filter((p) => !isHidden(p) && matchesFilter(p, app.filter, app.ginkgo)),

  todayStops,
  doneSet,
  toggleDone: toggleDoneAndAnnounce,
  switchPerson: () => switchPerson(),
  showToast,
  revealMap,
  currentView,
  closeView,
  closeCard,
  openPlace,
  openPlaceCard,
  setJulyLayer,
  applySnapshot,
  addPlaceLocal,
  async reload() {
    const result = await fetchSnapshot(app.cfg, { storage: app.storage });
    applySnapshot(result);
    return result;
  },
};

// ---- small UI pieces ----------------------------------------------------------------------------------------

let toastTimer = 0;
/** `action` ({label, onClick}) puts a button in the toast (「已加到 11/7」 + 「去看看」); a press runs it and puts the toast away. */
function showToast(text, ms = 3200, action = null) {
  const el = $('toast');
  el.textContent = text;
  if (action) {
    el.append(h('button', { class: 'toast-act', type: 'button', onclick: () => { el.classList.remove('is-on'); clearTimeout(toastTimer); action.onClick(); } }, action.label));
  }
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

/**
 * While the 今天 page's place picker has the add form open (「地圖上沒有？新增地點」), the form's 「在地圖上點」 needs the map: the full-height view and the screens of the
 * editor step aside (html.map-reveal, css/app.css) and the MAP answers taps again; `false` puts everything back as it was. Only the map: the 下一站 strip, the chips
 * and 定位 stay out of reach (a tap on the strip would open a card, or the 今天 page, under the editor). A pin tap is ignored while the add form is open (app.mapMode).
 */
function revealMap(on) {
  document.documentElement.classList.toggle('map-reveal', on);
  if (on) $('map').inert = false;
  else setMapInert(currentView());
}

function showFatal(title, message, { retry = true } = {}) {
  const el = $('fatal');
  clear(el).append(h('div', { class: 'fatal-box' },
    icon('i-alert', 'fatal-ico'),
    h('h1', { class: 'fatal-title' }, title),
    h('p', { class: 'fatal-msg' }, message),
    retry ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => window.location.reload() }, '重新載入') : null));
  el.hidden = false;
}

function renderStatus() {
  const el = $('status');
  const line = statusLine({
    loading: app.loading,
    fromCache: app.fromCache,
    time: app.fetchedAt ? hhmm.format(new Date(app.fetchedAt)) : '',
    placesError: Boolean(app.snapshot?.placesError),
    placesKept: app.placesKept,
  });
  el.hidden = line === null;
  clear(el);
  if (line !== null) append(el, [line.iconId ? icon(line.iconId) : null, line.text]);
}

const comingSoon = (what) => () => showToast(`「${what}」還沒開放，馬上就有`);
Object.assign(app.actions, { add: comingSoon('新增地點') }); // add, today and hotel are set by initAddPlace / initToday / initHotel below

/** While a full-height view covers the map, the map, the chips and 定位 are out of reach for the keyboard and screen readers too. */
function setMapInert(view) {
  for (const el of [$('map'), document.querySelector('.top'), $('locate-btn')]) if (el) el.inert = view !== 'map';
}

/**
 * 定位 + 跟著我: the first tap puts me in the middle and follows me (the button turns ink with a yellow arrow and the 「跟著我」
 * capsule shows); a tap while following, or dragging the map, stops it. The map decides (ui/map.js, follow.js); this shows the state.
 */
function showFollow(on) {
  const btn = $('locate-btn');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? '跟著我：地圖隨我的位置移動，點一下停止' : '定位到我的位置');
  btn.querySelector('use')?.setAttribute('href', on ? '#i-nav' : '#i-locate');
  $('follow-cap').hidden = !on;
}

async function onLocate(btn) {
  if (!app.map || btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  const { status } = await app.map.pressLocate(); // never throws; 'denied' when the position is refused, unavailable or too slow
  btn.removeAttribute('aria-busy');
  if (status === 'denied') showToast('取不到你的位置。到瀏覽器設定允許定位；地圖其他功能照常可用。', 4500);
}

// ---- chips ------------------------------------------------------------------------------------------------

/** The 銀杏 capsule: a ginkgo-yellow dot with the line ginkgo leaf (the Sheet's 銀杏 tab: ginkgo spots and ginkgo cafes). */
const GINKGO_CHIP = Object.freeze({ id: GINKGO_FILTER, short: '銀杏', icon: 'i-ginkgo', color: TOKENS.ginkgo, on: TOKENS.ink, label: '銀杏：銀杏景點與銀杏咖啡廳' });

/** The 「7 月」 capsule's spoken label: a switch for the layer of the July trip's places (not a category filter; it combines with them). */
const JULY_CHIP_LABEL = '7 月清單：顯示 7 月那趟的地點，淡色圖釘';

let chipSig = '';
/** `keepScroll`: leave the row where it is (the 「7 月」 switch must not move the row under the finger that pressed it). */
function renderChips({ keepScroll = false } = {}) {
  const shown = chipCategories(app.mapPlaces(), app.filter); // the July places count only while their layer is on
  const sig = JSON.stringify([shown.map((c) => c.id), app.filter, app.julyOn()]);
  if (sig === chipSig) return;
  chipSig = sig;

  const box = $('chips');
  const scroll = box.scrollLeft;
  const choose = (id) => { app.filter = id; refreshPins(); renderChips(); app.emit('filter', app.filter); };
  const mk = (cat) => {
    const btn = h('button', { class: 'fcap', type: 'button', 'aria-pressed': String(app.filter === cat.id), 'aria-label': cat.label, onclick: () => choose(app.filter === cat.id ? 'all' : cat.id) },
      h('span', { class: 'fv' }, h('span', { class: 'fdot' }, icon(cat.icon)), cat.short));
    return famStyle(btn, cat); // the capsule fills with the family colour when pressed; the dot always shows it
  };
  const july = h('button', { class: 'fcap fcap--july', type: 'button', 'aria-pressed': String(app.julyOn()), 'aria-label': JULY_CHIP_LABEL, onclick: () => setJulyLayer(!app.julyOn()) },
    h('span', { class: 'fv' }, h('span', { class: 'fdot' }, icon('i-calendar')), '7 月'));
  append(clear(box), [
    h('button', { class: 'fcap is-all', type: 'button', 'aria-pressed': String(app.filter === 'all'), onclick: () => choose('all') }, h('span', { class: 'fv' }, '全部')),
    mk(GINKGO_CHIP),
    july,
    shown.map(mk),
  ]);
  box.scrollLeft = scroll;
  if (!keepScroll) box.querySelector('.fcap[aria-pressed="true"]:not(.fcap--july)')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  fadeChips();
}

/** Height (px) of the map's bottom strip (the scale capsule over the credit line, with their gaps); 0 until the map has made it. */
function bottomStrip() {
  const strip = document.querySelector('.leaflet-bottom.leaflet-left');
  return strip ? Math.ceil(strip.getBoundingClientRect().height) + 4 : 0;
}

/** The chip row fades out at an edge that has more chips beyond it (css/app.css .filters), on a phone and on a wide window alike. */
function fadeChips() {
  const box = $('chips');
  if (!box) return;
  const room = box.scrollWidth - box.clientWidth;
  box.classList.toggle('fade-l', box.scrollLeft > 4);
  box.classList.toggle('fade-r', box.scrollLeft < room - 4);
}

// ---- the 7 月 layer ---------------------------------------------------------------------------------------

/**
 * Switch the layer of the July trip's places (the 「7 月」 chip, or opening one of them from the add form's search). It is a state of its own,
 * not a category filter, so the category capsules keep working and combine with it. Switching it off while a July place's card is open
 * closes that card (the pin it belongs to is gone). The choice is kept on this phone (july-layer.js).
 */
function setJulyLayer(on) {
  if (!app.julyLayer?.set(on)) return;
  if (!app.julyOn()) {
    const open = cardPlaceId();
    if (open && isJulyPlace(app.placeById(open))) closeCard();
  }
  renderChips({ keepScroll: true });
  refreshPins();
  app.emit('layer', { july: app.julyOn() });
}

// ---- pins and card ----------------------------------------------------------------------------------------

function refreshPins() {
  // `lobePlaces`: the yellow district shapes come from every place of ours that is not hidden, not only from the ones the category filter lets
  // through (app.places has no July place: the layer never reshapes a district)
  // `firstView`: asked only when the map makes its first view (first-view.js), so nothing is computed on the later refreshes
  app.map?.setPlaces(app.visiblePlaces(), { me: app.me ?? '', starred: app.stars, ginkgo: app.ginkgo, translations: app.translations, lobePlaces: app.places, firstView });
}

/** What the map opens on: the district of today's next stop (else of tonight's hotel), or the busiest area; the pin that chose it stays in frame (first-view.js). */
function firstView() {
  let next = null;
  let hotel = null;
  try { next = describeNext(app)?.place ?? null; } catch { /* no today's stops: the hotel, then the busiest area */ }
  try {
    const stay = app.snapshot ? buildToday(loadTripData(app.snapshot.tabs, app.schedule?.rows()), app.me, app.currentNightDate()).hotel : null;
    hotel = stay ? findHotelPlace(stay.name, app.places) : null;
  } catch { /* no hotel for tonight */ }
  return chooseFirstView({ places: app.places, next, hotel });
}

/** The places the Sheet's 銀杏 tab lists, for the 銀杏 capsule and the leaf on the pins. */
function refreshGinkgo() {
  try { app.ginkgo = ginkgoPlaceIds(app.snapshot?.tabs, app.places); } catch { app.ginkgo = new Set(); }
}

// ---- today: my stops, what is ticked off ------------------------------------------------------------------

/**
 * My stops today (today-view.js item views): the Sheet's lines of the day that are mine (next-stop.js myItems: a line that names people
 * and not me is theirs). [] before I am picked, before the data is in, when I am not in Korea today, or when the Sheet has none.
 */
function todayStops() {
  if (!app.snapshot || !app.me) return [];
  try {
    const trip = loadTripData(app.snapshot.tabs, app.schedule?.rows());
    if (!trip.ok) return [];
    const today = app.currentDate();
    const view = todayView(trip, app.me, today, { places: app.places, translations: app.translations, today, night: app.currentNightDate(), named: app.julyPlaces });
    return view.status === 'in' ? myItems(view.items, app.me) : [];
  } catch {
    return [];
  }
}

const doneSets = new Map(); // date -> Set of the item keys ticked on this phone
function doneSet(date) {
  if (!doneSets.has(date)) doneSets.set(date, loadDone(app.storage, date));
  return doneSets.get(date);
}
function toggleDoneAndAnnounce(date, key) {
  const on = toggleDone(doneSet(date), key, date, app.storage);
  app.emit('done', { date, key, on });
  return on;
}

/** The card's 前一站 / 今天第 N 站 / 下一站 strip: where this place sits in my stops today; null when it is not one of them. */
function stopStrip(place) {
  const stops = todayStops();
  const k = stops.findIndex((s) => s.placeId === place.id);
  if (k < 0) return null;
  const view = (s) => (s ? { name: stopName(s, s.placeId ? app.placeById(s.placeId) : null, app.translations), time: s.time, placeId: s.placeId } : null);
  return { index: k, total: stops.length, time: stops[k].time, prev: view(stops[k - 1]), next: view(stops[k + 1]) };
}

function cardContext(place) {
  return {
    person: app.me,
    purchases: app.purchases,
    config: app.config,
    translations: app.translations,
    starred: app.stars.has(place.id),
    strip: stopStrip(place), // 前一站 / 今天第 N 站 / 下一站, or null when this place is not one of my stops today
    here: () => app.map?.lastLocation() ?? null, // my position, when the phone has given one (the distance row only shows then)
    openStop(id) { // the strip's previous / next stop: its card, or the 今天 page when it has no pin
      if (!openPlace(id)) app.actions.today();
    },
    addToSchedule(p, trigger) { // 「加入行程」: the day picker over the card (the card and the tab bar go inert while it is open)
      openDayPicker(app, p, { trigger, behind: [document.querySelector('.sheet'), $('tabbar')] });
    },
    toggleStar(id) {
      const on = toggleStar(app.stars, id, app.storage);
      refreshPins();
      return on;
    },
    onClose() {
      cardGate.cancel();
      app.map?.setSelected(null);
      app.emit('card', null);
    },
  };
}

/** Open the card for any place, with or without coordinates (hotel card, today panel). No pin focus. */
function openPlaceCard(place) {
  if (!place) return;
  cardGate.cancel(); // a redraw that was waiting belonged to the card shown before
  app.map?.setSelected(place.id);
  openCard(place, cardContext(place));
  app.emit('card', place.id);
}

/** Open a place by id and bring its pin into the part of the map the card does not cover. */
function openPlace(id, { focus = true } = {}) {
  const place = app.placeById(id);
  if (!place || isHidden(place)) return false;
  if (isJulyPlace(place) && !app.julyOn()) setJulyLayer(true); // a July place found by name: its layer comes on, so there is a pin to fly to
  if (focus && hasCoords(place) && !matchesFilter(place, app.filter, app.ginkgo)) { // a filter capsule hides this pin: show everything so there is a pin to fly to
    app.filter = 'all';
    renderChips();
    refreshPins();
    app.emit('filter', 'all');
  }
  openPlaceCard(place);
  if (focus && hasCoords(place)) app.map?.focus(id);
  return true;
}

let pending = new Map(); // places saved from this phone that the next snapshots may not contain yet (sync.js)

function addPlaceLocal(place) {
  if (!place?.id) return;
  pending.set(place.id, { place, at: Date.now() });
  app.places = [...app.places.filter((p) => p.id !== place.id), place];
  refreshGinkgo();
  if (!matchesFilter(place, app.filter, app.ginkgo)) { app.filter = 'all'; app.emit('filter', 'all'); } // the new pin must not hide behind a chip
  renderChips();
  refreshPins();
  app.emit('places', place.id); // the 未上地圖 row on the 清單 view: the name just put on the map is no longer missing from it
}

/** Redraw the open card with fresh data; it stays open, peeking or expanded as it was, and a typed amount is kept. */
function refreshOpenCard(place, old) {
  const amount = $('split-amount')?.value ?? '';
  const desc = $('split-desc')?.value ?? '';
  const sameName = ['name_zh', 'name_kr', 'name_en'].every((k) => (old?.[k] ?? '') === (place[k] ?? '')); // else the default description changed too
  openCard(place, cardContext(place), { keepState: true });
  if (amount && $('split-amount')) $('split-amount').value = amount;
  if (sameName && desc && $('split-desc')) $('split-desc').value = desc;
}

// A redraw replaces the card's DOM, which would take focus, caret and the phone's keyboard away from someone typing
// in 記一筆. So while a field inside the card has focus the redraw waits, and runs when focus leaves the field.
const cardGate = createRefreshGate({
  isTyping: () => {
    const el = document.activeElement;
    return isTextEntry(el) && Boolean(el.closest?.('.sheet'));
  },
  refresh(old) {
    const id = cardPlaceId();
    if (!id) return;
    const p = app.placeById(id);
    if (!p || isHidden(p)) closeCard(); else refreshOpenCard(p, old);
  },
});

function applySnapshot({ snapshot, fromCache, fetchedAt, placesKept }) {
  const openId = cardPlaceId();
  const oldPlace = openId ? app.placeById(openId) : null;
  const before = openId ? cardSignature(oldPlace, app) : null;

  app.snapshot = snapshot;
  app.fromCache = Boolean(fromCache);
  app.placesKept = Boolean(placesKept); // the server could not read App_Places: the places shown are the phone's last good ones
  app.fetchedAt = fetchedAt ?? null;
  const merged = mergePending(Array.isArray(snapshot.places) ? snapshot.places : [], pending);
  pending = merged.pending;
  const { own, july } = splitJuly(merged.places); // the July trip's places are a layer of their own, never in app.places
  app.places = own;
  app.julyPlaces = july;
  app.translations = isObject(snapshot.translations) ? snapshot.translations : {};
  app.config = isObject(snapshot.config) ? snapshot.config : {};
  try { app.purchases = parsePurchase(snapshot.tabs?.['Purchase list'] ?? []); } catch { app.purchases = []; }
  app.schedule?.sync(); // the days kept in the app, before the pins and the first view are made (firstView asks for tonight's / today's stops), as app.places is
  refreshGinkgo();
  app.loading = false;
  renderChips();
  refreshPins();
  renderStatus();
  if (openId) {
    const p = app.placeById(openId);
    if (!p || isHidden(p)) closeCard();
    else if (cardSignature(p, app) !== before) cardGate.request(oldPlace); // only when something changed, and not under someone typing
  }
  app.emit('snapshot', snapshot);
}

// ---- boot -------------------------------------------------------------------------------------------------

async function switchPerson() {
  const name = await pickPerson(app.storage, { force: true });
  if (name === app.me) return;
  app.me = name;
  showMeButton($('me-btn'), name);
  refreshPins();
  const open = cardPlaceId();
  if (open) openPlaceCard(app.placeById(open)); // redraw: "跟我有關" depends on who is looking
  app.emit('me', name);
}

async function boot() {
  const storage = app.storage ?? safeStorage(); // boot runs again after the paste box: keep the same storage (an in-memory one in private mode)
  app.storage = storage;
  const hash = window.location.hash;
  const cfg = readConfig(hash, storage);
  if (!cfg.api) {
    showSetup($('fatal'), { storage, onConfig: start }); // paste box; the pasted link is saved by configFromInput, so boot finds it
    return;
  }
  if (/(^|[#&])(a|k)=/.test(hash)) history.replaceState(null, '', window.location.pathname + window.location.search); // the key stays in localStorage, not in the address bar
  app.cfg = cfg;
  app.stars = loadStars(storage);
  app.julyLayer = createJulyLayer(storage); // off unless this phone switched it on (seoul.layer.july)

  try {
    app.map = initMap($('map'), {
      insets: () => ({ // screen space the top strip and what sits at the bottom (tab bar, place card, add form) cover
        top: Math.ceil(document.querySelector('.top').getBoundingClientRect().bottom),
        // the map's own bottom strip (the scale over the credit line) rides on top of the bar or the card: pins and their names stay out of it
        bottom: Math.max(Math.ceil(window.innerHeight - $('tabbar').getBoundingClientRect().top), cardVisibleHeight(), app.coverBottom()) + bottomStrip(),
      }),
    });
  } catch (e) {
    console.error(e);
    showFatal('地圖載入失敗', '地圖元件沒有載入，可能是沒有網路。連上網路後重新載入。');
    return;
  }
  app.map.onPinClick((id) => { if (!app.mapMode) openPlace(id); }); // while a place is being added, pins are not tapped open
  app.map.onMapClick(() => { if (!app.mapMode) closeCard(); });

  $('chips').addEventListener('scroll', fadeChips, { passive: true });
  window.addEventListener('resize', fadeChips);
  app.map.onFollowChange(showFollow);
  $('locate-btn').addEventListener('click', () => onLocate($('locate-btn')));
  $('me-btn').addEventListener('click', switchPerson);
  onViewChange((view) => { setMapInert(view); app.map?.setViewShown(view === 'map'); app.emit('view', view); }); // a full-height view opened / closed: the tab bar and the map follow
  // typing in the card stopped: run a redraw that was held back. Not at once: the tap that moved focus away may be on a
  // button of the card, and replacing the card between its press and release would swallow that tap.
  document.addEventListener('focusout', () => setTimeout(() => cardGate.flush(), 400));
  initAddPlace(app); // replaces app.actions.add
  initUnmapped(app); // app.openUnmapped, app.unmappedCount
  initPacking(app); // app.packing: what is ticked on the 行李清單 (the 今天 page's card on the first and last trip day)
  initShopping(app); // app.shopping: the 代購清單 items (snapshot.shopping + what this phone saved) and the calls that write them
  initSchedule(app); // app.schedule: the rows of the itinerary kept in the app (snapshot.schedule + what this phone saved) and the calls that write them
  initTrending(app); // app.trending: the 熱門必買 file (read when its screen first opens) and the group chip kept on this phone
  initLists(app); // app.openLists: the 清單 tab's view (代購清單, 行李清單, 未上地圖, 熱門必買)
  initToday(app); // replaces app.actions.today
  initHotel(app); // replaces app.actions.hotel
  initTabbar(app); // the bottom tab bar calls the hooks above
  initNextBar(app); // the 下一站 strip: shows once a person and a snapshot are in

  app.loading = true;
  renderStatus();
  const snapshotPromise = fetchSnapshot(cfg, { storage }); // starts now, while the person picker may be open
  snapshotPromise.catch(() => {}); // handled below; keeps a slow picker from raising an unhandled rejection

  app.me = await pickPerson(storage);
  showMeButton($('me-btn'), app.me);
  openStartView(); // before the snapshot is awaited: the 今天 view says 「正在讀行程…」 and fills itself when it arrives

  let first;
  try {
    first = await snapshotPromise;
  } catch {
    app.loading = false;
    renderStatus();
    showFatal('連不上資料', '現在沒有網路，這支手機也還沒存過資料。連上網路後重新載入。');
    return;
  }
  applySnapshot(first);
  app.stopPolling = startPolling(cfg, applySnapshot); // every 45 s while the page is visible, and when it becomes visible again
  openSharedPlace();
}

/**
 * What the app opens on, once the person is picked: the 今天 view (today's page inside the trip, the 全程總覽 outside it; ui/today-panel.js).
 * The map has been set up behind it as always and is what the 地圖 tab shows. An Android share goes to the add form instead (openSharedPlace),
 * so with share parameters in the address the 今天 view is not opened.
 */
function openStartView() {
  if (parseShareParams(window.location.search).hadShare) return;
  app.actions.today();
}

/** Android share target: `?share_text=` / `share_url=` / `share_title=` -> the add form with that text resolved. Then the address is cleaned. */
function openSharedPlace() {
  const share = parseShareParams(window.location.search);
  if (!share.hadShare) return;
  history.replaceState(null, '', window.location.pathname + share.search + window.location.hash);
  if (share.text) app.actions.add({ presetText: share.text });
}

function start() {
  boot().catch((e) => {
    console.error(e);
    showFatal('出了點問題', '網頁沒有正常啟動，重新載入看看。');
  });
}

window.seoulApp = app;
start();
initUpdateBar(); // 「新版本好了」 when a new worker takes over a page that had one at load; before the registration below, so the load-time controller is seen
// Offline support (sw.js). After the page has loaded, so the worker's downloads do not compete with the first draw.
if (document.readyState === 'complete') registerServiceWorker();
else window.addEventListener('load', () => registerServiceWorker(), { once: true });
