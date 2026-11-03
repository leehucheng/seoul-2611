// The bottom bar (a cream capsule with a thin ink ring): 地圖 · 今天 · 新增 (the yellow capsule) · 韓文卡 · 清單.
// Always on screen: the 今天 / 韓文卡 / 清單 / 未上地圖 views and the place card sit under it; only the add form (and a phrase card held up to
// a shop assistant) covers it.
//
// 地圖 closes the place card and whichever full-height view is open and shows the map. 今天, 韓文卡 (tonight's hotel card, then the phrase cards) and 清單
// (代購, 行李, 未上地圖, 熱門必買: ui/lists.js) open their view above the map and below this bar; the tab of the open view is the ink circle with the yellow
// icon (清單 is lit for the 未上地圖 view too, which is opened from it). 新增 closes an open view first (the add form needs the map to pick a spot
// on) and opens the add form. The tabs call the hooks other modules set on `app`:
// app.actions.today / .hotel / .add, app.openLists, app.closeView, app.closeCard; they follow app.on('view').
import { h, icon } from './dom.js';

export const TABS = Object.freeze([
  { id: 'map', label: '地圖', icon: 'i-map' },
  { id: 'today', label: '今天', icon: 'i-calendar', aria: '今天的行程' },
  { id: 'add', label: '新增', icon: 'i-plus', primary: true, aria: '新增地點' },
  { id: 'hotel', label: '韓文卡', icon: 'i-id', aria: '韓文卡，今晚住的飯店和給店員看的句子' },
  { id: 'lists', label: '清單', icon: 'i-list', aria: '清單：代購、行李、未上地圖、熱門必買' },
]);

/** The app events after which the tabs are redrawn: a view opened or closed. */
export const TAB_REFRESH_EVENTS = Object.freeze(['view']);

/** The tab that is lit for the open view ('today' | 'hotel' | 'lists' | 'map'); the 未上地圖 view ('list') lights 清單, anything else lights 地圖. */
export const activeTabFor = (view) => {
  if (view === 'list') return 'lists';
  return ['today', 'hotel', 'lists'].includes(view) ? view : 'map';
};

export function initTabbar(app, el = document.getElementById('tabbar')) {
  const press = {
    map: () => { app.closeCard(); app.closeView(); },
    today: () => { if (app.currentView() !== 'today') app.actions.today(); },
    add: () => { app.closeView(); app.actions.add(); },
    hotel: () => { if (app.currentView() !== 'hotel') app.actions.hotel(); },
    lists: () => { if (app.currentView() !== 'lists') app.openLists(); }, // from the 未上地圖 view too: back to the 清單 view
  };

  const buttons = new Map();
  for (const t of TABS) {
    let btn;
    if (t.primary) {
      btn = h('button', { class: 'add', type: 'button', 'data-tab': t.id, 'aria-label': t.aria ?? t.label },
        h('span', null, t.label), h('span', { class: 'chip-ink' }, icon(t.icon)));
    } else {
      btn = h('button', { class: 'tab', type: 'button', 'data-tab': t.id, 'aria-label': t.aria ?? t.label },
        h('span', { class: 'tdot' }, icon(t.icon)),
        h('span', { class: 'tlabel' }, t.label));
    }
    btn.addEventListener('click', () => press[t.id]());
    buttons.set(t.id, btn);
    el.append(btn);
  }

  function update() {
    const active = activeTabFor(app.currentView());
    for (const [id, btn] of buttons) {
      if (id === active && id !== 'add') btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    }
  }

  for (const event of TAB_REFRESH_EVENTS) app.on(event, update);
  update();
  return { update, element: el };
}
