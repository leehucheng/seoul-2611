// 編輯行程: the edit mode of a day page (ui/today-panel.js opens it with 「編輯」 in the meta row), the stop form and the place picker. The list of the day is
// kept here, in memory, until 「完成」; nothing is sent before it. The model (what a list of stops is, moveStop / insertStop / removeStop / editStop) is
// schedule-edit.js, the arithmetic of the drag and the place search is schedule-ui.js, the call that writes is app.schedule.saveDay / resetDay (ui/schedule.js).
//
// createDayEditor(app, {date, scroll, behind, onExit}) -> {element, requestCancel(), dirty(), dispose()} | null
//     `element` is the edit list; the page puts it in the board (`scroll` is the board's scrolling box: the list scrolls in it, the drag scrolls it near an
//     edge). `behind` are the elements that go inert while a screen of the editor (the stop form, the picker) is open: the page. `lock` are the elements
//     that are inert for the whole edit (the tab bar: a tab pressed by mistake would drop the edits). null when the day cannot be edited yet
//     (a day that is not kept in the app and a Schedule tab that was not read: a copy would be empty).
//     Above the list 「取消」 and 「完成」. Every stop of the day is a row, other people's too: its text (Chinese first, the Korean under it), its note in
//     small type, 「↑」 「↓」 and a drag handle on the right. A tap on the text opens the stop form; under the list 「＋ 新增一站」 opens the place picker; on
//     an app-owned day the last thing is a muted 「改回 Sheet 版」.
//     完成  one saveDay for the whole day (base = the day's version, '' for a day the app does not keep yet, whose list then is copyDay's), 「儲存中…」,
//           then 「已儲存」 and out. `stale` fetches a fresh snapshot, rebuilds the list from it and stays; any other failure says 「沒存到，連上網路再試一次」 and
//           keeps the list. Nothing changed: out without a write (a day that was only looked at must not become the app's).
//     取消  drops the edits and leaves. Back (the phone's) and Esc do the same, but ask 「放棄這些修改？」 first when something changed. The editor holds one
//           back-stack entry; the stop form and the picker hold their own on top of it.
//     drag  pressing the handle and moving drags the row at once (touch-action: none on the handle only; the rest of the row scrolls the list); the rows
//           between slide out of the way (not with reduced motion), a dashed slot shows where it lands, the list scrolls near its bottom edge and near its
//           top (under the sticky bar); letting go is moveStop. A cancelled or lost pointer (pointercancel, lostpointercapture) and a list drawn again put
//           the row back. 「↑」 「↓」 do the same one step (aria-labels 「上移：…」 「下移：…」, disabled at the ends).
// The stop form (a screen over the list): 「內容」 (required, 200), 「時間／交通備註」 (200), 「細節」 (500), 「地圖上的地點」 with 「選地點」 and, when linked by
// id, 「取消連結」; 「好」 applies it to the list, 「刪除這站」 (an existing stop) removes it (a Sheet line stays as a tombstone, an app-added stop goes).
// The place picker: a search box over our places and the July ones, a first row 「直接打字新增」 (adding a stop), the results, and (once something is typed)
// 「地圖上沒有？新增地點」, which opens the add form (app.openAddPlace {presetName, onAdded, onClose}) and links the new place.
// Text only goes in through dom.js (textContent).
import { holdBack } from '../back-stack.js';
import { hasHangul, zhOf } from '../i18n.js';
import { labelLines, placeName } from '../pin-labels.js';
import { MAX_DAY_STOPS, cutText, editStop, insertStop, moveStop, removeStop, visibleStops } from '../schedule-edit.js';
import { autoScrollDelta, dragLayout, dropIndex, lineTexts, listKey, placeStop, searchPlaces, sheetDayOf, sheetReadable, startingList, stopPlace } from '../schedule-ui.js';
import { SAVE_FAILED } from '../shopping.js';
import { append, clear, h, icon } from './dom.js';

const clean = (v) => String(v ?? '').trim();
const STALE_TEXT = '別人剛改了這天，已重新載入';
const raf = (fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const cancelRaf = (id) => (globalThis.cancelAnimationFrame ? globalThis.cancelAnimationFrame(id) : clearTimeout(id));
const isOff = (el) => el.getAttribute('disabled') !== null;

// ---- a screen over the list (the stop form, the place picker) ----------------------------------------------------------------

/**
 * A cream screen over everything (z-index 30, like the 代購 screen) with a head (title, ×) and a scrolling body. It holds its own back-stack entry: Back,
 * Esc and the × close it, and only it. `behind` goes inert while it is open; focus goes back to `trigger` when it closes. -> {el, body, close, isClosed()}.
 */
function openLayer({ cls, label, title, behind = [], trigger = null, onClose }) {
  let closed = false;
  let release = () => {};
  const behindEls = behind.filter(Boolean);
  const body = h('div', { class: 'sch-scroll' });
  const el = h('div', { class: `sch-layer ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' },
    h('header', { class: 'sch-head' },
      h('h1', { class: 'sch-title' }, title),
      h('button', { class: 'icon-btn sch-close', type: 'button', 'aria-label': '關閉', onclick: () => layer.close() }, icon('i-close'))),
    body);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    layer.close();
  };
  const layer = {
    el, body,
    isClosed: () => closed,
    close() {
      if (closed) return;
      closed = true;
      release();
      el.removeEventListener('keydown', onKey);
      for (const b of behindEls) b.inert = false;
      el.remove();
      try { onClose?.(); } catch (e) { console.error(e); }
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
    },
  };
  el.addEventListener('keydown', onKey);
  for (const b of behindEls) b.inert = true;
  document.body.append(el);
  el.focus({ preventScroll: true });
  release = holdBack(() => { layer.close(); });
  return layer;
}

// ---- the editor --------------------------------------------------------------------------------------------------------------

export function createDayEditor(app, { date, scroll = null, behind = [], lock = [], onExit = () => {} } = {}) {
  const start = startingList(app.snapshot?.tabs, app.schedule.rows(), date);
  if (!start.ok) return null;
  const st = { stops: start.stops, base: start.base, owned: start.owned, initial: listKey(start.stops), saving: false };
  const sheetDay = () => sheetDayOf(app.snapshot?.tabs, date);
  const ctx = () => ({ placeById: app.placeById, places: app.places });
  const keyed = new Map(); // data-key -> element, so that focus can go back to the same control after the list is drawn again
  let rowEls = []; // the <li> of the visible stops, in order
  let finished = false;
  let release = () => {};
  let form = null; // the open stop form, if any
  let picker = null; // the open place picker, if any
  let drag = null;

  const dirty = () => listKey(st.stops) !== st.initial;

  // ---- the pieces that stay ----

  const cancelBtn = h('button', { class: 'btn btn--ghost sch-cancel', type: 'button', onclick: () => cancel() }, '取消');
  const doneBtn = h('button', { class: 'btn btn--primary sch-done', type: 'button', onclick: () => finish() }, '完成');
  const msg = h('p', { class: 'sch-msg', role: 'alert' });
  msg.hidden = true;
  const showMsg = (text, tone = 'error') => {
    msg.textContent = text;
    msg.hidden = text === '';
    msg.classList.toggle('is-note', tone === 'note');
  };
  const discardBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => cancel() }, '放棄');
  const keepBtn = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => hideAsk() }, '繼續編輯');
  const ask = h('div', { class: 'sch-ask', role: 'group', 'aria-label': '放棄修改' }, h('p', null, '放棄這些修改？'), h('div', { class: 'sch-crow' }, discardBtn, keepBtn));
  ask.hidden = true;
  const list = h('ol', { class: 'sch-list' });
  const empty = h('p', { class: 'sch-empty' }, '這天還沒有行程。按下面的「＋ 新增一站」加第一站。');
  const addBtn = h('button', { class: 'btn btn--ghost sch-add', type: 'button', 'data-key': 'add', onclick: () => openPicker({ mode: 'add' }) }, '＋ 新增一站');
  keyed.set('add', addBtn);
  const resetYes = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => doReset() }, '確定改回');
  const resetNo = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { resetAsk.hidden = true; resetBtn.focus({ preventScroll: true }); } }, '先不要');
  const resetText = h('p', null, '');
  const resetAsk = h('div', { class: 'sch-ask', role: 'group', 'aria-label': '確認改回 Sheet 版' }, resetText, h('div', { class: 'sch-crow' }, resetYes, resetNo));
  resetAsk.hidden = true;
  // offered only while the Sheet's Schedule tab has been read: with it unread the Sheet's lines are unknown, and 「改回 Sheet 上的 0 站」 would be a lie that drops the app copy for nothing
  const canReset = () => st.owned && sheetReadable(app.snapshot?.tabs);
  const resetBtn = h('button', { class: 'sch-reset', type: 'button', onclick: () => {
    if (!canReset()) return;
    resetText.textContent = `這天在 app 的修改會全部拿掉，改回 Sheet 上的 ${sheetDay()?.items?.length ?? 0} 站`;
    resetAsk.hidden = false;
    resetYes.focus({ preventScroll: true });
  } }, '改回 Sheet 版');
  const resetBox = h('div', { class: 'sch-resetbox' }, resetBtn, resetAsk);
  // the bar, the message and the question stay at the top of the board while the list scrolls under them: 「完成」 is never a long scroll away
  const topBar = h('div', { class: 'sch-top' }, h('div', { class: 'sch-bar' }, cancelBtn, doneBtn), msg, ask);
  const element = h('div', { class: 'sch-edit', role: 'group', 'aria-label': '編輯這天的行程', tabindex: '-1' }, topBar, list, empty, addBtn, resetBox);

  // ---- the rows ----

  /** The Chinese line first and the Korean under it, as on the board; a time written in the text stays (the edit list has no column for it). */
  function lines(stop) {
    const place = stopPlace(stop, ctx())?.place ?? null;
    return lineTexts({ text: stop.text, zh: hasHangul(stop.text) ? zhOf(stop.text, app.translations) : null }, place, { keepTime: true });
  }

  function row(stop, index, k, n) {
    const { first, second } = lines(stop);
    const open = h('button', { class: 'sch-open', type: 'button', 'data-key': `open:${index}`, 'aria-label': `編輯：${first}`, onclick: () => openForm(index) },
      h('span', { class: 'sch-first', lang: hasHangul(first) ? 'ko' : undefined }, first),
      second ? h('span', { class: 'sch-kr', lang: 'ko' }, second) : null,
      stop.note ? h('span', { class: 'sch-note' }, stop.note) : null);
    const up = h('button', { class: 'sch-mv sch-up', type: 'button', 'data-key': `up:${index}`, 'aria-label': `上移：${first}`, disabled: k === 0, onclick: () => { if (k > 0) moveTo(index, visibleStops(st.stops)[k - 1].index); } }, '↑');
    const down = h('button', { class: 'sch-mv sch-down', type: 'button', 'data-key': `down:${index}`, 'aria-label': `下移：${first}`, disabled: k === n - 1, onclick: () => { if (k < n - 1) moveTo(index, visibleStops(st.stops)[k + 1].index); } }, '↓');
    const grip = h('div', { class: 'sch-grip', 'aria-hidden': 'true' }, icon('i-grip'));
    const li = h('li', { class: 'sch-row' }, open, h('div', { class: 'sch-acts' }, up, down, grip));
    keyed.set(`open:${index}`, open);
    keyed.set(`up:${index}`, up);
    keyed.set(`down:${index}`, down);
    grip.addEventListener('pointerdown', (e) => startDrag(e, grip, k));
    grip.addEventListener('pointermove', onDragMove);
    grip.addEventListener('pointerup', (e) => endDrag(e, true));
    grip.addEventListener('pointercancel', (e) => endDrag(e, false));
    grip.addEventListener('lostpointercapture', (e) => endDrag(e, false)); // the pointer was taken away without a pointerup (the handle went, a WebView): the row is put back, the drag does not hang
    return li;
  }

  /** Draw the list again (after a change); focus goes to the control `focusKey` names (its neighbour when that one is disabled now). */
  function redraw(focusKey = '') {
    endDrag(null, false); // a list drawn again leaves no drag behind (the handle it was held by is gone): the row is put back
    const top = scroll ? scroll.scrollTop : 0;
    for (const k of [...keyed.keys()]) if (k !== 'add') keyed.delete(k);
    const shown = visibleStops(st.stops);
    clear(list);
    rowEls = shown.map(({ stop, index }, k) => row(stop, index, k, shown.length));
    append(list, rowEls);
    list.hidden = shown.length === 0;
    empty.hidden = shown.length > 0;
    resetBox.hidden = !canReset();
    if (scroll) scroll.scrollTop = top;
    let target = keyed.get(focusKey);
    if (target && isOff(target)) target = keyed.get(focusKey.startsWith('up:') ? `down:${focusKey.slice(3)}` : `up:${focusKey.slice(5)}`) ?? target;
    target?.focus?.({ preventScroll: true });
  }

  function moveTo(from, to) {
    if (st.saving) return;
    st.stops = moveStop(st.stops, from, to);
    redraw(`up:${to}`);
  }

  // ---- dragging a row by its handle ----

  function startDrag(e, grip, k) {
    if (drag || st.saving || rowEls.length < 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault?.();
    const rects = rowEls.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
    const slot = h('li', { class: 'sch-slot', 'aria-hidden': 'true' });
    list.append(slot);
    drag = { id: e.pointerId, grip, k, y0: e.clientY, y: e.clientY, scroll0: scroll ? scroll.scrollTop : 0, rects, listTop: list.getBoundingClientRect().top, slot, lay: null, frame: 0 };
    try { grip.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone already */ }
    rowEls[k].classList.toggle('is-dragging', true);
    list.classList.toggle('is-dragging', true);
    paintDrag();
    drag.frame = raf(pump);
  }

  function paintDrag() {
    const d = drag;
    const last = d.rects.length - 1;
    const moved = d.y - d.y0 + (scroll ? scroll.scrollTop : 0) - d.scroll0; // the finger's and the list's scrolling together
    const dy = Math.max(d.rects[0].top - d.rects[d.k].top, Math.min(d.rects[last].bottom - d.rects[d.k].bottom, moved)); // the row itself stays inside the list ...
    d.lay = dragLayout(d.rects, d.k, moved); // ... but where it drops follows the finger, so that the very last (or first) place can be reached
    rowEls.forEach((r, j) => { r.style.transform = j === d.k ? `translateY(${dy}px)` : d.lay.shifts[j] !== 0 ? `translateY(${d.lay.shifts[j]}px)` : ''; });
    d.slot.style.height = `${d.lay.height}px`;
    d.slot.style.transform = `translateY(${d.lay.slotTop - d.listTop}px)`;
  }

  /** Every frame while a row is held: near the top or bottom edge of the board the list scrolls, and the row follows it. */
  function pump() {
    if (!drag) return;
    if (scroll) {
      const box = scroll.getBoundingClientRect();
      // the upward zone starts under the sticky bar (取消 / 完成, and the message or the question when they show), measured, not a fixed number: the rows are what is seen there
      const delta = autoScrollDelta(drag.y, Math.max(box.top, topBar.getBoundingClientRect().bottom), box.bottom);
      if (delta !== 0) {
        const before = scroll.scrollTop;
        scroll.scrollTop = before + delta;
        if (scroll.scrollTop !== before) paintDrag();
      }
    }
    drag.frame = raf(pump);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    paintDrag();
  }

  function endDrag(e, drop) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    cancelRaf(d.frame);
    try { d.grip.releasePointerCapture?.(d.id); } catch { /* not captured */ }
    for (const r of rowEls) r.style.transform = '';
    rowEls[d.k]?.classList.toggle('is-dragging', false);
    list.classList.toggle('is-dragging', false);
    d.slot.remove();
    const to = d.lay?.to ?? d.k;
    if (!drop || to === d.k) return;
    const from = visibleStops(st.stops)[d.k]?.index;
    if (from === undefined) return; // the list was drawn again under the finger: nothing to move
    moveTo(from, dropIndex(st.stops, from, to));
  }

  // ---- the stop form ----

  /** `index`: a stop of the list to change, or null for a new one (the text and the place may be given: a stop made from a picked place). */
  function openForm(index, preset = null) {
    if (form || st.saving) return;
    const stop = index === null ? null : st.stops[index];
    if (index !== null && !stop) return;
    const draft = { place_id: stop ? stop.place_id : clean(preset?.place_id) };
    const fieldId = (k) => `sch-f-${k}`;
    const text = h('input', { class: 'field', id: fieldId('text'), type: 'text', maxlength: '200', autocomplete: 'off', 'aria-required': 'true', enterkeyhint: 'done' });
    // a textarea, not a one-line input: a note from the Sheet may have several lines (「平日 …」 / 「週末 …」), and a one-line input would cut the line breaks out of it
    const note = h('textarea', { class: 'field sch-textarea sch-textarea--note', id: fieldId('note'), rows: '2', maxlength: '200', placeholder: '例如 09:30、搭 2 號線' });
    const detail = h('textarea', { class: 'field sch-textarea', id: fieldId('detail'), rows: '4', maxlength: '500' });
    text.value = stop ? stop.text : clean(preset?.text);
    note.value = stop ? stop.note : '';
    detail.value = stop ? stop.detail : '';
    const error = h('p', { class: 'field-error', role: 'alert' });
    const placeLine = h('span', { class: 'sch-place-name' });
    const pickBtn = h('button', { class: 'btn btn--ghost sch-pick', type: 'button', onclick: () => openPicker({ mode: 'link', trigger: pickBtn, behind: [layer.el], onPick: (place) => { draft.place_id = place.id; if (clean(text.value) === '') text.value = placeName(place, app.translations); paintPlace(); } }) }, '選地點');
    const unlinkBtn = h('button', { class: 'btn btn--ghost sch-unlink', type: 'button', onclick: () => { draft.place_id = ''; paintPlace(); pickBtn.focus({ preventScroll: true }); } }, '取消連結');
    function paintPlace() {
      const found = stopPlace({ place_id: draft.place_id, text: text.value }, ctx());
      placeLine.textContent = !found ? '沒有' : found.place ? `${placeName(found.place, app.translations)}${found.byName ? '（依名稱）' : ''}` : '（找不到這個地點）';
      unlinkBtn.hidden = draft.place_id === '';
    }
    text.addEventListener('input', () => { if (clean(text.value) !== '') { error.textContent = ''; text.setAttribute('aria-invalid', 'false'); } paintPlace(); });
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); text.blur?.(); } }); // 「完成」 on the phone's keyboard puts the keyboard away
    const field = (id, label, input, ...after) => h('div', { class: 'sp-fld' }, h('label', { class: 'field-label', for: id }, label), input, ...after);

    const okBtn = h('button', { class: 'btn btn--primary sch-ok', type: 'button', onclick: () => apply() }, '好');
    const delBtn = stop ? h('button', { class: 'btn btn--ghost sch-del', type: 'button', onclick: () => remove() }, '刪除這站') : null;
    const layer = openLayer({
      cls: 'sch-form', label: stop ? '編輯這一站' : '新增一站', title: stop ? '編輯這一站' : '新增一站', behind,
      onClose: () => { form = null; (keyed.get(index === null ? 'add' : `open:${index}`) ?? addBtn).focus?.({ preventScroll: true }); },
    });
    form = layer;
    append(layer.body, [
      field(fieldId('text'), '內容', text, error),
      field(fieldId('note'), '時間／交通備註', note),
      field(fieldId('detail'), '細節', detail),
      h('div', { class: 'sp-fld sch-place' }, h('p', { class: 'field-label' }, '地圖上的地點'), h('p', { class: 'sch-place-line' }, placeLine), h('div', { class: 'sch-place-btns' }, pickBtn, unlinkBtn)),
      okBtn, delBtn]);
    paintPlace();
    text.focus({ preventScroll: true });

    function apply() {
      const t = cutText(clean(text.value), 200);
      if (t === '') {
        error.textContent = '請填內容';
        text.setAttribute('aria-invalid', 'true');
        text.focus({ preventScroll: true });
        return;
      }
      const patch = { text: t, note: cutText(clean(note.value), 200), detail: cutText(clean(detail.value), 500), place_id: draft.place_id };
      if (index === null) {
        if (st.stops.length >= MAX_DAY_STOPS) { error.textContent = `這天最多 ${MAX_DAY_STOPS} 站`; return; }
        st.stops = insertStop(st.stops, undefined, patch);
      } else {
        st.stops = editStop(st.stops, index, patch);
      }
      const at = index === null ? st.stops.length - 1 : index;
      layer.close();
      redraw(`open:${at}`);
      if (index === null) rowEls[rowEls.length - 1]?.scrollIntoView?.({ block: 'nearest' });
    }

    function remove() {
      st.stops = removeStop(st.stops, index);
      layer.close();
      redraw('add');
    }
  }

  // ---- the place picker ----

  /**
   * mode 'add': a place picked becomes a new stop at the end of the list; 「直接打字新增」 opens the stop form empty. mode 'link': a place picked is given to
   * onPick (the stop form's link). 「地圖上沒有？新增地點」 opens the add form; the place saved there is linked the same way.
   */
  function openPicker({ mode, trigger = addBtn, behind: under = behind, onPick }) {
    if (picker || st.saving) return;
    const adding = mode === 'add';
    const layer = openLayer({ cls: 'sch-pick-screen', label: adding ? '新增一站' : '選地點', title: adding ? '新增一站' : '選地點', behind: under, trigger, onClose: () => { picker = null; } });
    picker = layer;
    const q = h('input', { class: 'field', id: 'sch-q', type: 'text', 'aria-label': '搜尋地點', placeholder: '打地點名稱', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const results = h('div', { class: 'sch-results' });
    append(layer.body, [h('div', { class: 'sp-fld' }, h('label', { class: 'field-label', for: 'sch-q' }, '搜尋地點'), q), results]);

    const take = (place) => {
      if (adding) {
        if (st.stops.length >= MAX_DAY_STOPS) { showMsg(`這天最多 ${MAX_DAY_STOPS} 站`); layer.close(); return; }
        st.stops = insertStop(st.stops, undefined, placeStop(place, app.translations));
        layer.close();
        redraw(`open:${st.stops.length - 1}`);
        rowEls[rowEls.length - 1]?.scrollIntoView?.({ block: 'nearest' });
      } else {
        onPick?.(place);
        layer.close();
      }
    };

    function addNewPlace(name) {
      if (typeof app.openAddPlace !== 'function') return;
      app.revealMap?.(true); // the add form's 「在地圖上點」 needs the map: this page and its screens step aside while it is open (only the map answers taps; a pin tap is ignored while the form is open, app.mapMode)
      app.openAddPlace({
        presetName: name,
        onAdded: (place) => take(place), // the stop is made (or the link set) when the place is saved; closing the form without saving does nothing
        // The form closes by any route. One of them opens a card (a July place of its own search list): the picker would come back above a card nobody can see, and
        // the next Back would seem to do nothing. So no card is left open: the picker is where a July place is picked from.
        onClose: () => { app.revealMap?.(false); app.closeCard?.(); },
      });
    }

    const rowBtn = (cls, label, onclick, ...kids) => h('button', { class: `sch-pick-row ${cls}`.trim(), type: 'button', 'aria-label': label, onclick }, ...kids);
    function paint() {
      const typed = clean(q.value);
      const hits = searchPlaces(app.places, app.julyPlaces ?? [], typed, { translations: app.translations });
      const kids = [];
      if (adding) kids.push(h('li', null, h('button', { class: 'sch-pick-row sch-pick-row--free', type: 'button', onclick: () => { layer.close(); openForm(null); } }, '直接打字新增')));
      for (const { place, july } of hits) {
        const l = labelLines(place, app.translations);
        kids.push(h('li', null, rowBtn('sch-pick-place', `${adding ? '加入' : '選這個地點'}：${l.zh}${july ? '（7 月清單）' : ''}`, () => take(place),
          h('span', { class: 'sch-pick-name' }, l.zh, july ? h('span', { class: 'tag tag--july' }, '7 月') : null),
          l.kr ? h('span', { class: 'as-addr kr', lang: 'ko' }, l.kr) : null)));
      }
      if (typed !== '') kids.push(h('li', null, h('button', { class: 'sch-pick-row sch-pick-row--new', type: 'button', onclick: () => addNewPlace(typed) }, '地圖上沒有？新增地點')));
      clear(results);
      results.append(h('ul', { class: 'sch-pick-list' }, kids));
      if (typed === '') results.append(h('p', { class: 'sch-hint' }, '打幾個字，從地圖上的地點挑一個。'));
      else if (hits.length === 0) results.append(h('p', { class: 'sch-hint' }, '地圖上沒有叫這個名字的地點。'));
    }
    q.addEventListener('input', paint);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); q.blur?.(); } }); // 「搜尋」 on the phone's keyboard: the results are not hidden behind it
    paint();
    q.focus({ preventScroll: true });
  }

  // ---- finishing ----

  function closeLayers() {
    picker?.close();
    form?.close();
  }

  const setLock = (on) => { for (const el of lock.filter(Boolean)) el.inert = on; };

  function exit(how) {
    if (finished) return;
    finished = true;
    release();
    endDrag(null, false);
    closeLayers();
    setLock(false);
    onExit(how);
  }

  function hideAsk() {
    ask.hidden = true;
    doneBtn.focus({ preventScroll: true });
  }

  function cancel() {
    if (st.saving) return;
    exit('cancel');
  }

  function setSaving(on) {
    st.saving = on;
    doneBtn.disabled = on;
    cancelBtn.disabled = on;
    doneBtn.textContent = on ? '儲存中…' : '完成';
  }

  /** 'stale': somebody saved the day since this list was made. A fresh snapshot is fetched and the list is made again from it. */
  async function reloadFresh() {
    try {
      const answer = await app.reload();
      if (answer?.fromCache) throw new Error('offline'); // the fetch failed: what is held is not fresh
    } catch {
      showMsg(SAVE_FAILED);
      return;
    }
    const fresh = startingList(app.snapshot?.tabs, app.schedule.rows(), date);
    if (!fresh.ok) { showMsg(SAVE_FAILED); return; }
    Object.assign(st, { stops: fresh.stops, base: fresh.base, owned: fresh.owned, initial: listKey(fresh.stops) });
    closeLayers();
    ask.hidden = true;
    resetAsk.hidden = true;
    showMsg(STALE_TEXT, 'note');
    redraw();
  }

  async function finish() {
    if (st.saving || finished) return;
    showMsg('');
    ask.hidden = true;
    if (!dirty()) { exit('unchanged'); return; }
    setSaving(true);
    try {
      await app.schedule.saveDay({ date, base: st.base, stops: st.stops, by: app.me ?? '' });
    } catch (e) {
      setSaving(false);
      if (finished) return;
      if (e?.message === 'stale') await reloadFresh(); else showMsg(SAVE_FAILED);
      return;
    }
    setSaving(false);
    if (finished) return;
    app.showToast?.('已儲存');
    exit('saved');
  }

  async function doReset() {
    if (st.saving) return;
    showMsg('');
    resetAsk.hidden = true;
    setSaving(true);
    try {
      await app.schedule.resetDay({ date, base: st.base });
    } catch (e) {
      setSaving(false);
      if (finished) return;
      if (e?.message === 'stale') await reloadFresh(); else showMsg(SAVE_FAILED);
      return;
    }
    setSaving(false);
    if (finished) return;
    app.showToast?.('已改回 Sheet 版');
    exit('reset');
  }

  /** Back (the phone's) and Esc: leave, but ask first when something changed (and the question is already there: put it away). */
  function onBack() {
    if (st.saving) return 'stay';
    if (!ask.hidden) { hideAsk(); return 'stay'; }
    if (dirty()) {
      ask.hidden = false;
      discardBtn.focus({ preventScroll: true });
      return 'stay';
    }
    exit('cancel');
    return undefined;
  }

  redraw();
  release = holdBack(onBack);
  setLock(true); // the tab bar is out of reach while a day is edited: a tab pressed by mistake would drop the edits without a word
  return {
    element,
    dirty,
    requestCancel: () => { onBack(); },
    /** The page was closed under the editor: let go of the back entry, the screens and the lock, say nothing. */
    dispose() {
      if (finished) return;
      finished = true;
      release();
      endDrag(null, false);
      closeLayers();
      setLock(false);
    },
  };
}
