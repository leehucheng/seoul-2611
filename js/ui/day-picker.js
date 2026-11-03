// 「加入行程」 on the place card: a drawer over the card (the add form's look) that lists the 11 trip days (「11/7（六）· 15 站」, today marked, 「已在行程」 on a day
// that has the place already). A tap appends the place as a stop at the end of that day at once, no edit mode (ui/schedule.js addPlaceToDay: the day is copied
// first when it is not kept in the app, a `stale` answer is fetched again and tried once more by itself), then the toast 「已加到 11/7」 with 「去看看」, which opens
// that day's page. A write that does not go through says 「沒存到，連上網路再試一次」 in the drawer and keeps it open.
//
// openDayPicker(app, place, {trigger, behind}) -> {close()}: holds one back-stack entry (Back, Esc and × close it); `behind` go inert while it is open and
// focus goes back to `trigger` (the card's button).
import { holdBack } from '../back-stack.js';
import { labelLines } from '../pin-labels.js';
import { MAX_DAY_STOPS } from '../schedule-edit.js';
import { dayPickRows } from '../schedule-ui.js';
import { SAVE_FAILED } from '../shopping.js';
import { formatMD } from '../today-view.js';
import { append, clear, h, icon, sheetEdge } from './dom.js';

const messageOf = (e) => (e?.message === 'unreadable' ? '行程表還沒讀到，等一下再按一次' : e?.message === 'full' ? `這天已經有 ${MAX_DAY_STOPS} 站了，不能再加` : SAVE_FAILED);

export function openDayPicker(app, place, { trigger = null, behind = [] } = {}) {
  let closed = false;
  let busy = false;
  let release = () => {};
  const behindEls = behind.filter(Boolean);
  const error = h('p', { class: 'field-error', role: 'alert' });
  const rows = h('div', { class: 'sch-days-list', role: 'group', 'aria-label': '選哪一天' });
  const name = labelLines(place, app.translations).zh;

  function paint() {
    const list = dayPickRows({ tabs: app.snapshot?.tabs, rows: app.schedule.rows(), today: app.currentDate(), place });
    clear(rows);
    append(rows, list.map((r) => h('button', { class: `sch-day${r.isToday ? ' is-today' : ''}`, type: 'button', 'data-date': r.date, onclick: () => add(r) },
      h('span', { class: 'sch-day-label' }, r.label),
      r.isToday ? h('span', { class: 'tag sch-day-tag' }, '今天') : null,
      r.already ? h('span', { class: 'tag tag--added sch-day-tag' }, '已在行程') : null)));
  }

  async function add(r) {
    if (busy || closed) return;
    busy = true;
    error.textContent = '';
    rows.setAttribute('aria-busy', 'true');
    try {
      await app.schedule.addPlace(place, r.date);
    } catch (e) {
      busy = false;
      rows.removeAttribute('aria-busy');
      if (!closed) error.textContent = messageOf(e);
      return;
    }
    busy = false;
    close();
    app.showToast?.(`已加到 ${formatMD(r.date)}`, 6000, { label: '去看看', onClick: () => app.actions?.today?.(r.date) });
  }

  function close() {
    if (closed) return;
    closed = true;
    release();
    document.removeEventListener('keydown', onKey, true);
    for (const b of behindEls) b.inert = false;
    sheet.remove();
    if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
  }

  // Esc is heard on the document, in the capture phase, wherever the focus is: with the focus on the body it would otherwise reach the place card's own Esc
  // (card.js, a document listener) and close the card under the picker while the picker stays. The picker is the top one: it takes the key and nothing else does.
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }

  const sheet = h('section', { class: 'addsheet sch-days', role: 'dialog', 'aria-modal': 'true', 'aria-label': '加入行程', tabindex: '-1' },
    sheetEdge(),
    h('div', { class: 'as-head' },
      h('h2', { class: 'as-title' }, '加入行程'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '關閉', onclick: () => close() }, icon('i-close'))),
    h('div', { class: 'as-body' }, h('p', { class: 'sch-days-hint' }, `把「${name}」加到哪一天？`), rows, error));
  paint();
  document.addEventListener('keydown', onKey, true);
  for (const b of behindEls) b.inert = true;
  document.body.append(sheet);
  sheet.focus({ preventScroll: true });
  release = holdBack(() => close());
  return { close, element: sheet };
}
