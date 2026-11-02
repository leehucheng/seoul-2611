// Boot and wiring of the main screen: config -> map -> "who am I" -> snapshot -> pins, chips, card.
//
// Later tasks plug in through the exported `app` object (also on window.seoulApp):
//   state     app.cfg, app.me, app.snapshot, app.places, app.purchases, app.translations, app.config,
//             app.stars (Set of ids), app.filter, app.map (initMap handle), app.fromCache, app.fetchedAt,
//             app.placesKept (App_Places was unreadable, the places shown are this phone's last good ones)
//   actions   app.actions.add / today / hotel (the tab bar calls these); today(dateISO?) and hotel(dateISO?) open the 今天 view /
//             the hotel card (app.openToday / app.openHotelCard); app.currentDate() is the date they use (see today-view.js);
//             app.currentNightDate() is the date the hotel lookup uses (before 06:00 still the night before)
//   data      app.applySnapshot({snapshot, fromCache, fetchedAt}) - for polling; app.reload() - fetch now;
//             app.addPlaceLocal(place) - show a just-saved place at once
//   ui        app.openPlace(id) / app.openPlaceCard(place) / app.closeCard(); app.showToast(text);
//             app.mapMode (set a string while picking a spot on the map so a tap on the map is not treated as
//             "dismiss the card"); app.on('snapshot'|'me'|'card'|'view', fn)
//             app.openAddPlace({mode, presetName, presetQuery, presetAlias, presetText}); app.openUnmapped() (the 未上地圖 view)
//             app.coverBottom() - px of the bottom of the screen a sheet other than the card covers (map insets)
//             app.currentView() -> 'map' | 'today' | 'hotel' | 'list' (the full-height view above the map, ui/panel.js);
//             app.closeView() shows the map; app.unmappedCount() is the number on the 未上地圖 tab
//   today     app.todayStops() -> my stops today (today-view.js item views of the lines that are mine; [] when I am not in Korea or the
//             Sheet has none);
//             app.doneSet(date) -> Set of the item keys ticked on this phone for that date; app.toggleDone(date, key) flips one and
//             emits 'done' (the 下一站 strip, the 今天 page and the card follow); app.ginkgo -> Set of the places on the 銀杏 tab;
//             app.switchPerson() opens the who-am-I picker
// Sync: startPolling(app.cfg, applySnapshot) runs from boot; a place saved here stays on the map until a snapshot has it.
import { fetchSnapshot, startPolling } from './api.js';
import { parseShareParams } from './add-place-logic.js';
import { CATEGORIES } from './categories.js';
import { TOKENS } from './colors.js';
import { readConfig } from './config.js';
import { loadDone, toggleDone } from './done.js';
import { ginkgoPlaceIds } from './ginkgo.js';
import { myItems } from './next-stop.js';
import { GINKGO_FILTER, categoryOf, hasCoords, isHidden, matchesFilter } from './place-view.js';
import { registerServiceWorker } from './register-sw.js';
import { parsePurchase } from './sheet-parse.js';
import { loadStars, toggleStar } from './stars.js';
import { cardSignature, createRefreshGate, isTextEntry, mergePending, statusLine } from './sync.js';
import { currentDate, currentNightDate, loadTripData, stopName, todayView } from './today-view.js';
import { initAddPlace } from './ui/add-place.js';
import { cardPlaceId, cardVisibleHeight, closeCard, openCard } from './ui/card.js';
import { append, clear, famStyle, h, icon } from './ui/dom.js';
import { initHotel } from './ui/hotel-card.js';
import { initMap } from './ui/map.js';
import { initNextBar } from './ui/nextbar.js';
import { closeView, currentView, onViewChange } from './ui/panel.js';
import { pickPerson, showMeButton } from './ui/person.js';
import { showSetup } from './ui/setup.js';
import { initTabbar } from './ui/tabbar.js';
import { initToday } from './ui/today-panel.js';
import { initUnmapped } from './ui/unmapped.js';

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

export const app = {
  storage: null,
  cfg: null,
  me: null,
  snapshot: null,
  places: [],
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

  placeById: (id) => app.places.find((p) => p.id === id) ?? null,
  /** Places that pass the category chip and are not hidden (they may still lack coordinates). */
  visiblePlaces: () => app.places.filter((p) => !isHidden(p) && matchesFilter(p, app.filter, app.ginkgo)),

  todayStops,
  doneSet,
  toggleDone: toggleDoneAndAnnounce,
  switchPerson: () => switchPerson(),
  showToast,
  currentView,
  closeView,
  closeCard,
  openPlace,
  openPlaceCard,
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
function showToast(text, ms = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
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

let chipSig = '';
function renderChips() {
  const inUse = new Set(app.places.filter((p) => !isHidden(p) && hasCoords(p)).map((p) => categoryOf(p.category).id));
  const shown = CATEGORIES.filter((c) => inUse.has(c.id) || c.id === app.filter);
  if (inUse.has('other') || app.filter === 'other') shown.push(categoryOf('other'));
  const sig = JSON.stringify([shown.map((c) => c.id), app.filter]);
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
  append(clear(box), [
    h('button', { class: 'fcap is-all', type: 'button', 'aria-pressed': String(app.filter === 'all'), onclick: () => choose('all') }, h('span', { class: 'fv' }, '全部')),
    mk(GINKGO_CHIP),
    shown.map(mk),
  ]);
  box.scrollLeft = scroll;
  box.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
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

// ---- pins and card ----------------------------------------------------------------------------------------

function refreshPins() {
  // `lobePlaces`: the yellow district shapes come from every place that is not hidden, not only from the ones the category filter lets through
  app.map?.setPlaces(app.visiblePlaces(), { me: app.me ?? '', starred: app.stars, ginkgo: app.ginkgo, translations: app.translations, lobePlaces: app.places });
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
    const trip = loadTripData(app.snapshot.tabs);
    if (!trip.ok) return [];
    const today = app.currentDate();
    const view = todayView(trip, app.me, today, { places: app.places, translations: app.translations, today, night: app.currentNightDate() });
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
  app.emit('places', place.id); // the 未上地圖 number on the tab bar: the name just put on the map is no longer missing from it
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
  app.places = merged.places;
  app.translations = isObject(snapshot.translations) ? snapshot.translations : {};
  app.config = isObject(snapshot.config) ? snapshot.config : {};
  try { app.purchases = parsePurchase(snapshot.tabs?.['Purchase list'] ?? []); } catch { app.purchases = []; }
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
// Offline support (sw.js). After the page has loaded, so the worker's downloads do not compete with the first draw.
if (document.readyState === 'complete') registerServiceWorker();
else window.addEventListener('load', () => registerServiceWorker(), { once: true });
