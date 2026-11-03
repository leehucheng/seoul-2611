// What the schedule screens need that is not DOM (pure, so Node tests run it): the model is schedule-edit.js, the screens are ui/schedule-editor.js (edit mode,
// the stop form, the place picker) and ui/day-picker.js (「加入行程」 on the place card); the call that saves is ui/schedule.js.
//
//   lineTexts(view, place)            the two lines of a stop (Chinese first, the Korean under it); the 今天 page draws its lines with it too
//   sheetDayOf(tabs, date)            the Sheet's own lines of a day (parseSchedule), or null
//   sheetReadable(tabs)               the Schedule tab was read (at least one day came out of it)
//   startingList(tabs, rows, date)    {ok, owned, base, stops}: the list an edit of that day starts from, and the `base` of its saveDay (see below)
//   ownsDay(rows, date)               the day is kept in the app (any row, a tombstone too)
//   placeStop(place, translations)    {text, place_id}: the stop that stands for a place (its Chinese name as the card shows it)
//   stopPlace(stop, ctx)              the place a stop is linked to: {place, byName} (place_id first, else the pin its text names), {place: null} for an id
//                                     nobody has any more, null for none
//   searchPlaces(own, july, text)     the place picker's results: [{place, july}], names that START with the text first, at most 20, hidden skipped
//   dayPickRows({tabs, rows, today, place})   the 11 rows of the card's day picker
//   sheetChangeSummary(tabs, rows, date)      the 「Sheet 上這天有改動」 line and its list, or null
//   dragLayout / autoScrollDelta / dropIndex  the arithmetic of dragging a row
import { hasHan, hasHangul } from './i18n.js';
import { matchPlace, normalizeName } from './match.js';
import { stripTime } from './next-stop.js';
import { placeName } from './pin-labels.js';
import { isHidden, isJulyPlace } from './place-view.js';
import { copyDay, dayStops, scheduleByDate, sheetChanges, visibleStops } from './schedule-edit.js';
import { parseSchedule } from './sheet-parse.js';
import { dayTitle, loadTripData, tripDates } from './today-view.js';

const clean = (v) => String(v ?? '').trim();

/** At most this many places are offered under one search. */
export const PICK_LIMIT = 20;

/**
 * The two lines of a stop: Chinese first. A Korean line with a Chinese translation puts the translation first; a pin's Korean name goes
 * under the Chinese text. The Korean second line only shows under a first line that has a Han character (never beside a name that is
 * only Latin or Korean). `keepTime`: leave a time written at the start or end of the text in it (the edit list has no column for it).
 */
export function lineTexts(view, place, { keepTime = false } = {}) {
  const text = keepTime ? clean(view.text) : stripTime(clean(view.text)); // a time written at its start or end is the price on the right
  let first = text;
  let second = '';
  if (hasHangul(text) && view.zh) {
    first = clean(view.zh);
    second = text;
  } else {
    const kr = clean(place?.name_kr);
    if (kr && hasHangul(kr) && !text.includes(kr)) second = kr;
  }
  return { first, second: hasHan(first) ? second : '' };
}

// ---- the day's data ---------------------------------------------------------------------------------------------------------

/** The Sheet's own lines of a day ({date, label, items}), or null (no Schedule tab, a layout the parser does not know, no such date). */
export function sheetDayOf(tabs, date) {
  try {
    return parseSchedule(Array.isArray(tabs?.Schedule) ? tabs.Schedule : []).find((d) => d.date === date) ?? null;
  } catch {
    return null;
  }
}

/** The Schedule tab was read: at least one day came out of it (else nothing is known about the Sheet's lines, and a copy of "its" day would be empty). */
export function sheetReadable(tabs) {
  try {
    return parseSchedule(Array.isArray(tabs?.Schedule) ? tabs.Schedule : []).length > 0;
  } catch {
    return false;
  }
}

/** The rows of App_Schedule that belong to a date. */
export const dayRowsOf = (rows, date) => (Array.isArray(rows) ? rows : []).filter((r) => clean(r?.date) === date);

/** The day is kept in the app: App_Schedule has a row for it (a tombstone counts). */
export const ownsDay = (rows, date) => scheduleByDate(rows).has(date);

/**
 * The list an edit of `date` starts from and the `base` of the saveDay that ends it: an app-owned day starts from its own rows (tombstones included,
 * pos order) with base = its version; a day that is not app-owned starts from copyDay's copy of the Sheet's lines with base ''. {ok: false} when the
 * day is not app-owned and the Sheet's Schedule tab was not read (a copy would be empty and saving it would hide the Sheet's lines).
 */
export function startingList(tabs, rows, date) {
  const owned = scheduleByDate(rows).get(date);
  if (owned) return { ok: true, owned: true, base: owned.version, stops: dayStops(dayRowsOf(rows, date)) };
  if (!sheetReadable(tabs)) return { ok: false, owned: false, base: '', stops: [] };
  return { ok: true, owned: false, base: '', stops: copyDay(sheetDayOf(tabs, date)) };
}

/** The stop that stands for a place: its Chinese name as the card shows it (placeName), pointing to it by id. */
export const placeStop = (place, translations) => ({ text: placeName(place, translations), place_id: clean(place?.id) });

/**
 * The place a stop is linked to, for the form: {place, byName: false} for its place_id, {place, byName: true} for the pin its text names (the
 * match the 今天 page makes when there is no place_id), {place: null, missing: true} for a place_id that no place has any more (or a hidden one),
 * null for none. ctx = {placeById(id), places (ours, for the match by name)}.
 */
export function stopPlace(stop, { placeById = () => null, places = [] } = {}) {
  const id = clean(stop?.place_id);
  if (id) {
    const place = placeById(id);
    return place && !isHidden(place) ? { place, byName: false } : { place: null, byName: false, missing: true };
  }
  const visible = (places ?? []).filter((p) => !isHidden(p));
  const hit = matchPlace(clean(stop?.text), visible);
  const place = hit ? visible.find((p) => p.id === hit) : null;
  return place ? { place, byName: true } : null;
}

// ---- the place picker -------------------------------------------------------------------------------------------------------

/** Every normalised name of a place: the Chinese, Korean and English names, the aliases, and the name the pins go by (a Korean-only name in Chinese). */
function namesOf(place, translations) {
  const raw = [place.name_zh, place.name_kr, place.name_en, placeName(place, translations), ...String(place.aliases ?? '').split('|')];
  return raw.map(normalizeName).filter(Boolean);
}

/**
 * The places a typed text finds: a name or alias that contains it (blanks and case ignored). The ones whose name STARTS with it come first, then the
 * ones that have it further in; inside each group ours come before the July ones, each in the order of its list. A hidden place is not offered,
 * nor is a place of `own` that is a July one (that list is ours only) or a place of `july` that is not. At most `limit` of them. -> [{place, july}].
 * Unlike the add form's 7 月 search, one character is enough: a Chinese name is often only two.
 */
export function searchPlaces(own, july, text, { translations = {}, limit = PICK_LIMIT } = {}) {
  const q = normalizeName(text);
  if (q === '') return [];
  const found = [];
  const scan = (list, isJuly) => {
    for (const place of Array.isArray(list) ? list : []) {
      if (!place || isHidden(place) || isJulyPlace(place) !== isJuly) continue;
      const at = namesOf(place, translations).map((n) => n.indexOf(q)).filter((i) => i >= 0);
      if (at.length > 0) found.push({ place, july: isJuly, starts: at.includes(0) });
    }
  };
  scan(own, false);
  scan(july, true);
  return [...found.filter((f) => f.starts), ...found.filter((f) => !f.starts)].slice(0, limit).map(({ place, july: isJuly }) => ({ place, july: isJuly }));
}

// ---- the card's day picker --------------------------------------------------------------------------------------------------

/** The place is one of these items already: the stop points to it, or its text names it (the match the 今天 page makes). */
const isPlaceIn = (item, place) => clean(item?.placeId) === clean(place?.id) || matchPlace(clean(item?.text), [place]) === place?.id;

/**
 * The 11 trip days as rows of the day picker: {date, title: '11/7（六）', label: '11/7（六）· 15 站', count, isToday, already}. `count` is the number of lines the
 * day has now (all of them, the ones that name other people too: the list the editor shows); `already` when the place is one of them.
 */
export function dayPickRows({ tabs, rows, today = '', place }) {
  const trip = loadTripData(tabs, rows);
  return tripDates().map((date) => {
    const items = trip.days.find((d) => d.date === date)?.items ?? [];
    const title = dayTitle(date);
    return { date, title, label: `${title}· ${items.length} 站`, count: items.length, isToday: date === today, already: Boolean(place) && items.some((it) => isPlaceIn(it, place)) };
  });
}

// ---- the Sheet's changes waiting ---------------------------------------------------------------------------------------------

const oneLine = (s) => clean(s).replace(/\s*\n\s*/g, ' / ');
const shown = (s) => (oneLine(s) === '' ? '（空）' : oneLine(s));

/** 「<from> → <to>」 of a changed stop: its note, and its detail (marked 「細節」) when that changed too. */
function changeText(c) {
  const parts = [];
  if (c.note) parts.push(`${shown(c.note.from)} → ${shown(c.note.to)}`);
  if (c.detail) parts.push(`細節 ${shown(c.detail.from)} → ${shown(c.detail.to)}`);
  return parts.join('；');
}

/**
 * The line a day page shows under the banner when the Sheet's lines of an app-owned day differ from what the app copy has seen (schedule-edit.js
 * sheetChanges): {added, removed, changed, text: 'Sheet 上這天有改動（+A −R ～C），請 Claude 匯入', lines: ['＋ <line>', '－ <line>', '～ <line>：<from> → <to>']}.
 * null for a day that is not app-owned or has no changes. The lines are the Sheet's (sheet_text), as the Sheet has or had them. Nothing here writes.
 */
export function sheetChangeSummary(tabs, rows, date) {
  if (!ownsDay(rows, date)) return null;
  const dayRows = dayRowsOf(rows, date);
  const ch = sheetChanges(sheetDayOf(tabs, date), dayRows);
  const a = ch.added.length;
  const r = ch.removed.length;
  const c = ch.changed.length;
  if (a + r + c === 0) return null;
  const lineOf = new Map(dayRows.map((row) => [clean(row.id), clean(row.sheet_text) || clean(row.text)]));
  return {
    added: a, removed: r, changed: c,
    text: `Sheet 上這天有改動（+${a} −${r} ～${c}），請 Claude 匯入`,
    lines: [
      ...ch.added.map((x) => `＋ ${x.text}`),
      ...ch.removed.map((id) => `－ ${lineOf.get(id) ?? ''}`),
      ...ch.changed.map((x) => `～ ${lineOf.get(x.stopId) ?? ''}：${changeText(x)}`),
    ],
  };
}

// ---- the edit list ---------------------------------------------------------------------------------------------------------

/** What makes two lists of stops the same for 「完成」 / 「放棄這些修改？」: every field a person can change, the order, the tombstones. */
export const listKey = (stops) => JSON.stringify((Array.isArray(stops) ? stops : []).map((s) => [s.id, s.text, s.detail, s.note, s.place_id, s.sheet_text, s.deleted]));

/** The index in the full list (tombstones included) a row dropped at the visible position `to` goes to: what moveStop takes. */
export const dropIndex = (stops, from, to) => {
  const shown = visibleStops(stops);
  const target = shown[Math.max(0, Math.min(to, shown.length - 1))];
  return target ? target.index : from;
};

/**
 * Dragging one row. `rects` are the rows' boxes [{top, bottom}] when the drag began (the list's coordinates plus whatever the page has scrolled since
 * is in `dy`), `from` the row that is dragged, `dy` how far it has moved (the finger's and the list's scrolling together). -> {to, shifts, slotTop}:
 * `to` is the position it would drop at (the number of other rows whose middle is above its middle), `shifts` how far each row moves out of the way
 * (the dragged row's own height up or down; 0 for the dragged row itself), `slotTop` where the gap is, the dashed slot it would fill.
 */
export function dragLayout(rects, from, dy) {
  const n = rects.length;
  const box = rects[from];
  const h = box.bottom - box.top;
  const centre = (box.top + box.bottom) / 2 + dy;
  let to = 0;
  rects.forEach((r, j) => { if (j !== from && (r.top + r.bottom) / 2 < centre) to += 1; });
  const shifts = rects.map((_, j) => {
    if (j === from) return 0;
    if (from < to && j > from && j <= to) return -h;
    if (to < from && j >= to && j < from) return h;
    return 0;
  });
  const slotTop = to > from ? rects[to].bottom - h : rects[Math.min(to, n - 1)].top;
  return { to, shifts, slotTop, height: h };
}

/** How many px the list scrolls this frame while a row is dragged at `y`: negative near the top edge, positive near the bottom, 0 elsewhere (faster the nearer the edge). */
export function autoScrollDelta(y, top, bottom, { edge = 64, max = 16 } = {}) {
  if (y < top + edge) return -Math.min(max, Math.ceil((max * (top + edge - y)) / edge));
  if (y > bottom - edge) return Math.min(max, Math.ceil((max * (y - (bottom - edge))) / edge));
  return 0;
}
