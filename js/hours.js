// Opening-hours check. Pure: no I/O, no DOM, correct for any Date regardless of the machine's timezone.
//
// hours_json: {"mon":[["10:00","22:00"]], "tue":[], ...}
//   - a missing weekday key = unknown      - [] = closed all day
//   - end <= start = runs past midnight (belongs to the day it starts, e.g. fri 22:00-05:00 covers sat 01:00)
//   - "24:00" is allowed as an end time

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const seoulClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Weekday key and minutes-since-midnight in Seoul for an instant; null if `at` is not a valid Date. */
function seoulNow(at) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
  const p = Object.fromEntries(seoulClock.formatToParts(at).map(({ type, value }) => [type, value]));
  return { day: DAYS.indexOf(p.weekday.toLowerCase()), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** 'HH:MM' -> minutes since midnight, or null when malformed. */
function parseTime(s) {
  const m = typeof s === 'string' ? /^(\d{1,2}):([0-5]\d)$/.exec(s) : null;
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 24 * 60 ? minutes : null;
}

/** One weekday's windows as [startMin, endMin] pairs; null when absent or malformed (= unknown). */
function windowsOf(hoursJson, dayIndex) {
  const raw = hoursJson[DAYS[dayIndex]];
  if (!Array.isArray(raw)) return null;
  const parsed = raw.map((w) => (Array.isArray(w) ? [parseTime(w[0]), parseTime(w[1])] : [null, null]));
  return parsed.some(([s, e]) => s === null || e === null) ? null : parsed;
}

/**
 * @param {object|null} hoursJson  already-parsed hours_json (a non-object counts as unknown)
 * @param {Date} at                any instant; the weekday and clock time are read in Asia/Seoul
 * @returns {true|false|null}      null = unknown
 */
export function isOpenAt(hoursJson, at) {
  if (hoursJson === null || typeof hoursJson !== 'object') return null;
  const now = seoulNow(at);
  if (!now) return null;

  // Yesterday's past-midnight window may still be running; that is a definite "open" even if today is unknown.
  const yesterday = windowsOf(hoursJson, (now.day + 6) % 7);
  if (yesterday?.some(([start, end]) => end <= start && now.minutes < end)) return true;

  const today = windowsOf(hoursJson, now.day);
  if (today === null) return null;
  return today.some(([start, end]) => (end > start ? now.minutes >= start && now.minutes < end : now.minutes >= start));
}

const pad2 = (n) => String(n).padStart(2, '0');
const clock = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`; // 1440 -> '24:00'

/**
 * Today's windows and the minutes to the next change, for the place card ("再 6 小時 50 分打烊") and the menu board's price column.
 * @returns {{open: boolean|null, windows: string[][]|null, closesInMin: number|null, opensInMin: number|null}}
 *   windows       today's [from, to] pairs as 'HH:MM' ([] = closed all day, null = unknown)
 *   closesInMin   minutes until the window that is running now ends (also a past-midnight one that began yesterday)
 *   opensInMin    minutes until the next window today starts, when closed now and one is left
 */
export function hoursToday(hoursJson, at) {
  const unknown = { open: null, windows: null, closesInMin: null, opensInMin: null };
  if (hoursJson === null || typeof hoursJson !== 'object') return unknown;
  const now = seoulNow(at);
  if (!now) return unknown;
  const today = windowsOf(hoursJson, now.day);
  const yesterday = windowsOf(hoursJson, (now.day + 6) % 7);
  const open = isOpenAt(hoursJson, at);
  if (open === null) return unknown;

  let closesInMin = null;
  let opensInMin = null;
  if (open) {
    const carry = yesterday?.find(([start, end]) => end <= start && now.minutes < end);
    if (carry) {
      closesInMin = carry[1] - now.minutes;
    } else {
      const [start, end] = today.find(([s, e]) => (e > s ? now.minutes >= s && now.minutes < e : now.minutes >= s));
      closesInMin = (end > start ? end : end + 24 * 60) - now.minutes;
    }
  } else {
    const later = today.filter(([start]) => start > now.minutes).map(([start]) => start).sort((a, b) => a - b)[0];
    if (later !== undefined) opensInMin = later - now.minutes;
  }
  return { open, windows: today ? today.map(([start, end]) => [clock(start), clock(end)]) : null, closesInMin, opensInMin };
}

/** Label for the place card. */
export function formatHoursBadge(hoursJson, at) {
  const open = isOpenAt(hoursJson, at);
  if (open === null) return '營業時間待確認';
  return open ? '營業中' : '已打烊';
}
