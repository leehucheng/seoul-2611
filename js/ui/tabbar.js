// The bottom tab bar: 地圖 · 今天 · ＋新增 · 飯店 · 清單. Always on screen (the place card and the add form slide up over it).
//
// 地圖 closes whichever full-height view is open (今天 / 飯店 / 清單) and shows the map. 今天, 飯店 and 清單 open their view above
// the map and below this bar; the tab of the open view is lit. ＋新增 closes an open view first (the add form needs the map to
// pick a spot on) and opens the add form. The tabs call the hooks other modules set on `app`: app.actions.today / .hotel / .add,
// app.openUnmapped, app.closeView; they follow app.on('view') and, for the number on 清單, app.unmappedCount().
import { h, icon } from './dom.js';

export const TABS = Object.freeze([
  { id: 'map', label: '地圖', icon: 'i-map' },
  { id: 'today', label: '今天', icon: 'i-calendar' },
  { id: 'add', label: '新增', icon: 'i-plus', primary: true },
  { id: 'hotel', label: '飯店', icon: 'i-bed' },
  { id: 'list', label: '清單', icon: 'i-list' },
]);

/** The tab that is lit for the open view ('today' | 'hotel' | 'list' | 'map'); anything else lights 地圖. */
export const activeTabFor = (view) => (['today', 'hotel', 'list'].includes(view) ? view : 'map');

export function initTabbar(app, el = document.getElementById('tabbar')) {
  const press = {
    map: () => app.closeView(),
    today: () => { if (app.currentView() !== 'today') app.actions.today(); },
    add: () => { app.closeView(); app.actions.add(); },
    hotel: () => { if (app.currentView() !== 'hotel') app.actions.hotel(); },
    list: () => { if (app.currentView() !== 'list') app.openUnmapped(); },
  };

  const buttons = new Map();
  for (const t of TABS) {
    const badge = t.id === 'list' ? h('span', { class: 'tab-badge', hidden: true }) : null;
    const btn = h('button', { class: `tab${t.primary ? ' tab--add' : ''}`, type: 'button', 'data-tab': t.id, 'aria-label': t.label },
      h('span', { class: 'tab-ico' }, icon(t.icon), badge),
      h('span', { class: 'tab-label' }, t.label));
    btn.addEventListener('click', () => press[t.id]());
    buttons.set(t.id, { btn, badge });
    el.append(btn);
  }

  function update() {
    const active = activeTabFor(app.currentView());
    for (const [id, { btn }] of buttons) {
      if (id === active && id !== 'add') btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    }
    const { badge } = buttons.get('list');
    let n = 0;
    try { n = Number(app.unmappedCount?.()) || 0; } catch { n = 0; }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
    buttons.get('list').btn.setAttribute('aria-label', n > 0 ? `清單，${n} 個還沒上地圖` : '清單');
  }

  app.on('view', update);
  app.on('snapshot', update);
  update();
  return { update, element: el };
}
