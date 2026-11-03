// The 下一站 strip at the top of the map, on the same row as who-am-I: the first of today's stops (my schedule, in order) that is not
// done yet (next-stop.js: ticked on this phone, or a time written in its text more than 30 minutes past).
//   timed stop    its time and 「N 分後」
//   untimed stop  today's open / closed state of the pin it points to (營業中 再 N 小時 / 已打烊 N 小時後開), or nothing when no
//                 checked hours are known
// Tapping it opens the pin's card (a stop with no pin on the map opens the 今天 page). With no stop left it is hidden. The map is told
// which place it is (map.setNextStop), so that pin's name capsule ranks just below the selected pin's.
//
// initNextBar(app, el): reads app.todayStops(), app.doneSet(date), app.placeById, app.translations; refreshes on snapshot / me / done / schedule
// and every 30 seconds while the page is visible.
import { FAMILIES } from '../colors.js';
import { nextStop, shortDuration, untilText } from '../next-stop.js';
import { categoryOf, hoursCard } from '../place-view.js';
import { stopName } from '../today-view.js';
import { clear, famStyle, h, icon } from './dom.js';

const REFRESH_MS = 30000;
/** The marker of a stop that has no pin on the map. */
const NO_PIN = Object.freeze({ icon: 'i-list', color: FAMILIES.other.color, on: FAMILIES.other.on });

/** What the strip says for the next stop: {name, place, cat, time, sub, state} (time / sub / state may be empty). */
export function describeNext(app, now = new Date()) {
  const stops = app.todayStops();
  const next = stops.length ? nextStop(stops, now, app.doneSet(app.currentDate())) : null;
  if (!next) return null;
  const view = next.item;
  const place = view.placeId ? app.placeById(view.placeId) : null;
  const out = { name: stopName(view, place, app.translations), place, cat: place ? categoryOf(place.category) : NO_PIN, time: next.time ?? '', sub: '', state: '' };
  if (next.time) {
    out.sub = untilText(next.inMinutes);
  } else {
    const st = place ? hoursCard(place, now)?.status : null;
    if (st?.tone === 'open') { out.state = '營業中'; out.sub = st.leftMin != null ? `再 ${shortDuration(st.leftMin)}` : ''; }
    else if (st?.tone === 'closed') { out.state = '已打烊'; out.sub = st.opensInMin != null ? `${shortDuration(st.opensInMin)}後開` : ''; }
  }
  return out;
}

export function initNextBar(app, el = document.getElementById('nextbar')) {
  let current = null;

  let shown = ''; // what the strip says now: a refresh that says the same thing leaves the button alone (a rebuild between press and release swallows a tap)
  function render() {
    const d = describeNext(app);
    current = d;
    app.map?.setNextStop?.(d?.place?.id ?? null); // the pin of this stop keeps its name on the map (a no-op when it is the same stop as before)
    const key = JSON.stringify(d && [d.name, d.cat.icon, d.cat.color, d.time, d.sub, d.state, d.place?.id ?? null]);
    if (key === shown) return;
    shown = key;
    el.hidden = !d;
    clear(el);
    if (!d) return;
    const lead = d.time || d.state;
    if (lead) {
      el.append(h('span', { class: `nb-time${d.time ? '' : ' nb-time--txt'}` }, h('b', null, lead), d.sub ? h('i', null, d.sub) : null));
    }
    el.append(h('span', { class: 'nb-txt' }, h('i', null, '下一站'), h('b', null, d.name)), h('span', { class: 'nb-chip' }, icon(d.cat.icon)));
    famStyle(el.querySelector('.nb-chip'), d.cat);
    el.setAttribute('aria-label', `下一站 ${[lead, d.sub].filter(Boolean).join(' ')} ${d.name}。${d.place ? '打開店家資訊' : '打開今天的行程'}`.replace(/\s+/g, ' '));
  }

  el.addEventListener('click', () => {
    if (!current) return;
    if (current.place && app.openPlace(current.place.id)) return;
    app.actions.today();
  });

  for (const ev of ['snapshot', 'me', 'done', 'schedule']) app.on(ev, render);
  setInterval(() => { if (!document.hidden) render(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  render();
  return { render };
}
