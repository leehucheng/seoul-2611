// 今天: a full-screen panel with one day of the Sheet's Schedule for the person using the app, a flight reminder on top
// (today or tomorrow), tonight's hotel, and the day's items. Items that match a pin on the map can be tapped (the panel
// closes and the map flies there). Every Korean string has a smaller Chinese line under it.
//
// initToday(app) sets app.actions.today and app.openToday(dateISO?). Text from the Sheet only goes in through dom.js (textContent).
import { NEUTRAL } from '../colors.js';
import { categoryOf } from '../place-view.js';
import { isISODate, loadTripData, todayView } from '../today-view.js';
import { append, clear, h, icon, tile } from './dom.js';
import { closeButton, createPanel, textWithZh } from './panel.js';

/** The tile of a schedule item that has no pin on the map: a neutral grey one. */
const NO_PIN = Object.freeze({ icon: 'i-list', ...NEUTRAL });

/** What a poll can change on this panel: the three tabs, the people, the places the items point to, the translations. */
const signatureOf = (app) => JSON.stringify([
  app.me, app.snapshot?.tabs?.Schedule, app.snapshot?.tabs?.Flight, app.snapshot?.tabs?.Hotel, app.translations,
  app.places.map((p) => [p.id, p.category, p.name_zh, p.name_kr, p.name_en, p.aliases, p.hidden, p.lat, p.lng]),
]);

export function initToday(app) {
  function openToday(dateArg) {
    if (!app.snapshot) {
      app.showToast('資料還沒載入好，等一下再按一次');
      return null;
    }
    app.closeCard();

    const state = { date: isISODate(dateArg) ? dateArg : app.currentDate(), expanded: new Set(), sig: '' };
    const head = h('header', { class: 'panel-head today-head' });
    const body = h('div', { class: 'panel-body' });
    const offs = [];
    const panel = createPanel({ cls: 'panel--today', label: '今天', view: 'today', onClose: () => offs.forEach((off) => off()) });
    append(panel.dialog, [head, body]);

    const go = (date) => {
      if (!date) return;
      state.date = date;
      state.expanded.clear();
      render(false);
    };

    const goToPlace = (id) => {
      panel.close();
      app.openPlace(id, { focus: true });
    };

    function renderHead(v) {
      const step = (label, iconId, date) => h('button', { class: 'icon-btn tp-step', type: 'button', 'aria-label': label, disabled: !date, onclick: () => go(date) }, icon(iconId));
      clear(head);
      append(head, [
        closeButton(panel),
        h('div', { class: 'tp-nav' },
          step('前一天', 'i-chevron-left', v.prev),
          h('div', { class: 'tp-date', 'aria-live': 'polite' },
            h('div', { class: 'tp-day' }, v.title, v.isToday ? h('span', { class: 'tp-today' }, '今天') : null),
            app.me ? h('div', { class: 'tp-who' }, `${app.me} 的行程`) : null),
          step('後一天', 'i-chevron-right', v.next)),
      ]);
    }

    function renderItem(it, idx) {
      const key = `${state.date}#${idx}`;
      const detailId = `td-detail-${idx}`;
      const text = textWithZh(it.text, it.zh);
      const lines = [
        text,
        it.note ? h('span', { class: 'td-note' }, it.note) : null,
        it.noteZh.map((zh) => h('span', { class: 'td-note td-note--zh' }, zh)),
      ];
      const place = it.placeId ? app.placeById(it.placeId) : null;
      const mark = tile(place ? categoryOf(place.category) : NO_PIN); // the category of the pin it points to, else a grey tile
      const main = it.placeId
        ? h('button', { class: 'td-main td-main--go', type: 'button', onclick: () => goToPlace(it.placeId) },
          mark,
          h('span', { class: 'td-lines' }, lines),
          h('span', { class: 'td-go' }, icon('i-pin'), '地圖'))
        : h('div', { class: 'td-main' }, mark, h('span', { class: 'td-lines' }, lines));

      const li = h('li', { class: 'td-item' });
      const row = h('div', { class: 'td-row' }, main);
      li.append(row);
      if (it.detail.length > 0) {
        const open = state.expanded.has(key);
        const detail = h('div', { class: 'td-detail', id: detailId, hidden: !open },
          it.detail.map((d) => h('p', { class: 'td-detail-line' }, textWithZh(d.text, d.zh))));
        const toggle = h('button', { class: 'td-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': detailId, 'aria-label': `細節：${it.text}` }, '細節', icon('i-chevron-down'));
        toggle.addEventListener('click', () => {
          const now = toggle.getAttribute('aria-expanded') !== 'true';
          if (now) state.expanded.add(key); else state.expanded.delete(key);
          toggle.setAttribute('aria-expanded', String(now));
          detail.hidden = !now;
        });
        row.append(toggle);
        li.append(detail);
      }
      return li;
    }

    function render(keepScroll) {
      const scroll = body.scrollTop;
      const trip = loadTripData(app.snapshot?.tabs);
      const v = todayView(trip, app.me, state.date, { places: app.places, translations: app.translations, today: app.currentDate(), night: app.currentNightDate() });
      renderHead(v);

      const parts = [];
      if (v.banner) {
        parts.push(h('div', { class: `td-banner td-banner--${v.banner.kind}` },
          h('p', { class: 'td-banner-main' }, v.banner.text),
          v.banner.sub ? h('p', { class: 'td-banner-sub' }, v.banner.sub) : null));
      }
      if (v.flight) {
        parts.push(h('div', { class: 'td-flight' }, icon('i-plane'),
          h('p', { class: 'td-flight-text' }, h('span', { class: 'td-when' }, v.flight.when), ' ', v.flight.text)));
      }
      if (v.hotel) {
        parts.push(h('button', { class: 'td-hotel', type: 'button', onclick: () => app.actions.hotel(v.hotelDate) }, // the night the row shows (before 06:00 on today: yesterday's), so the card agrees
          tile(categoryOf('hotel')),
          h('span', { class: 'td-hotel-main' }, h('span', { class: 'td-k' }, v.isToday ? '今晚住' : '這晚住'), textWithZh(v.hotel.name, v.hotel.zh)),
          h('span', { class: 'td-hotel-go' }, '韓文卡', icon('i-chevron-right'))));
      }
      parts.push(h('h2', { class: 'sec-title td-title' }, '行程'));
      if (!trip.ok) parts.push(h('p', { class: 'td-empty' }, '行程表讀不到。確認有網路，或到表上看看分頁有沒有被改名。'));
      else if (v.items.length === 0) parts.push(h('p', { class: 'td-empty' }, '這天表上沒有行程。'));
      else parts.push(h('ul', { class: 'td-items' }, v.items.map(renderItem)));

      clear(body);
      append(body, parts);
      body.scrollTop = keepScroll ? scroll : 0;
      state.sig = signatureOf(app);
    }

    render(false);
    // a poll that changed something this panel shows redraws it in place (same day, same scroll position, same open details)
    offs.push(app.on('snapshot', () => { if (signatureOf(app) !== state.sig) render(true); }));
    offs.push(app.on('me', () => render(false)));
    return panel;
  }

  app.openToday = openToday;
  app.actions.today = (dateISO) => openToday(typeof dateISO === 'string' ? dateISO : undefined);
}
