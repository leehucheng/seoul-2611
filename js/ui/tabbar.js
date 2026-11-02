// The bottom bar (a cream capsule with a thin ink ring): 地圖 · 今天 · 新增 (the yellow capsule) · 今晚住 · 未上地圖 (with a count).
// Always on screen: the 今天 / 今晚住 / 未上地圖 views and the place card sit under it; only the add form covers it.
//
// 地圖 closes the place card and whichever full-height view is open and shows the map. 今天, 今晚住 and 未上地圖 open their view
// above the map and below this bar; the tab of the open view is the ink circle with the yellow icon. 新增 closes an open view first
// (the add form needs the map to pick a spot on) and opens the add form. The tabs call the hooks other modules set on `app`:
// app.actions.today / .hotel / .add, app.openUnmapped, app.closeView, app.closeCard; they follow app.on('view') and, for the number on
// 未上地圖, app.unmappedCount().
import { h, icon } from './dom.js';

export const TABS = Object.freeze([
  { id: 'map', label: '地圖', icon: 'i-map' },
  { id: 'today', label: '今天', icon: 'i-calendar', aria: '今天的行程' },
  { id: 'add', label: '新增', icon: 'i-plus', primary: true, aria: '新增地點' },
  { id: 'hotel', label: '今晚住', icon: 'i-bed', aria: '今晚住的飯店' },
  { id: 'list', label: '未上地圖', icon: 'i-list' },
]);

/** The app events after which the tabs are redrawn: a view opened or closed, a snapshot came in, a place saved from this phone showed up on the map (the 未上地圖 count follows it). */
export const TAB_REFRESH_EVENTS = Object.freeze(['view', 'snapshot', 'places']);

/** The tab that is lit for the open view ('today' | 'hotel' | 'list' | 'map'); anything else lights 地圖. */
export const activeTabFor = (view) => (['today', 'hotel', 'list'].includes(view) ? view : 'map');

export function initTabbar(app, el = document.getElementById('tabbar')) {
  const press = {
    map: () => { app.closeCard(); app.closeView(); },
    today: () => { if (app.currentView() !== 'today') app.actions.today(); },
    add: () => { app.closeView(); app.actions.add(); },
    hotel: () => { if (app.currentView() !== 'hotel') app.actions.hotel(); },
    list: () => { if (app.currentView() !== 'list') app.openUnmapped(); },
  };

  const buttons = new Map();
  for (const t of TABS) {
    let btn;
    let badge = null;
    if (t.primary) {
      btn = h('button', { class: 'add', type: 'button', 'data-tab': t.id, 'aria-label': t.aria ?? t.label },
        h('span', null, t.label), h('span', { class: 'chip-ink' }, icon(t.icon)));
    } else {
      badge = t.id === 'list' ? h('span', { class: 'tab-badge', hidden: true }) : null;
      btn = h('button', { class: 'tab', type: 'button', 'data-tab': t.id, 'aria-label': t.aria ?? t.label },
        h('span', { class: 'tdot' }, icon(t.icon), badge),
        h('span', { class: 'tlabel' }, t.label));
    }
    btn.addEventListener('click', () => press[t.id]());
    buttons.set(t.id, { btn, badge });
    el.append(btn);
  }

  function update() {
    const active = activeTabFor(app.currentView());
    for (const [id, { btn }] of buttons) {
      if (id === active && id !== 'add') btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    }
    const { badge, btn } = buttons.get('list');
    let n = 0;
    try { n = Number(app.unmappedCount?.()) || 0; } catch { n = 0; }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
    btn.setAttribute('aria-label', n > 0 ? `未上地圖，${n} 個` : '未上地圖');
  }

  for (const event of TAB_REFRESH_EVENTS) app.on(event, update);
  update();
  return { update, element: el };
}
