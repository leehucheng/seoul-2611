// 今天: the 今日菜單, a white paper menu board taped onto a carpet of ginkgo yellow. One line per stop of the day (my schedule from
// the Sheet), as in docs/design/g2b: on the left the time written in the stop's text, else today's opening hours of the pin it points
// to (only checked hours), else nothing; then a row of leader dots; on the right the name (Chinese, the Korean under it), which wraps
// only between words.
//   the circle in front of a line   ticks the stop off on this phone (done.js; nothing is sent anywhere). A done stop is struck out
//                                   and gets an ink check mark; so is a stop whose own time is more than 30 minutes past.
//   a yellow-pen circle             the current time, between the done stops and the next one (today only)
//   the next stop                   the first stop that is not done (next-stop.js): a 下一站 tag, 「N 分後」, and a 「Naver」 button that opens
//                                   the place's own page in Naver Map (not a route)
//   a line that has a pin           tap it: the 今天 page closes and the map flies to the pin
//   a line for other people         (next-stop.js myItems: it names people and not me) stays on the page, dimmed; it is never the next
//                                   stop, never done, never the pen's place and has no circle to tick. A stop that is done only
//                                   because its own time is past shows its check mark in a circle that is not a button.
//   last line                       tonight's hotel, and 「給司機看韓文地址」 (the hotel card)
// Above the board: the day switcher (the ‹ › buttons), how many stops, and who I am; under it the day strip, the trip's 11 days as chips
// (the date, the weekday, my number of stops; today has a yellow dot; a tap shows that day), and in front of them 「總覽」. The page opens on
// today when today is a trip day, else on the 全程總覽 (today-view.js startPage); 「總覽」 opens it on any day. Time only matters on today: on
// any other day a stop is done only when ticked for that day, and nothing is the next stop. Before the trip and after the flight home the
// banner and the flight reminder of the Sheet show first. Every Korean string has a smaller Chinese line.
// 全程總覽: the same panel with the title 「首爾 11/5–11/15」, a line under it (「還有 N 天出發」 / 「明天出發」 before the trip, 「旅程結束了」
// after it), before the trip the 行李清單 card, then one button per trip day (the date, that night's hotel if the Sheet has one, the first
// 3 stop names as the day page lists them and 「+N」, or 「還沒排行程」) that opens that day. Without the snapshot, a page shows 「正在讀行程…」
// and fills itself when it arrives.
// On the first and the last trip day (and on the 全程總覽 before the trip) a 「行李清單 N/46」 card sits under the banner / flight reminder,
// above the board's lines; a tap opens the packing screen over this page (ui/packing.js: it holds its own back-stack entry, this page stays
// open under it). Every page ends with a small muted 「版本 <build>」 once the service worker has said which build runs (app.getVersion()).
// On the 全程總覽 (after the packing card) and on every day page (in the same place, under the banner / flight reminder) a 「代購清單」 card with
// 「我的 N 項・已買 M」 opens the shopping screen over this page the same way (ui/shopping.js).
// Every trip-day page has 「編輯」 in the meta row: it turns the board into the edit list of that day (ui/schedule-editor.js: every stop of the day, drag to
// reorder, add, change, delete; nothing is sent before 「完成」), with the day arrows and the strip out of reach until it ends. A day kept in the app
// (App_Schedule) shows a small 「app 版」 tag next to its title; when the Sheet's lines of such a day changed since the app copy was made, a muted line under
// the banner / flight reminder says so (+added −removed ～changed) with 「看改了什麼」; it writes nothing (Claude imports the changes from a terminal).
//
// initToday(app) sets app.actions.today and app.openToday(dateISO?). Text from the Sheet only goes in through dom.js (textContent).
import { hasHangul } from '../i18n.js';
import { FAMILIES } from '../colors.js';
import { isMyItem, myItems, nextStop, stripTime, untilText } from '../next-stop.js';
import { categoryOf, hoursCard, menuHours } from '../place-view.js';
import { lineTexts, ownsDay, sheetChangeSummary, startingList } from '../schedule-ui.js';
import {
  OVERVIEW, TRIP_FIRST, TRIP_LAST, dayStrip, dayTitle, formatMD, isISODate, loadTripData, startPage, stopState, todayView, tripCountdown, tripDates,
} from '../today-view.js';
import { naverShopLink } from './card.js';
import { append, clear, famStyle, h, icon, leaf } from './dom.js';
import { openPacking, packingCard } from './packing.js';
import { createPanel, textWithZh } from './panel.js';
import { showMeButton } from './person.js';
import { createDayEditor } from './schedule-editor.js';
import { openShopping, shoppingCard } from './shopping.js';

const clean = (v) => String(v ?? '').trim();
const REFRESH_MS = 30000;
const DAY_MS = 86400000;

/** The marker of a stop that has no pin on the map: a grey one with the list icon. */
const NO_PIN = Object.freeze({ icon: 'i-list', color: FAMILIES.other.color, on: FAMILIES.other.on });

/** What a poll can change on this panel: the three tabs, the days kept in the app, the people, the places the items point to, the translations. */
const signatureOf = (app) => JSON.stringify([
  Boolean(app.snapshot), app.me, app.snapshot?.tabs?.Schedule, app.schedule?.rows(), app.snapshot?.tabs?.Flight, app.snapshot?.tabs?.Hotel, app.translations, [...app.ginkgo],
  app.places.map((p) => [p.id, p.category, p.name_zh, p.name_kr, p.name_en, p.aliases, p.hidden, p.lat, p.lng, p.verified, p.hours_json, p.source]),
  (app.julyPlaces ?? []).map((p) => [p.id, p.category, p.name_zh, p.name_kr, p.hidden]), // a stop can point to one of them by its id
]);

/**
 * What decides whether the page has to be built again: the shown day, the app's current date (`today`: at Seoul midnight the today dot,
 * the 今天 label and the flight pill move while the page stays open), the data (signatureOf), what is ticked, and which lines are done /
 * next / showing which hours, and where the pen sits. The clock's own minute is not in it: the pen's time and the 「N 分後」 are patched in
 * place (tick), so a tap is never swallowed by a rebuild that changed nothing.
 */
export const viewSignature = (date, today, dataSig, m) => JSON.stringify([
  date, today, dataSig, [...m.ticked].sort(), m.v.status, m.live, m.nowAt,
  m.rows.map((r) => [r.mine, r.isNext, r.byTime, r.done, r.price?.text ?? null, r.status]),
]);

/** 1 for the first day of the trip; null outside it. */
const tripDay = (iso) => (iso >= TRIP_FIRST && iso <= TRIP_LAST ? Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${TRIP_FIRST}T00:00:00Z`)) / DAY_MS) + 1 : null);

export { lineTexts }; // the two lines of a stop (schedule-ui.js: the edit list draws its rows with the same rule)

/**
 * The rows of the 全程總覽: one per trip day, 11/5 first. `title` is 「11/5（四）」; `hotel` the night's stay the day page shows for that date
 * (todayView's, null when the Sheet has none); `names` the first 3 stop names as the day page lists them (the same first line of every line of
 * the day, other people's included, in the same order); `more` how many stops come after those; `empty` when the day has no stops at all.
 * `ctx` is todayView's {places, translations, today, night}.
 */
export function overviewRows(trip, person, ctx) {
  return tripDates().map((date) => {
    const v = todayView(trip, person, date, ctx);
    const names = v.items.map((view) => lineTexts(view, null).first);
    return { date, title: dayTitle(date), hotel: v.hotel, names: names.slice(0, 3), more: Math.max(0, names.length - 3), empty: names.length === 0 };
  });
}

/** A line may wrap after a slash that separates names ("Name1/Name2/Name3 - TPE ..."): a zero-width break opportunity, so a long name list is not cut through the middle of a name. */
export const breakAtSlashes = (text) => String(text ?? '').replace(/\/(?=[^\s/])/g, '/​');

const pen = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 74 42');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M58 5.5C47 1.4 22 1.6 10.4 8.2 1.4 13.4 1.8 26 11.8 32.6c11.6 7.6 38.8 8 52.2 1.4 9.6-4.8 9-15.4-1-21.6-8.4-5.2-22.2-7.4-34-6.2');
  svg.append(path);
  return svg;
};

const underline = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 12');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M1.5 6.6C48 4.6 118 3.6 198.5 4.4l-.8 4.6C120 8.4 50 9.2 2.2 10.8z');
  svg.append(path);
  return svg;
};

export function initToday(app) {
  function openToday(dateArg) {
    app.closeCard();

    // no snapshot yet (the app opens this view as soon as the person is picked): the page says 「正在讀行程…」 and fills itself when it arrives
    const state = { date: isISODate(dateArg) ? dateArg : startPage(app.currentDate()), expanded: new Set(), waitOpen: new Set(), viewSig: '', stripDate: '', edit: null, editBtn: null };
    const meta = h('div', { class: 't-meta' });
    const days = h('div', { class: 't-days', role: 'group', 'aria-label': '選哪一天' });
    const lines = h('ol', { class: 'lines' });
    const scroll = h('div', { class: 'board-scroll' });
    const bh = h('header', { class: 'bh' });
    const board = h('article', { class: 'board' },
      h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }), h('span', { class: 'tape bl' }), h('span', { class: 'tape br' }), bh, scroll);
    const offs = [];
    let packingScreen = null; // the packing screen that is open over this page, if any
    let shoppingScreen = null; // the shopping screen that is open over this page, if any
    let closed = false;
    let version = null; // the build this page runs, once the service worker has said (app.getVersion)
    const versionLine = h('p', { class: 't-ver' });
    const panel = createPanel({
      cls: 'panel--today', label: '今天', view: 'today',
      // Esc (and a browser's close request) leave the edit mode, asking first when something changed, instead of closing the page; the phone's Back reaches the editor's own entry first
      onBack: () => { if (state.edit) state.edit.requestCancel(); else panel.close(); },
      onClose: () => { closed = true; offs.forEach((off) => off()); state.edit?.dispose(); packingScreen?.close(); shoppingScreen?.close(); },
    });
    append(panel.dialog, [meta, days, board]);
    const packing = packingCard(app, (trigger) => { // built once: a redraw of the page puts the same button back, so focus can return to it
      packingScreen?.close();
      packingScreen = openPacking(app, { behind: [panel.dialog, document.getElementById('tabbar')], trigger, onClose: () => { packingScreen = null; } });
    });
    offs.push(app.on('packing', packing.paint));
    const shopping = shoppingCard(app, (trigger) => { // built once, like the packing card
      shoppingScreen?.close();
      shoppingScreen = openShopping(app, { behind: [panel.dialog, document.getElementById('tabbar')], trigger, onClose: () => { shoppingScreen = null; } });
    });
    offs.push(app.on('shopping', shopping.paint));

    const go = (date) => {
      if (!date || state.edit) return; // the day being edited stays: 「取消」 or 「完成」 first
      state.date = date;
      state.expanded.clear();
      render(false);
    };

    const goToPlace = (id) => {
      panel.close();
      app.openPlace(id, { focus: true });
    };

    /** The switcher row. `v` is a day's view, or {date: OVERVIEW} (no arrows: the day switcher stays inside the trip). 「編輯」 is on a trip day that can be edited. */
    function renderMeta(v, stopCount) {
      const editing = Boolean(state.edit);
      const step =(label, iconId, date) => h('button', { class: 'round tp-step', type: 'button', 'aria-label': label, disabled: !date || editing, onclick: () => go(date) }, icon(iconId));
      const day = tripDay(v.date);
      const me = h('button', { class: 'me', type: 'button', onclick: () => app.switchPerson() });
      if (app.me) showMeButton(me, app.me);
      const label = v.date === OVERVIEW ? '全程總覽'
        : [day ? `第 ${day} 天` : '不在行程內', app.snapshot ? [' ・ ', stopCount > 0 ? `${stopCount} 站` : '沒有行程'] : null]; // no stop count before the data is in
      const canEdit = !editing && day !== null && v.date !== OVERVIEW && Boolean(app.schedule) && Boolean(app.snapshot) && startingList(app.snapshot.tabs, app.schedule.rows(), v.date).ok;
      state.editBtn = canEdit ? h('button', { class: 't-edit', type: 'button', 'aria-label': '編輯這天的行程', onclick: () => startEdit() }, '編輯') : null;
      clear(meta);
      append(meta, [
        step('前一天', 'i-chevron-left', v.prev),
        h('p', { class: 't-day', 'aria-live': 'polite' }, leaf(), h('span', null, label)),
        step('後一天', 'i-chevron-right', v.next),
        state.editBtn,
        me,
      ]);
    }

    /** 「編輯」: the board becomes the edit list of the shown day (ui/schedule-editor.js); the page under it stops redrawing until the editor is done. */
    function startEdit() {
      if (state.edit || state.date === OVERVIEW || tripDay(state.date) === null || !app.schedule || !app.snapshot) return;
      const editor = createDayEditor(app, {
        date: state.date, scroll, behind: [panel.dialog], lock: [document.getElementById('tabbar')],
        onExit: () => {
          state.edit = null;
          render(false);
          state.editBtn?.focus?.({ preventScroll: true });
        },
      });
      if (!editor) return;
      state.edit = editor;
      renderEditing(true);
    }

    /** The edge fade of the day strip, like the filter row: an edge fades while there are chips beyond it. */
    function fadeDays() {
      days.classList.toggle('fade-l', days.scrollLeft > 4);
      days.classList.toggle('fade-r', days.scrollLeft < days.scrollWidth - days.clientWidth - 4);
    }
    days.addEventListener('scroll', fadeDays, { passive: true });
    window.addEventListener('resize', fadeDays);
    offs.push(() => window.removeEventListener('resize', fadeDays));

    const chips = new Map(); // date -> its button; made once, then updated in place, so a tapped chip keeps its focus and the strip its scroll

    /**
     * The day strip: 「總覽」 first, then one chip per trip day (today-view.js dayStrip). The chip of the shown page is centred when the page
     * changes (and on open). `v.date` is a trip day or OVERVIEW.
     */
    function renderStrip(trip, v) {
      days.inert = Boolean(state.edit); // the day being edited stays: the chips are out of reach until 「取消」 or 「完成」
      let all = chips.get(OVERVIEW);
      if (!all) {
        all = h('button', { class: 'dchip', type: 'button', 'aria-label': '全程總覽', onclick: () => go(OVERVIEW) }, h('b', { class: 'dd' }, '總覽'));
        chips.set(OVERVIEW, all);
        days.append(all);
      }
      all.setAttribute('aria-pressed', String(v.date === OVERVIEW));
      for (const d of dayStrip(trip, app.me, { selected: v.date, today: app.currentDate() })) {
        let chip = chips.get(d.date);
        if (!chip) {
          chip = h('button', { class: 'dchip', type: 'button', onclick: () => go(d.date) },
            h('b', { class: 'dd' }, d.md), h('span', { class: 'dw' }, h('span', null, d.weekday), h('i')));
          chips.set(d.date, chip);
          days.append(chip);
        }
        chip.setAttribute('aria-pressed', String(d.isSelected));
        chip.setAttribute('aria-label', d.label);
        chip.classList.toggle('is-today', d.isToday);
        chip.querySelector('i').textContent = d.count > 0 ? `${d.count}站` : '';
      }
      const shown = chips.get(v.date);
      if (shown && state.stripDate !== v.date) {
        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        days.scrollTo({ left: Math.max(0, shown.offsetLeft - (days.clientWidth - shown.offsetWidth) / 2), behavior: state.stripDate && !calm ? 'smooth' : 'auto' });
      }
      state.stripDate = v.date;
      fadeDays();
    }

    function renderHead(v) {
      const m = /^(\d+\/\d+)/.exec(v.title); // the weekday ('（四）') is on the day strip's chip, so it is not repeated here
      const kept = Boolean(app.schedule) && ownsDay(app.schedule.rows(), v.date); // this day is the app's copy, not the Sheet's lines
      clear(bh);
      bh.append(h('h1', null,
        h('span', { class: 'ttl' }, h('span', null, state.edit ? '編輯行程' : v.isToday ? '今日菜單' : '行程菜單'), underline()),
        h('span', { class: 'date' }, m ? m[1] : v.title),
        kept ? h('span', { class: 'ver-tag', 'aria-label': 'app 版：這天顯示的是 app 裡的版本，不是 Sheet 上的原樣' }, 'app 版') : null));
    }

    /** The muted line under the banner of an app-owned day whose Sheet lines changed since the copy was made: the counts, and 「看改了什麼」 for the list. Writes nothing. */
    function renderWaiting(date, w) {
      const id = `sch-wait-${date}`;
      const open = state.waitOpen.has(date);
      const list = h('ul', { class: 'sch-wait-list', id, hidden: !open }, w.lines.map((line) => h('li', null, line)));
      const toggle = h('button', { class: 'sch-wait-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': id }, '看改了什麼', icon('i-chevron-down'));
      toggle.addEventListener('click', () => {
        const now = toggle.getAttribute('aria-expanded') !== 'true';
        if (now) state.waitOpen.add(date); else state.waitOpen.delete(date);
        toggle.setAttribute('aria-expanded', String(now));
        list.hidden = !now;
      });
      return h('div', { class: 'sch-wait' }, h('p', { class: 'sch-wait-line' }, w.text), toggle, list);
    }

    /** What the board shows while a day is edited: the head (「編輯行程」), the meta row and the strip made unreachable, and the editor's list in the board. */
    function renderEditing(mount) {
      const m = build(new Date());
      renderMeta(m.v, m.mine.length);
      renderStrip(m.trip, m.v);
      renderHead(m.v);
      board.setAttribute('aria-label', `${app.me ?? ''} 編輯 ${m.v.title}`.trim());
      if (mount) {
        clear(scroll);
        append(scroll, [state.edit.element]);
        scroll.scrollTop = 0;
        state.edit.element.focus?.({ preventScroll: true });
      }
    }

    /** One stop as a menu line. r = {view, place, cat, mine, done, byTime, isNext, price, ginkgo, next}. */
    function renderStop(r, idx) {
      const { view, place } = r;
      const { first, second } = lineTexts(view, place);
      const detailId = `td-detail-${idx}`;

      // The circle in front: a button that ticks the stop; but not for a line that is someone else's (nothing to tick) and not for a
      // stop that is done because its own time is past (a tick could not bring it back), which show their state and are not buttons.
      // A done stop is an ink check mark (the ginkgo leaf is only for favourites and the places of the 銀杏 tab).
      let chk;
      if (!r.mine) {
        chk = h('span', { class: 'chk chk--fixed', 'aria-hidden': 'true' }, h('span', { class: 'chk-c' }));
      } else if (r.byTime) {
        chk = h('span', { class: 'chk chk--fixed', role: 'img', 'aria-label': `已完成，時間已過：${first}` }, h('span', { class: 'chk-c' }, icon('i-check', 'chk-tick')));
      } else {
        chk = h('button', {
          class: 'chk', type: 'button', 'aria-pressed': String(r.done), 'aria-label': `${r.done ? '改回還沒做' : '標為已完成'}：${first}`,
          onclick: () => app.toggleDone(state.date, view.key),
        }, h('span', { class: 'chk-c' }, r.done ? icon('i-check', 'chk-tick') : null));
      }

      // The menu line, as in the design: the time (or today's checked hours) on the left, a run of leader dots, the name on the right.
      const mk = famStyle(h('span', { class: 'mk' }, icon(r.cat.icon), r.ginkgo ? leaf() : null), r.cat);
      const name = h('span', { class: 'li-name' },
        h('span', { class: 'li-first' }, mk, h('b', { lang: hasHangul(first) ? 'ko' : undefined }, breakAtSlashes(first))),
        second ? h('span', { class: 'kr2', lang: 'ko' }, second) : null,
        r.mine ? null : h('span', { class: 'sr' }, '（別人的行程）'));

      const whenKids = [];
      if (r.price) whenKids.push(h('b', { class: r.price.time ? 'p-time' : 'p-hours' }, r.price.text));
      if (r.isNext) {
        whenKids.push(h('span', { class: 'tag' }, '下一站'));
        if (r.next.time) whenKids.push(h('i', null, untilText(r.next.inMinutes)));
        else if (r.status) whenKids.push(h('i', null, r.status));
      }
      const when = whenKids.length ? h('span', { class: 'when' }, whenKids) : null;

      const bodyKids = [when, h('i', { class: 'ld' }), name]; // leader dots on every line, so the names line up on the right whether or not there is a time
      const body = place
        ? h('button', { class: 'li-body li-body--go', type: 'button', 'aria-label': `${first}，在地圖上看`, onclick: () => goToPlace(place.id) }, bodyKids)
        : h('div', { class: 'li-body' }, bodyKids);

      const li = h('li', { class: `li${r.done ? ' past' : ''}${r.isNext ? ' nx' : ''}${r.mine ? '' : ' other'}` }, h('div', { class: 'li-row' }, chk, body));

      if (r.isNext && place) {
        const go = naverShopLink(place, {}, 'go-btn', 'Naver', h('span', { class: 'chip-ink' }, icon('i-arrow')));
        go.setAttribute('aria-label', `在 Naver 看 ${first}`);
        li.append(go);
      }

      const noteLines = [
        view.note ? h('span', { class: 'td-note' }, view.note) : null,
        view.noteZh.map((zh) => h('span', { class: 'td-note td-note--zh' }, zh)),
      ];
      const hasMore = Boolean(view.note) || view.noteZh.length > 0 || view.detail.length > 0;
      if (hasMore) {
        const more = h('div', { class: 'li-more' }, noteLines);
        if (view.detail.length > 0) {
          const key = `${state.date}#${idx}`;
          const open = state.expanded.has(key);
          const detail = h('div', { class: 'td-detail', id: detailId, hidden: !open },
            view.detail.map((d) => h('p', { class: 'td-detail-line' }, textWithZh(d.text, d.zh))));
          const toggle = h('button', { class: 'td-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': detailId, 'aria-label': `細節：${first}` }, '細節', icon('i-chevron-down'));
          toggle.addEventListener('click', () => {
            const now = toggle.getAttribute('aria-expanded') !== 'true';
            if (now) state.expanded.add(key); else state.expanded.delete(key);
            toggle.setAttribute('aria-expanded', String(now));
            detail.hidden = !now;
          });
          more.append(toggle, detail);
        }
        li.append(more);
      }
      return li;
    }

    function renderNow(at) {
      const label = clockLabel(at);
      return h('li', { class: 'nowl', 'aria-label': `現在 ${label}` }, h('span', { class: 't' }, label, pen()), h('span', { class: 'tx' }, '現在'));
    }

    const clockLabel = (at) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

    /** Everything the page shows for the clock `at`: the day's view, my lines, which are done / next, the pen's place (the 全程總覽: its rows). */
    function build(at) {
      const trip = loadTripData(app.snapshot?.tabs, app.schedule?.rows());
      if (state.date === OVERVIEW) {
        const today = app.currentDate();
        const rows = app.snapshot && trip.ok ? overviewRows(trip, app.me, { places: app.places, translations: app.translations, today, night: app.currentNightDate() }) : [];
        return { overview: true, at, trip, today, rows };
      }
      const v = todayView(trip, app.me, state.date, { places: app.places, translations: app.translations, today: app.currentDate(), night: app.currentNightDate(), named: app.julyPlaces });
      const mine = myItems(v.items, app.me); // the lines that are mine: the only ones that can be the next stop, count as done, or give the pen's place
      const ticked = app.doneSet(state.date);
      const live = v.isToday && v.status === 'in'; // the same rule as the strip (main.js todayStops): only while I am in Korea today
      const next = live ? nextStop(mine, at, ticked) : null;
      const rows = v.items.map((view) => {
        const place = view.placeId ? app.placeById(view.placeId) : null;
        const isMine = isMyItem(view, app.me);
        const hours = place ? hoursCard(place, at)?.status : null;
        return {
          view, place, mine: isMine, next,
          isNext: Boolean(next) && next.item === view,
          cat: place ? categoryOf(place.category) : NO_PIN,
          ...stopState(view, { isToday: v.isToday, mine: isMine, at, ticked }), // byTime, done: the clock only counts on today
          ginkgo: Boolean(place && app.ginkgo.has(place.id)) || /^銀杏/.test(stripTime(view.text)), // on the 銀杏 tab, or written as a 「銀杏 - …」 stop
          price: view.time ? { text: view.time, time: true } : (() => { const t = place ? menuHours(place, at) : null; return t ? { text: t, time: false } : null; })(),
          status: hours?.tone === 'open' ? '營業中' : hours?.tone === 'closed' ? '已打烊' : '',
        };
      });
      const nowAt = live ? (next ? rows.findIndex((r) => r.isNext) : rows.length) : -1;
      return { at, trip, v, mine, ticked, live, next, rows, nowAt };
    }

    const viewSig = (m) => (m.overview ? JSON.stringify([OVERVIEW, m.today, signatureOf(app)]) : viewSignature(state.date, app.currentDate(), signatureOf(app), m));

    /** The one muted line at the end of a page, once the build is known (nothing before: no worker, or one that did not answer). */
    const versionParts = () => (version ? [versionLine] : []);

    /** One day of the 全程總覽 as a button that opens that day: the date, that night's hotel when the Sheet has one, the first stop names. */
    function renderOverviewRow(row) {
      const stay = row.hotel
        ? h('span', { class: 'ov-stay' }, famStyle(h('span', { class: 'mk' }, icon('i-bed')), categoryOf('hotel')), h('span', { class: 'sr' }, '住：'),
          h('b', { lang: row.hotel.zh ? undefined : 'ko' }, row.hotel.zh || row.hotel.name))
        : null;
      const stops = row.empty
        ? h('span', { class: 'ov-none' }, '還沒排行程')
        : h('span', { class: 'ov-stops' },
          row.names.map((name) => h('span', { class: 'ov-stop', lang: hasHangul(name) ? 'ko' : undefined }, name)),
          row.more > 0 ? h('b', { class: 'ov-more' }, `+${row.more}`) : null);
      return h('li', { class: 'ov-li' },
        h('button', { class: 'ov-day', type: 'button', onclick: () => go(row.date) },
          h('span', { class: 'ov-head' }, h('b', { class: 'ov-date' }, row.title), icon('i-chevron-right')),
          stay, stops));
    }

    /** The 全程總覽 in the same panel: the meta row without arrows, the strip, the title and its line, then the packing card (before the trip) and the 11 days. */
    function renderOverview({ trip, today, rows }) {
      renderMeta({ date: OVERVIEW }, 0);
      renderStrip(trip, { date: OVERVIEW });
      const range = `${formatMD(TRIP_FIRST)}–${formatMD(TRIP_LAST)}`;
      const countdown = tripCountdown(today);
      clear(bh);
      append(bh, [
        h('h1', null, h('span', { class: 'ttl' }, h('span', null, '首爾'), underline()), ' ', h('span', { class: 'date' }, range)),
        countdown ? h('p', { class: 'ov-sub' }, countdown) : null,
      ]);
      board.setAttribute('aria-label', `${app.me ?? ''} 的全程總覽 首爾 ${range}`.trim());

      const parts = [];
      if (today < TRIP_FIRST && packing.sync(TRIP_FIRST)) parts.push(packing.element); // the same card, count and screen as on the first day; before the trip only
      shopping.paint();
      parts.push(shopping.element);
      if (!app.snapshot) parts.push(h('p', { class: 'td-empty' }, '正在讀行程…'));
      else if (!trip.ok) parts.push(h('p', { class: 'td-empty' }, '行程表讀不到。確認有網路，或到表上看看分頁有沒有被改名。'));
      else parts.push(h('ol', { class: 'ov-days' }, rows.map(renderOverviewRow)));
      parts.push(versionParts());
      clear(scroll);
      append(scroll, parts);
    }

    function render(keepScroll, built) {
      if (state.edit) { renderEditing(false); return; } // the editor owns the board until it is done
      const top = scroll.scrollTop;
      const m = built ?? build(new Date());
      if (m.overview) {
        renderOverview(m);
        scroll.scrollTop = keepScroll ? top : 0;
        state.viewSig = viewSig(m);
        return;
      }
      const { at, trip, v, mine, live, next, rows, nowAt } = m;
      renderMeta(v, mine.length);
      renderStrip(trip, v);
      renderHead(v);
      board.setAttribute('aria-label', `${app.me ?? ''} 的${v.isToday ? '今日' : ''}菜單 ${v.title}`.trim());

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
      const waiting = app.schedule ? sheetChangeSummary(app.snapshot?.tabs, app.schedule.rows(), v.date) : null; // under the banner / flight reminder
      if (waiting) parts.push(renderWaiting(v.date, waiting));
      if (packing.sync(v.date)) parts.push(packing.element); // only on TRIP_FIRST and TRIP_LAST
      shopping.paint();
      parts.push(shopping.element); // on every day page, under the packing card's place

      clear(lines);
      rows.forEach((r, i) => {
        if (i === nowAt) lines.append(renderNow(at));
        lines.append(renderStop(r, i));
      });
      if (nowAt === rows.length && rows.length > 0) lines.append(renderNow(at));

      let body;
      if (!app.snapshot) body = h('p', { class: 'td-empty' }, '正在讀行程…');
      else if (!trip.ok) body = h('p', { class: 'td-empty' }, '行程表讀不到。確認有網路，或到表上看看分頁有沒有被改名。');
      else if (v.items.length === 0) body = h('p', { class: 'td-empty' }, '這天表上沒有行程。');
      else body = lines;

      parts.push(body);
      if (v.hotel) {
        parts.push(h('div', { class: 'hotel-foot' },
          h('div', { class: 'hr2', 'aria-hidden': 'true' }),
          h('div', { class: 'li hotel' },
            h('div', { class: 'li-row li-row--hotel' },
              h('div', { class: 'li-body' },
                h('span', { class: 'li-name' }, h('b', { class: 'hotel-k' }, v.isToday ? '今晚住' : '這晚住')),
                h('i', { class: 'ld' }),
                h('span', { class: 'hotel-v' }, famStyle(h('span', { class: 'mk' }, icon('i-bed')), categoryOf('hotel')),
                  // Chinese first, the Korean name small under it (as on every stop); with no translation the Korean name stands alone
                  h('span', { class: 'hotel-tx' },
                    h('b', { lang: v.hotel.zh ? undefined : 'ko' }, v.hotel.zh || v.hotel.name),
                    v.hotel.zh ? h('span', { class: 'kr2', lang: 'ko' }, v.hotel.name) : null)))),
            h('button', { class: 'addr', type: 'button', onclick: () => app.actions.hotel(v.hotelDate) }, icon('i-id'), '給司機看韓文地址')))); // the night the row shows (before 06:00 on today: yesterday's), so the card agrees
      }
      parts.push(versionParts());

      clear(scroll);
      append(scroll, parts);
      scroll.scrollTop = keepScroll ? top : 0;
      state.viewSig = viewSig(m);
    }

    /** A refresh without a rebuild unless something the page shows changed; the clock's minute is only patched in (see viewSig). */
    function tick() {
      if (state.edit) return; // the editor holds the board; a poll must not replace it (the list is made again from the fresh data only after a 「stale」)
      const m = build(new Date());
      if (viewSig(m) !== state.viewSig) { render(true, m); return; }
      if (m.overview) return; // nothing on it follows the clock's minute
      const label = clockLabel(m.at);
      const t = scroll.querySelector('.nowl .t');
      if (t?.firstChild && t.firstChild.nodeValue !== label) { t.firstChild.nodeValue = label; t.parentElement.setAttribute('aria-label', `現在 ${label}`); }
      const until = scroll.querySelector('.li.nx .when i');
      if (until && m.next?.time) until.textContent = untilText(m.next.inMinutes);
    }

    render(false);
    Promise.resolve(app.getVersion?.()).then((build) => { // the build line shows up a moment after the page, if a worker answers
      if (closed || typeof build !== 'string' || build === '') return;
      version = build;
      versionLine.textContent = `版本 ${build}`;
      render(true);
    }, () => {});
    // a poll that changed something this page shows redraws it in place (same day, same scroll position, same open details)
    offs.push(app.on('snapshot', tick));
    offs.push(app.on('schedule', tick)); // a day saved from this phone (or reset) shows at once
    offs.push(app.on('me', () => render(false)));
    offs.push(app.on('done', () => render(true)));
    const timer = setInterval(() => { if (!document.hidden) tick(); }, REFRESH_MS); // the pen circle and the next stop follow the clock
    offs.push(() => clearInterval(timer));
    return panel;
  }

  app.openToday = openToday;
  app.actions.today = (dateISO) => openToday(typeof dateISO === 'string' ? dateISO : undefined);
}
