// New-place form: a bottom sheet over the map.
//   1. one box at the top: paste a Google / Naver Map link (or a whole share text) -> resolveLink,
//      or type a name -> searchPlace (the name as typed and, in Seoul, also with the nearest district's name: place-input.js planSearch)
//      and pick one of <= 8 results, nearest first with the distance (a pin is previewed on the map);
//   2. 店名 (required), 分類, 備註;
//   3. a position when nothing was picked: 「我現在的位置」 or 「在地圖上點」.
// Nothing is guessed: a place without a chosen position is not sent (a wrong pin is worse than a missing one).
//
// const openAddPlace = initAddPlace(app);
// openAddPlace({mode: 'gps'|'tap', presetName, presetQuery, presetAlias, presetText})
//   mode         which position button is emphasised (it never fills a position by itself)
//   presetText   goes into the search box and is resolved / searched at once (share target)
//   presetName   suggested 店名 (kept even when a result is picked); presetQuery the text to search (default presetName)
//   presetAlias  string | string[] stored in `aliases`, so the Sheet's own wording finds the new pin
import { addPlace, resolveLink, searchPlace } from '../api.js';
import {
  MSG, buildAliases, buildPayload, errorMessage, findSavedDuplicate, nameFromPick, noResultsMessage, searchResultView,
} from '../add-place-logic.js';
import { CATEGORIES } from '../categories.js';
import { holdBack } from '../back-stack.js';
import { hasHangul } from '../i18n.js';
import { MAX_MERGED, classifyPlaceInput, collectSearches, formatDistance, mergeResults, planSearch } from '../place-input.js';
import { append, clear, famStyle, h, icon, sheetEdge } from './dom.js';
import { createPreviewPin } from './preview-pin.js';

const root = () => document.documentElement;
const clean = (v) => String(v ?? '').trim();
const MAX_RESULTS = MAX_MERGED; // the two searches of a name (place-input.js planSearch) together

/** A string and, when it is Korean and a Chinese line is known, that line under it (the `.tx` / `.zh` pattern of the card). */
function twoLine(text, zh) {
  const korean = hasHangul(text);
  const tx = h('span', { class: 'tx' }, h('span', { class: korean ? 'kr' : undefined, lang: korean ? 'ko' : undefined }, text));
  if (zh) tx.append(h('span', { class: 'zh' }, zh));
  return tx;
}

export function initAddPlace(app) {
  const preview = createPreviewPin(app.map);
  let current = null;

  function openAddPlace(opts = {}) {
    const hasPreset = Boolean(opts.presetText || opts.presetName || opts.presetQuery);
    if (current) {
      if (!hasPreset) { current.focus(); return current; } // the + button while the form is already open
      current.close(); // a new name to add: start over
    }
    app.closeCard();
    current = createForm(app, preview, opts, () => { current = null; });
    return current;
  }

  app.actions.add = (opts) => openAddPlace(opts ?? {});
  app.openAddPlace = openAddPlace;
  app.coverBottom = () => (current ? current.height() : 0);
  app.on('card', (id) => { if (id && current) current.close({ keepSheetVars: true }); }); // a place card takes over the bottom of the screen
  return openAddPlace;
}

function createForm(app, preview, opts, onClosed) {
  const st = {
    pick: null, // the chosen search / link result
    results: [], // the last search results (shown again by 重選)
    loc: null, // {lat, lng, source: 'pick' | 'gps' | 'tap'}
    category: '',
    nameTouched: false,
    submitting: false,
    unsure: false, // an add failed on the network: the button re-checks the server instead of posting again
    lastPayload: null,
    picking: false,
    locating: false,
    seq: 0, // search counter: an answer for an older search is dropped
    closed: false,
  };
  const suggested = opts.mode === 'tap' ? 'tap' : 'gps';
  let offMap = () => {};
  let releaseBack = () => {}; // gives back the history entry the open form holds (back-stack.js)

  // ---- search block ---------------------------------------------------------------------------------------
  const q = h('textarea', {
    id: 'as-q', class: 'field as-q', rows: '2', maxlength: '2000', enterkeyhint: 'search',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'as-q-msg',
    placeholder: '貼 Google Map／Naver Map 連結，或打店名搜尋',
  });
  const goBtn = h('button', { class: 'btn btn--primary as-go', type: 'submit' });
  const qMsg = h('p', { id: 'as-q-msg', class: 'field-error as-msg', role: 'alert' });
  const resultsBox = h('div', { class: 'as-results-box' });
  const pickedBox = h('div', { class: 'as-picked-box' });
  const searchForm = h('form', { class: 'as-search', novalidate: true },
    h('label', { class: 'field-label', for: 'as-q' }, '搜尋店家'),
    h('div', { class: 'as-search-row' }, q, goBtn),
    qMsg, resultsBox, pickedBox);

  // ---- name, category, note -------------------------------------------------------------------------------
  const nameInput = h('input', {
    id: 'as-name', class: 'field', type: 'text', maxlength: '80', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: '中文或韓文都可以', 'aria-required': 'true', 'aria-describedby': 'as-name-msg',
  });
  const nameMsg = h('p', { id: 'as-name-msg', class: 'field-error', role: 'alert' });
  const catButtons = CATEGORIES.map((c) => {
    const b = famStyle(h('button', { class: 'as-cat', type: 'button', 'aria-pressed': 'false', 'data-cat': c.id }, h('span', { class: 'fdot fdot--sm' }, icon(c.icon)), h('span', null, c.label)), c);
    b.addEventListener('click', () => setCategory(st.category === c.id ? '' : c.id));
    return b;
  });
  const noteInput = h('input', { id: 'as-note', class: 'field', type: 'text', maxlength: '200', autocomplete: 'off', enterkeyhint: 'done', placeholder: '例如：要排隊、只收現金（可不填）' });

  // ---- position -------------------------------------------------------------------------------------------
  const locStatus = h('p', { class: 'as-loc-status', id: 'as-loc-status' });
  const locMsg = h('p', { class: 'field-error', role: 'alert' });
  const gpsBtn = h('button', { class: `btn btn--ghost as-loc-btn${suggested === 'gps' ? ' is-suggested' : ''}`, type: 'button' }, icon('i-locate'), '我現在的位置');
  const tapBtn = h('button', { class: `btn btn--ghost as-loc-btn${suggested === 'tap' ? ' is-suggested' : ''}`, type: 'button' }, icon('i-pin'), '在地圖上點');
  const locBox = h('div', { class: 'as-loc' },
    h('p', { class: 'field-label' }, '位置'), locStatus,
    h('div', { class: 'as-loc-btns' }, gpsBtn, tapBtn), locMsg);

  // ---- the sheet ------------------------------------------------------------------------------------------
  const head = h('div', { class: 'as-head' },
    h('h2', { id: 'as-title', class: 'as-title' }, '新增地點'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '關閉', onclick: () => close() }, icon('i-close')));
  const body = h('div', { class: 'as-body' },
    searchForm,
    h('div', { class: 'as-field' }, h('label', { class: 'field-label', for: 'as-name' }, '店名（必填）'), nameInput, nameMsg),
    h('div', { class: 'as-field' }, h('p', { class: 'field-label', id: 'as-cat-label' }, '分類'), h('div', { class: 'as-cats', role: 'group', 'aria-labelledby': 'as-cat-label' }, catButtons)),
    h('div', { class: 'as-field' }, h('label', { class: 'field-label', for: 'as-note' }, '備註'), noteInput),
    locBox);
  const footMsg = h('p', { class: 'field-error as-foot-msg', role: 'alert' });
  const submitBtn = h('button', { class: 'btn btn--primary as-submit', type: 'button' });
  const foot = h('div', { class: 'as-foot' }, footMsg, submitBtn);
  const pickText = h('span', { class: 'as-pick-text' }, '在地圖上點要放的位置');
  const pickbar = h('div', { class: 'as-pickbar', hidden: true }, icon('i-pin'), pickText,
    h('button', { class: 'btn btn--ghost as-pick-cancel', type: 'button', onclick: () => exitPick() }, '取消'));
  const sheet = h('section', { class: 'addsheet', role: 'dialog', 'aria-labelledby': 'as-title', tabindex: '-1' }, sheetEdge(), head, body, foot, pickbar);

  // ---- small renderers ------------------------------------------------------------------------------------
  const setMsg = (el, text, tone = 'error') => {
    el.textContent = text;
    el.classList.toggle('is-note', tone === 'note');
  };
  const setQMsg = (text, tone) => setMsg(qMsg, text, tone);

  function renderGo(busy = false) {
    clear(goBtn);
    goBtn.disabled = busy;
    goBtn.setAttribute('aria-busy', String(busy));
    append(goBtn, [icon('i-search'), busy ? '搜尋中…' : '搜尋']);
  }

  function renderSubmit(label) {
    clear(submitBtn);
    submitBtn.disabled = st.submitting;
    submitBtn.setAttribute('aria-busy', String(st.submitting));
    if (st.submitting) submitBtn.append(label ?? '新增中…');
    else if (st.unsure) submitBtn.append('重新整理確認');
    else submitBtn.append(icon('i-plus'), '新增到地圖');
  }

  function renderLoc() {
    const l = st.loc;
    const text = !l ? '還沒選位置' : l.source === 'pick' ? '用搜尋結果的位置' : l.source === 'gps' ? '我現在的位置' : '地圖上點的位置';
    locStatus.classList.toggle('is-set', Boolean(l));
    clear(locStatus);
    append(locStatus, [icon(l ? 'i-check' : 'i-pin'), text]);
  }

  function renderPicked() {
    clear(pickedBox);
    if (!st.pick) return;
    const v = searchResultView(st.pick, app.translations);
    pickedBox.append(h('div', { class: 'as-picked' },
      icon('i-check', 'as-picked-ico'),
      h('div', { class: 'as-picked-body' }, twoLine(v.name, v.nameZh), v.address ? h('div', { class: 'as-addr' }, twoLine(v.address, v.addressZh)) : null),
      h('button', { class: 'as-link', type: 'button', onclick: unpick }, '重選')));
  }

  function showResults(list) {
    st.results = list.slice(0, MAX_RESULTS);
    clear(resultsBox);
    if (st.pick || st.results.length === 0) return;
    resultsBox.append(h('ul', { class: 'as-results', 'aria-label': '搜尋結果' }, st.results.map((r) => {
      const v = searchResultView(r, app.translations);
      const away = formatDistance(r.distanceM); // 350 m / 1.2 km from the map centre (or me); '' when unknown
      return h('li', null, h('button', { class: 'as-result', type: 'button', onclick: () => pickResult(r) },
        twoLine(v.name || '（沒有名稱）', v.nameZh), away ? h('span', { class: 'as-dist zh' }, away) : null,
        v.address ? h('span', { class: 'as-addr' }, twoLine(v.address, v.addressZh)) : null));
    })));
  }

  function setCategory(id) {
    st.category = id;
    for (const b of catButtons) b.setAttribute('aria-pressed', String(b.dataset.cat === id));
    preview.setCategory(id);
  }

  // ---- position handling ----------------------------------------------------------------------------------
  function setLoc(loc, { fly = false } = {}) {
    st.loc = loc;
    preview.show(loc.lat, loc.lng, st.category);
    setMsg(locMsg, '');
    renderLoc();
    if (fly) app.map.flyTo(loc.lat, loc.lng, 17); // the sheet is already laid out, so the pin lands in the visible part
  }

  async function useGps() {
    if (st.locating) return;
    st.locating = true;
    gpsBtn.setAttribute('aria-busy', 'true');
    setMsg(locMsg, '');
    const pos = await app.map.locate(); // never throws; null when denied, unavailable or slower than 8 s
    st.locating = false;
    gpsBtn.removeAttribute('aria-busy');
    if (st.closed) return;
    if (pos) setLoc({ lat: pos.lat, lng: pos.lng, source: 'gps' }, { fly: true });
    else enterPick(MSG.noGps); // no fix: switch to tapping the map
  }

  function onMapTap(pos) {
    exitPick();
    setLoc({ lat: pos.lat, lng: pos.lng, source: 'tap' }, { fly: true });
  }

  function enterPick(message) {
    if (st.picking) return;
    st.picking = true;
    pickText.textContent = message || '在地圖上點要放的位置';
    head.hidden = body.hidden = foot.hidden = true;
    pickbar.hidden = false;
    sheet.classList.add('is-picking');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // hide the keyboard
    offMap = app.map.onMapClick(onMapTap);
  }

  function exitPick() {
    if (!st.picking) return;
    st.picking = false;
    offMap();
    offMap = () => {};
    head.hidden = body.hidden = foot.hidden = false;
    pickbar.hidden = true;
    sheet.classList.remove('is-picking');
  }

  // ---- search / link --------------------------------------------------------------------------------------
  const stale = (n) => st.closed || n !== st.seq;

  function pickResult(r) {
    const lat = Number(r?.lat);
    const lng = Number(r?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setQMsg(errorMessage('search', 'bad_response')); return; }
    st.pick = r;
    clear(resultsBox);
    renderPicked();
    setQMsg('');
    if (!st.nameTouched && !opts.presetName) nameInput.value = nameFromPick(r, app.translations);
    if (clean(nameInput.value)) setMsg(nameMsg, '');
    setLoc({ lat, lng, source: 'pick' }, { fly: true });
  }

  /** Forget the picked result and the position that came with it (a position from GPS or a tap stays). */
  function dropPick() {
    st.pick = null;
    if (st.loc?.source === 'pick') { st.loc = null; preview.hide(); renderLoc(); }
    renderPicked();
  }

  function unpick() {
    dropPick();
    showResults(st.results);
  }

  /** Where results are measured from: me while the map follows me, else the middle of the map ({lat, lng} or null). */
  function searchCentre() {
    const me = app.map?.isFollowing?.() ? app.map.lastLocation?.() : null;
    return me ?? app.map?.getMap?.()?.getCenter?.() ?? null;
  }

  async function searchByName(query, n, note) {
    const plan = planSearch(query, searchCentre()); // the name as typed, and with the nearest district's name (place-input.js)
    const settled = await Promise.allSettled(plan.queries.map((text) => searchPlace(app.cfg, text)));
    if (stale(n)) return;
    const { lists, error } = collectSearches(settled);
    if (error) throw error; // every search failed: the same message as for one
    const list = mergeResults(lists, plan.centre);
    dropPick();
    showResults(list);
    if (list.length === 0) setQMsg(noResultsMessage(plan));
    else setQMsg(note ?? '', 'note');
  }

  async function runSearch() {
    const input = classifyPlaceInput(q.value);
    if (input.kind === 'empty') { setQMsg(MSG.emptyInput); q.focus(); return; }
    q.blur(); // close the keyboard: the results come up right under the box and must not be hidden by it
    const n = ++st.seq;
    renderGo(true);
    setQMsg(input.kind === 'url' ? '讀取連結中，可能要等十幾秒…' : '搜尋中，第一次可能要等十幾秒…', 'note');
    clear(resultsBox);
    try {
      if (input.kind === 'url') {
        const place = await resolveLink(app.cfg, input.value);
        if (stale(n)) return;
        st.results = [];
        pickResult(place);
      } else {
        await searchByName(input.value, n);
      }
    } catch (e) {
      if (stale(n)) return;
      setQMsg(errorMessage(input.kind === 'url' ? 'resolve' : 'search', e));
      if (input.kind === 'url' && e.message === 'unresolved' && clean(e.name)) {
        // the link gave a name but no position: search by that name instead
        const name = clean(e.name);
        q.value = name;
        try { await searchByName(name, n, MSG.unresolved); } catch (e2) { if (!stale(n)) setQMsg(errorMessage('search', e2)); }
      }
    } finally {
      if (!stale(n)) renderGo(false);
    }
  }

  // ---- submit ---------------------------------------------------------------------------------------------
  function finish(place, { reloaded = false } = {}) {
    const name = clean(place?.name_zh) || st.lastPayload.name_zh;
    app.addPlaceLocal(place); // pin first, even if a poll that started earlier is still on its way
    if (!reloaded) app.reload().catch(() => {});
    close();
    app.showToast(`已新增「${name}」，其他人一分鐘內會看到`, 4500);
    app.map?.focus(place.id);
  }

  /** After a network failure: look at the server's data to see whether the place got stored anyway. */
  async function recheck() {
    st.submitting = true;
    renderSubmit('確認中…');
    try {
      const res = await app.reload();
      if (st.closed) return;
      if (res.fromCache) throw new Error('offline'); // the fetch failed: no answer either way
      const dup = findSavedDuplicate(res.snapshot.places, st.lastPayload);
      if (dup) { finish(dup, { reloaded: true }); return; }
      st.unsure = false;
      setMsg(footMsg, '確認過了，沒有存到，可以再按一次新增', 'note');
    } catch {
      if (st.closed) return;
      setMsg(footMsg, MSG.addNetwork);
    }
    st.submitting = false;
    renderSubmit();
  }

  async function submit() {
    if (st.submitting) return;
    setMsg(footMsg, '');
    if (st.unsure) { await recheck(); return; }
    const built = buildPayload({
      name: nameInput.value, category: st.category, note: noteInput.value, loc: st.loc, me: app.me, pick: st.pick, locationSource: st.loc?.source,
      aliases: buildAliases({ name: clean(nameInput.value), pick: st.pick, preset: opts.presetAlias }),
    });
    if (!built.ok) {
      if (built.field === 'name') {
        setMsg(nameMsg, MSG.noName);
        nameInput.focus();
      } else {
        setMsg(locMsg, MSG.noLoc);
        locBox.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    st.submitting = true; // at once: a second tap must not send a second copy
    renderSubmit();
    st.lastPayload = built.payload;
    try {
      const place = await addPlace(app.cfg, built.payload, { features: app.snapshot?.features });
      if (st.closed) { app.addPlaceLocal(place); return; }
      finish(place);
    } catch (e) {
      if (st.closed) return;
      if (e.message === 'network') {
        st.unsure = true; // it may have been stored: look before anything is sent again
        setMsg(footMsg, errorMessage('add', e));
        await recheck();
        return;
      }
      setMsg(footMsg, errorMessage('add', e));
      st.submitting = false;
      renderSubmit();
    }
  }

  // ---- open / close ---------------------------------------------------------------------------------------
  const ro = new ResizeObserver(() => {
    const px = sheet.offsetHeight;
    root().style.setProperty('--sheet-h', `${px}px`); // the round buttons and the toast ride above the sheet
    root().classList.toggle('sheet-tall', px > window.innerHeight * 0.5);
    root().classList.add('sheet-open');
  });
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (st.picking) exitPick(); else close();
  };

  function close({ keepSheetVars = false } = {}) {
    if (st.closed) return;
    st.closed = true;
    releaseBack();
    offMap();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    preview.hide();
    sheet.remove();
    if (app.mapMode === 'add') app.mapMode = null;
    if (!keepSheetVars) {
      root().style.setProperty('--sheet-h', '0px');
      root().classList.remove('sheet-tall', 'sheet-open');
    }
    onClosed();
  }

  searchForm.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); runSearch(); }
  });
  nameInput.addEventListener('input', () => { st.nameTouched = true; if (clean(nameInput.value)) setMsg(nameMsg, ''); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); nameInput.blur(); } });
  noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); noteInput.blur(); } });
  gpsBtn.addEventListener('click', useGps);
  tapBtn.addEventListener('click', () => enterPick());
  submitBtn.addEventListener('click', submit);

  renderGo();
  renderSubmit();
  renderLoc();
  app.mapMode = 'add'; // a tap on the map must not be read as "dismiss the card"
  document.body.append(sheet);
  ro.observe(sheet);
  document.addEventListener('keydown', onKey);
  // the Back button leaves the pick-a-spot mode first (like Esc), then closes the form instead of leaving the app
  releaseBack = holdBack(() => { if (st.picking) { exitPick(); return 'stay'; } close(); return undefined; });

  if (opts.presetName) nameInput.value = clean(opts.presetName);
  const initial = clean(opts.presetText) || clean(opts.presetQuery) || clean(opts.presetName);
  if (initial) {
    q.value = initial;
    sheet.focus({ preventScroll: true });
    runSearch();
  } else {
    q.focus({ preventScroll: true });
  }

  return {
    close,
    focus: () => q.focus({ preventScroll: true }),
    height: () => sheet.offsetHeight,
    isOpen: () => !st.closed,
  };
}
