// 下一站 (pure, no DOM): the first of today's stops that is not done yet.
//
// A stop is done when this phone ticked it (done.js) or when its own text carries an explicit time (H:MM / HH:MM) at least GRACE_MIN
// minutes before now (a flight line "<AIRPORT> HH:MM - <AIRPORT> HH:MM" is read on the departure airport's clock, see stopMinutes()).
// Nothing else is ever read as a time: real itinerary lines mostly have none, and a stop without one is only done by a tick. So it works
// with zero, some or all stops timed. The next stop never points backwards: it is the first not-done stop after the last stop that is
// past by its time.
import { doneKey, doneKeys } from './done.js';
import { PEOPLE } from './people.js';

export const GRACE_MIN = 30;

// No regex lookbehind anywhere in app/js (tests/compat.test.mjs): Safari before 16.4 cannot parse one, and a SyntaxError fails the whole
// module graph. "Not preceded by a digit or colon" is a leading group `(^|[^\d:])` instead, and the length of what it matched is added
// to the index.
const CLOCK = /(^|[^\d:])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const CLOCK_RANGE_AFTER = /^\s*[-–—~～]\s*(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/; // "…9:00" of "9:00–17:30"
const CLOCK_RANGE_BEFORE = /(^|[^\d:])(?:[01]?\d|2[0-3]):[0-5]\d\s*[-–—~～]\s*$/; // "17:30" of "9:00–17:30"
const seoulClock = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * The first clock time in a text that is a time of the stop -> {index, length, hh, mm} (where the "H:MM" itself starts and how long it
 * is), or null. A time that is one end of a range ("9:00–17:30", "9:00 ~ 17:30": opening hours) is skipped.
 */
function findTime(text) {
  const s = String(text ?? '');
  for (const m of s.matchAll(CLOCK)) {
    const index = m.index + m[1].length;
    const length = m[0].length - m[1].length;
    if (CLOCK_RANGE_AFTER.test(s.slice(index + length)) || CLOCK_RANGE_BEFORE.test(s.slice(0, index))) continue;
    return { index, length, hh: m[2], mm: m[3] };
  }
  return null;
}

/** The first explicit clock time in a text (not one end of a range) -> {label: 'HH:MM', minutes}, or null. As written: see stopMinutes() for the Seoul clock. */
export function itemTime(text) {
  const t = findTime(text);
  if (!t) return null;
  return { label: `${t.hh.padStart(2, '0')}:${t.mm}`, minutes: Number(t.hh) * 60 + Number(t.mm) };
}

/** Minutes east of UTC of the airports a flight line names. */
export const AIRPORT_UTC_MIN = Object.freeze({ TPE: 8 * 60, TSA: 8 * 60, ICN: 9 * 60, GMP: 9 * 60 });
const SEOUL_UTC_MIN = 9 * 60;
const AIRPORT = '(TPE|TSA|ICN|GMP)';
const FLIGHT_BEFORE = new RegExp(`(^|[^A-Za-z])${AIRPORT}\\s*$`, 'i'); // "TPE " right before the first time
const FLIGHT_AFTER = new RegExp(`^\\s*[-–—]\\s*${AIRPORT}\\s*(?:[01]?\\d|2[0-3]):[0-5]\\d(?!\\d)`, 'i'); // " - ICN 12:30" right after it

/**
 * The first time of a stop on the Seoul wall clock, in minutes since midnight (what nowMin is compared with), or null. Every time is
 * Seoul time except the one of a flight line shaped "<AIRPORT> HH:MM - <AIRPORT> HH:MM" ("Name - TPE 09:00 - ICN 12:30"):
 * that is the departure airport's clock, so TPE / TSA (UTC+8) 09:00 is 10:00 in Seoul, ICN / GMP (UTC+9) is already Seoul time.
 */
export function stopMinutes(text) {
  const s = String(text ?? '');
  const t = findTime(s);
  if (!t) return null;
  const minutes = Number(t.hh) * 60 + Number(t.mm);
  const dep = FLIGHT_BEFORE.exec(s.slice(0, t.index));
  if (!dep || !FLIGHT_AFTER.test(s.slice(t.index + t.length))) return minutes;
  return minutes + SEOUL_UTC_MIN - AIRPORT_UTC_MIN[dep[2].toUpperCase()];
}

/**
 * The text of a stop without its time, when the time is written at the very start or end ("19:30 晚餐", "晚餐 - 19:30"): the price
 * column / the strip already say it, so the name must not say it twice. A time in the middle ("TPE 09:00 - ICN 12:30"), a text with
 * no time, or a text that is only a time comes back unchanged (trimmed).
 */
export function stripTime(text) {
  const s = String(text ?? '').trim();
  const t = findTime(s);
  if (!t) return s;
  const before = s.slice(0, t.index);
  const after = s.slice(t.index + t.length);
  const lead = /^[\s\-–—:：@,，、]+/;
  const tail = /[\s\-–—:：@,，、]+$/;
  if (before.trim() === '') return after.replace(lead, '').trim() || s;
  if (after.trim() === '') return before.replace(tail, '').trim() || s;
  return s;
}

/** 「N 分後」 for the strip and the menu board: minutes -> 已過 N 分 (inside the grace period) / 現在 / N 分後 / N 小時後 (rounded). '' when not a number. */
export function untilText(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 0) return `已過 ${Math.round(-minutes)} 分`;
  if (minutes === 0) return '現在';
  if (minutes < 60) return `${Math.round(minutes)} 分後`;
  return `${Math.round(minutes / 60)} 小時後`;
}

/** A span of minutes in one short unit: 25 -> 25 分, 60 -> 1 小時, 410 -> 7 小時 (rounded). */
export const shortDuration = (minutes) => (minutes < 60 ? `${Math.max(0, Math.round(minutes))} 分` : `${Math.round(minutes / 60)} 小時`);

/** Minutes since midnight on the Seoul wall clock for an instant; null for an invalid Date. */
export function seoulMinutes(at) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
  const p = Object.fromEntries(seoulClock.formatToParts(at).map(({ type, value }) => [type, value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

const NAME_WORDS = PEOPLE.map((p) => [p.name, new RegExp(`(^|[^A-Za-z0-9])${p.name}(?![A-Za-z0-9])`)]);

/**
 * Whether a schedule line is mine. A line that names people ("Name - TSA 09:00 - GMP 12:30", "… - Name", "Name1/Name2 - TPE …";
 * a name counts as a whole word, written as in people.js) is for those people only: not mine when none of them is me. A line that names
 * nobody is everyone's. Without a `me` every line stays.
 */
export function isMyItem(item, me) {
  const text = String(item?.text ?? '');
  const named = NAME_WORDS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return named.length === 0 || !me || named.includes(me);
}

/** The lines of a day that are mine (isMyItem), in order. The one place that decides it: the 下一站 strip, the card's strip and the 今日菜單 all use it. */
export const myItems = (items, me) => (Array.isArray(items) ? items : []).filter((item) => isMyItem(item, me));

/** Whether a stop's own time (not a range; a flight's on its departure airport's clock) is at least GRACE_MIN minutes before `now`. A tick plays no part. */
export function isPastByTime(item, now) {
  const at = stopMinutes(item?.text);
  const nowMin = seoulMinutes(now);
  return at !== null && nowMin !== null && at <= nowMin - GRACE_MIN;
}

/**
 * Whether a stop counts as done: ticked on this phone, or past by its own time. `key` is the item's done.js key (default: doneKey(item));
 * pass it when the item is one of several identical lines.
 */
export function isStopDone(item, now, done = new Set(), key = doneKey(item)) {
  const ticked = done instanceof Set ? done : new Set(done ?? []);
  return ticked.has(key) || isPastByTime(item, now);
}

/**
 * @param {{text: string}[]} items  today's stops in order (items from itemViews carry their `key`; others get done.js doneKeys)
 * @param {Date} now
 * @param {Set<string>|string[]} [done]  keys ticked on this phone
 * @returns {{index: number, item: object, time?: string, inMinutes?: number}|null}
 *   `time` ('HH:MM', as written) and `inMinutes` (real minutes to go, on the Seoul clock; negative while still inside the grace period)
 *   only when the stop's text has a time; null when nothing is left.
 *
 * The next stop never points backwards: when a later stop is already past by its own time, every earlier stop that was not ticked
 * counts as skipped, so the next one is the first not-done stop AFTER the last stop that is past by time.
 */
export function nextStop(items, now, done = new Set()) {
  const nowMin = seoulMinutes(now);
  const list = Array.isArray(items) ? items : [];
  const keys = doneKeys(list);
  let from = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (isPastByTime(list[index], now)) { from = index + 1; break; }
  }
  for (let index = from; index < list.length; index += 1) {
    const item = list[index];
    if (isStopDone(item, now, done, item?.key ?? keys[index])) continue;
    const t = itemTime(item?.text);
    if (!t) return { index, item };
    const at = stopMinutes(item.text);
    return nowMin === null ? { index, item, time: t.label } : { index, item, time: t.label, inMinutes: at - nowMin };
  }
  return null;
}
