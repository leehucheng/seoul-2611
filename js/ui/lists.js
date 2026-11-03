// 清單: the 5th tab's view, a hub for the lists a trip needs at hand. A full-height view above the map and below the tab bar
// (ui/panel.js, view 'lists') with four rows, each one button in the card style of the 今天 page's cards:
//   代購清單   「我的 N 項・已買 M」   opens the 代購 screen (ui/shopping.js) over this view
//   行李清單   「N/46」 and the day's line   opens the packing screen (ui/packing.js) over this view
//   未上地圖   「N 個」 / 「都上地圖了」   opens the 未上地圖 view (ui/unmapped.js), which has 「← 清單」 to come back here
//   熱門必買   「103 項・社群與新聞 8/3–11/3」   opens the 熱門必買 screen (ui/trending.js) over this view
// The rows are the same builders the 今天 page uses (shoppingCard, packingCard) plus unmappedCard and trendingCard, so the numbers are the same numbers.
// They follow every change the way the 今天 page's cards do (a tick, a saved item, a new snapshot, a place put on the map, a new person, the
// 熱門必買 file read for the first time).
//
// The three screens are overlays of their own (they hold a back-stack entry): Back, Esc and × close the screen only; this view stays open
// and the row it was opened from gets focus again. The 未上地圖 view replaces this view (one view at a time), so it hands back to
// app.openLists({focusRow: 'unmapped'}) when it is left with Back / Esc / 「← 清單」.
//
// initLists(app) sets app.openLists({focusRow}) (the tab bar calls it).
import { TRIP_FIRST } from '../today-view.js';
import { append, h } from './dom.js';
import { openPacking, packingCard } from './packing.js';
import { closeButton, createPanel } from './panel.js';
import { openShopping, shoppingCard } from './shopping.js';
import { openTrending, trendingCard } from './trending.js';
import { unmappedCard } from './unmapped.js';

/** The app events after which the rows are redrawn. */
export const LISTS_REFRESH_EVENTS = Object.freeze(['packing', 'shopping', 'snapshot', 'places', 'me', 'trending']);

export function initLists(app) {
  function openLists({ focusRow } = {}) {
    app.closeCard();
    const offs = [];
    let overlay = null; // the 代購, 行李 or 熱門必買 screen that is open over this view, if any
    const panel = createPanel({ cls: 'panel--lists', label: '清單', view: 'lists', onClose: () => { offs.forEach((off) => off()); overlay?.close(); } });
    const over = (open) => (trigger) => { // built once: the same buttons stay in the page, so focus can return to the row that was pressed
      overlay?.close();
      overlay = open({ behind: [panel.dialog, document.getElementById('tabbar')], trigger, onClose: () => { overlay = null; } });
    };

    const shopping = shoppingCard(app, over((opts) => openShopping(app, opts)));
    const packing = packingCard(app, over((opts) => openPacking(app, opts)));
    const unmapped = unmappedCard(app, () => app.openUnmapped({ from: 'lists' }));
    const trending = trendingCard(app, over((opts) => openTrending(app, opts)));

    function paint() {
      shopping.paint();
      const today = app.currentDate();
      packing.sync(today < TRIP_FIRST ? TRIP_FIRST : today); // before the trip the first day's line; a day without a line shows none
      unmapped.paint();
      trending.paint();
    }
    paint();
    for (const event of LISTS_REFRESH_EVENTS) offs.push(app.on(event, paint));

    append(panel.dialog, [
      h('header', { class: 'panel-head' }, closeButton(panel), h('h2', { class: 'panel-title' }, '清單')),
      h('div', { class: 'panel-body' }, h('div', { class: 'ls-rows' }, shopping.element, packing.element, unmapped.element, trending.element)),
    ]);
    if (focusRow === 'unmapped') unmapped.element.focus({ preventScroll: true });
    return panel;
  }

  app.openLists = openLists;
}
