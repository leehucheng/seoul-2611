// View model of the 今天 panel. Pure (no DOM, no globals) so it runs in Node tests.
// Which date to show, how far the day switcher may go, the flight shown before the trip starts, the wording of the
// banner / flight lines, and each schedule item with its Chinese line and the pin it points to.
// Flight numbers and hotel names are never written here: they come from the Sheet at runtime.
import { doneKeys } from './done.js';
import { findHotelPlace } from './hotel-view.js';
import { hasHangul, zhOf } from './i18n.js';
import { matchPlace } from './match.js';
import { isPastByTime, isStopDone, itemTime, myItems, stripTime } from './next-stop.js';
import { placeName } from './pin-labels.js';
import { isHidden } from './place-view.js';
import { parseFlights, parseHotels, parseSchedule } from './sheet-parse.js';
import { buildToday, nightDateISO, todayISO } from './today.js';

export const TRIP_FIRST = '2026-11-05'; // the day switcher stays inside the trip
export const TRIP_LAST = '2026-11-15';

const clean = (v) => String(v ?? '').trim();
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

// ---- dates ------------------------------------------------------------------------------------------------

/** A real calendar date written 'YYYY-MM-DD' ('2026-02-30' is not one). */
export function isISODate(s) {
  const m = ISO.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** `?debug=1&date=YYYY-MM-DD` -> that date (for testing only); anything else, a bad date, or no `debug=1` -> null. */
export function debugDate(search) {
  const q = new URLSearchParams(String(search ?? ''));
  const date = q.get('date');
  return q.get('debug') === '1' && isISODate(date) ? date : null;
}

/** The date the app treats as today: the debug date when the address has one, else the date in Seoul right now. */
export const currentDate = (now, search) => debugDate(search) ?? todayISO(now);

/** A date pulled into the trip: before 11/5 -> 11/5, after 11/15 -> 11/15, inside it unchanged. */
export const clampToTrip = (iso) => (iso < TRIP_FIRST ? TRIP_FIRST : iso > TRIP_LAST ? TRIP_LAST : iso);

/**
 * The day the 今天 panel opens on: today when today is a trip day, else the nearest end of the trip (before it the page would be an empty
 * 「不在行程內」), and `?debug=1&date=` still wins, even outside the trip. Only the panel's first page: what is "today" (the 今日菜單 title,
 * the next stop, ticks by time, the hotel of the night) stays currentDate() / currentNightDate().
 */
export const panelStartDate = (now, search) => debugDate(search) ?? clampToTrip(todayISO(now));

/**
 * The night the app treats as tonight, for the hotel lookup: the debug date when the address has one (an explicit date is never
 * shifted), else the Seoul date of (now - 6 h), so 00:00-06:00 still shows the hotel slept in, not the one checked into later that day.
 */
export const currentNightDate = (now, search) => debugDate(search) ?? nightDateISO(now);

export const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The days the arrows lead to, null when there is none (the button is disabled). Inside 11/5-11/15 it is the next day;
 * a date outside the trip (the panel opens on today, which may be before the trip) is pulled to the nearest end.
 */
export function dayNeighbours(iso) {
  return {
    prev: iso <= TRIP_FIRST ? null : iso > TRIP_LAST ? TRIP_LAST : shiftDate(iso, -1),
    next: iso >= TRIP_LAST ? null : iso < TRIP_FIRST ? TRIP_FIRST : shiftDate(iso, 1),
  };
}

/** '2026-11-05' -> '11/5' */
export function formatMD(iso) {
  const m = ISO.exec(clean(iso));
  return m ? `${+m[2]}/${+m[3]}` : clean(iso);
}

const WEEKDAYS = '日一二三四五六';
/** '2026-11-05' -> '四' ('' for anything that is not a date) */
export const weekdayOf = (iso) => (isISODate(iso) ? WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] : '');
/** '2026-11-05' -> '11/5（四）' */
export function dayTitle(iso) {
  if (!isISODate(iso)) return clean(iso);
  return `${formatMD(iso)}（${weekdayOf(iso)}）`;
}

/** The trip's days, 11/5 to 11/15: ['2026-11-05', ..., '2026-11-15']. */
export function tripDates() {
  const dates = [];
  for (let d = TRIP_FIRST; d <= TRIP_LAST; d = shiftDate(d, 1)) dates.push(d);
  return dates;
}

/** 「11/5 入住，11/9 退房」 for the hotel card (the Sheet's `to` date is the check-out day). */
export const stayLabel = (stay) => `${formatMD(stay.from)} 入住，${formatMD(stay.to)} 退房`;

// ---- flights ----------------------------------------------------------------------------------------------

const AIRPORTS = { ICN: '仁川', GMP: '金浦', TPE: '桃園', TSA: '松山' };
export const airportZh = (code) => AIRPORTS[clean(code).toUpperCase()] ?? clean(code);

// '9:05' -> '09:05', so that departures on one day sort as times
const timeKey = (dep) => { const m = /^(\d{1,2}):(\d{2})/.exec(clean(dep)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

/** The person's first flight to Korea (earliest date, then time), from parseFlights(); null when the Sheet lists none. */
export function outboundFlight(flights, person) {
  const mine = (flights ?? []).filter((f) => f?.dir === 'out' && f.date && Array.isArray(f.people) && f.people.includes(person));
  mine.sort((a, b) => (a.date + timeKey(a.dep)).localeCompare(b.date + timeKey(b.dep)));
  return mine[0] ?? null;
}

/** The pill in front of a flight: 今天 / 明天 only against the app's real today (`today`), any other day is written as its date ('11/5'). */
export function flightWhen(date, today) {
  if (isISODate(today) && date === today) return '今天';
  if (isISODate(today) && date === shiftDate(today, 1)) return '明天';
  return formatMD(date);
}

/**
 * buildToday().flight -> {when: '今天'|'明天'|'11/5', text: '09:00 <flight> 仁川出發'}; null when there is no flight to show. `today` is the
 * app's current date (the panel may show another day than today: a flight is then named by its date, not 今天 / 明天).
 */
export function flightView(flight, today = '') {
  if (!flight) return null;
  const text = [clean(flight.dep), clean(flight.flight), flight.from ? `${airportZh(flight.from)}出發` : ''].filter(Boolean).join(' ');
  return { when: flightWhen(flight.date, today), text };
}

/** The line shown before the trip: 「還沒出發，你的去程是 M/D HH:MM 航班號」 (just 「還沒出發」 when the Sheet has no outbound flight). */
export function beforeText(out) {
  if (!out) return '還沒出發';
  return `還沒出發，你的去程是 ${[formatMD(out.date), clean(out.dep), clean(out.flight)].filter(Boolean).join(' ')}`;
}

/**
 * The note above the flight / hotel / items, or null.
 * before: the outbound flight. after: 「你已回台」, but only when the Sheet has no hotel for this night (a booked hotel is the
 * more specific fact, so it is shown instead of a contradicting "already home").
 */
export function bannerFor({ status, hotel }, flights, person) {
  if (status === 'before') return { kind: 'before', text: beforeText(outboundFlight(flights, person)) };
  if (status === 'after' && !hotel) return { kind: 'after', text: '你已回台', sub: '這天的行程還是列在下面，可以看大家去哪。' };
  return null;
}

// ---- data and items ---------------------------------------------------------------------------------------

const guarded = (fn, rows) => { try { return fn(Array.isArray(rows) ? rows : []); } catch { return null; } };

/** Parse the three tabs of the snapshot. `ok` is false when the Schedule tab gave no days (missing tab, changed layout). */
export function loadTripData(tabs) {
  const days = guarded(parseSchedule, tabs?.Schedule) ?? [];
  const flights = guarded(parseFlights, tabs?.Flight) ?? [];
  const hotels = guarded(parseHotels, tabs?.Hotel)?.hotels ?? [];
  return { days, flights, hotels, ok: days.length > 0 };
}

const zhFor = (s, translations) => (hasHangul(s) ? zhOf(s, translations) : null);

/**
 * One schedule item for display. `zh` / `detail[].zh` / `noteZh` are the Chinese lines of the Korean parts (nothing when the
 * snapshot has no translation); `placeId` is the pin the item points to (hidden places never count), or null.
 * The note is two Sheet cells joined with '；' by the parser, so it is translated part by part.
 * `time` is the explicit 'HH:MM' written in the text, not one end of a range (null when there is none: most lines have none); `key`
 * is the item's done.js key: its text + which of the identical lines of the day it is.
 */
export function itemViews(items, places, translations) {
  const visible = (places ?? []).filter((p) => !isHidden(p));
  const keys = doneKeys(items);
  return (items ?? []).map((it, i) => {
    const text = clean(it.text);
    const note = clean(it.note);
    return {
      text,
      key: keys[i],
      time: itemTime(text)?.label ?? null,
      zh: zhFor(text, translations),
      note,
      noteZh: note.split('；').map((part) => zhFor(clean(part), translations)).filter(Boolean),
      detail: clean(it.detail).split(/\r?\n/).map(clean).filter(Boolean).map((line) => ({ text: line, zh: zhFor(line, translations) })),
      placeId: matchPlace(text, visible),
    };
  });
}

/**
 * The name a stop goes by on the strip, the card's previous / next buttons and the menu board's tooltips: the pin's name (Chinese
 * first, placeName) when the item points to one, else the item's Chinese line when its text is Korean, else its text (without a time
 * written at its start or end: the strip shows that on its own).
 */
export const stopName = (view, place, translations) => (place ? placeName(place, translations) : clean(view?.zh) || stripTime(clean(view?.text)));

/**
 * Everything the panel draws for `person` on `dateISO`. `today` is the app's current date (marks the "今天" tag); `night` is
 * currentNightDate(). On the day that is `today` the hotel row is the one for `night` (before 06:00 that is still last night's
 * hotel); any other day looks up its own date. `hotelDate` is the date the hotel row (and the card it opens) is for.
 */
export function todayView(trip, person, dateISO, { places = [], translations = {}, today = '', night = today } = {}) {
  const hotelDate = dateISO === today && isISODate(night) ? night : dateISO;
  const t = buildToday(trip, person, dateISO, { hotelDate });
  const { prev, next } = dayNeighbours(dateISO);
  return {
    date: dateISO,
    hotelDate,
    title: dayTitle(dateISO),
    isToday: dateISO === today,
    status: t.status,
    banner: bannerFor(t, trip.flights, person),
    flight: flightView(t.flight, today),
    hotel: t.hotel ? hotelRow(t.hotel, places, translations) : null,
    items: itemViews(t.items, places, translations),
    prev,
    next,
  };
}

/**
 * The day strip under the panel's meta row: one entry per trip day. `count` is the number of lines of that day that are `person`'s
 * (myItems, the same count as the panel's 「N 站」), 0 when the Sheet has none; `isToday` only for the app's current date (`today`);
 * `label` is what a screen reader hears: 「11/5（四），2 站，今天」.
 */
export function dayStrip(trip, person, { selected = '', today = '' } = {}) {
  return tripDates().map((date) => {
    const count = myItems(buildToday(trip, person, date).items, person).length;
    const isToday = date === today;
    return {
      date,
      md: formatMD(date),
      weekday: weekdayOf(date),
      count,
      isToday,
      isSelected: date === selected,
      label: `${dayTitle(date)}${count > 0 ? `，${count} 站` : ''}${isToday ? '，今天' : ''}`,
    };
  });
}

/**
 * Whether one line of a day counts as done, and whether only its own time says so. Time only means something on today: a stop of
 * any other day is done only when it is ticked on this phone for that day (`ticked` is that day's set of keys; ticks never cross days),
 * and a line that is not mine is never done.
 */
export function stopState(view, { isToday, mine, at, ticked }) {
  return {
    byTime: Boolean(mine && isToday && isPastByTime(view, at)),
    done: Boolean(mine && (isToday ? isStopDone(view, at, ticked, view.key) : ticked.has(view.key))),
  };
}

/** The hotel line of the panel: the Sheet's name, with its Chinese line when it is Korean (else the matched hotel place's Chinese name). */
function hotelRow(stay, places, translations) {
  const zh = zhFor(stay.name, translations) ?? (hasHangul(stay.name) ? clean(findHotelPlace(stay.name, places)?.name_zh) || null : null);
  return { name: stay.name, zh };
}
