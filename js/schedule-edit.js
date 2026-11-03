// The itinerary the app keeps its own copy of (the Sheet tab App_Schedule, one row per stop of an app-owned day): the pure model. No DOM, no
// fetch. The screens (Task O2) and the read path (today-view.js loadTripData) are built on it.
//
// A date is APP-OWNED when App_Schedule has at least one row for it (a tombstone counts). An app-owned day shows its live stops ordered by `pos`
// and never the Sheet's lines; a day that is not app-owned shows the Sheet's lines. A stop that came from the Sheet carries the line it came from
// (`sheet_text`, its text at copy / import time); a stop added in the app has sheet_text ''. A Sheet line deleted in the app stays as a TOMBSTONE
// (deleted 'TRUE') so that importing the Sheet's changes does not bring it back; a deleted app-added stop is simply dropped.
//
// Shapes
//   row    one App_Schedule row, every SCHEDULE_FIELDS key a trimmed string (what snapshot.schedule and the answer of saveDay hold)
//   stop   one entry of the list saveDay takes: {id, text, detail, note, place_id, sheet_text, sheet_note, sheet_detail, deleted}; id '' = new,
//          deleted 'TRUE' = tombstone. sheet_text / sheet_note / sheet_detail are the Sheet line a stop came from (its text, note, detail at copy
//          / import time: the baseline the Sheet's later changes are compared with); all '' for a stop added in the app.
//          A list of stops holds the tombstones too (they are saved with the day); visibleStops() gives the ones to draw, with their index in the
//          list, which is what moveStop / insertStop / removeStop / editStop take.
//   item   what the day pages read: {text, detail, note} (the parser's shape) plus {stopId, placeId, sheetText} for a stop kept in the app.
import { SCHEDULE_FIELDS } from './fields.js';
import { inTrip, isISODate } from './trip-dates.js';

export const MAX_DAY_STOPS = 80; // saveDay refuses more
export const STOP_ID_RE = /^st-[0-9a-z-]{1,40}$/; // the ids the backend keeps (it makes `st-<ms>-<rand>`)
export const MAX_TEXT_LEN = 500; // the backend cuts every text field of a stop to this (MAX_FIELD_LEN)
export const MAX_BY_LEN = 40; // ... and `by` to this

const clean = (v) => String(v ?? '').trim();
const EDITABLE = ['text', 'detail', 'note', 'place_id']; // what editStop may change

/** text cut to `max` UTF-16 units, never in the middle of a surrogate pair (the backend's cutText_). */
export function cutText(text, max = MAX_TEXT_LEN) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * A line of the Sheet as the backend would store it and the app would read it back: trimmed, cut to the backend's cap, trimmed again (the cut can
 * end in a blank). The Sheet's lines are compared with the baseline columns in this form, so a line over the cap does not show as changed forever.
 */
const asStored = (v) => clean(cutText(clean(v)));

/** deleted is 'TRUE' (any case; the boolean true too). */
export const isTombstone = (r) => r?.deleted === true || clean(r?.deleted).toUpperCase() === 'TRUE';

/** A row (or stop) as a row: every SCHEDULE_FIELDS key a trimmed string; null when it is not an object. */
function norm(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = {};
  for (const k of SCHEDULE_FIELDS) r[k] = clean(raw[k]);
  if (isTombstone(raw)) r.deleted = 'TRUE';
  return r;
}

const posOf = (r) => (clean(r.pos) !== '' && Number.isFinite(Number(r.pos)) ? Number(r.pos) : null);

/** Ordered by pos; rows without one (or with the same one) keep the order they came in. */
function inOrder(rows) {
  return rows
    .map((r, i) => [r, i])
    .sort(([a, i], [b, j]) => {
      const pa = posOf(a);
      const pb = posOf(b);
      return pa !== null && pb !== null && pa !== pb ? pa - pb : i - j;
    })
    .map(([r]) => r);
}

/** A row as a stop of saveDay (tombstones included: deleted 'TRUE'). */
export function stopOf(row) {
  const r = norm(row);
  return {
    id: r.id, text: r.text, detail: r.detail, note: r.note, place_id: r.place_id,
    sheet_text: r.sheet_text, sheet_note: r.sheet_note, sheet_detail: r.sheet_detail, deleted: r.deleted,
  };
}

/** The list for saveDay of an app-owned day: its rows in pos order, tombstones included. */
export const dayStops = (dayRows) => inOrder((Array.isArray(dayRows) ? dayRows : []).map(norm).filter(Boolean)).map(stopOf);

/** The stops of a list that are drawn (not tombstones), each with its index in the list: [{stop, index}]. */
export const visibleStops = (stops) => stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => !isTombstone(stop));

// ---- reading the tab ------------------------------------------------------------------------------------------------

/**
 * rows (snapshot.schedule, tombstones included) -> Map date -> {version, stops, tombstones}, dates ascending. `stops` are the live rows in pos
 * order, `tombstones` the deleted ones; `version` is the newest updated_at of the date's rows (all rows of one save share it), the `base` of the next
 * saveDay. A date is in the map when it has any row at all: that is what app-owned means.
 */
export function scheduleByDate(rows) {
  const groups = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = norm(raw);
    if (!r || !isISODate(r.date)) continue;
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }
  const out = new Map();
  for (const date of [...groups.keys()].sort()) {
    const ordered = inOrder(groups.get(date));
    out.set(date, {
      version: ordered.reduce((v, r) => (r.updated_at > v ? r.updated_at : v), ''),
      stops: ordered.filter((r) => !isTombstone(r)),
      tombstones: ordered.filter(isTombstone),
    });
  }
  return out;
}

/** The version of one day (the `base` for saveDay / resetDay): '' when the day is not app-owned. */
export const dayVersion = (rows, date) => scheduleByDate(rows).get(date)?.version ?? '';

const itemOf = (r) => ({ text: r.text, detail: r.detail, note: r.note, stopId: r.id, placeId: r.place_id, sheetText: r.sheet_text });
const monthDay = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;

/**
 * parseSchedule's days + the App_Schedule rows -> the days the app shows (what loadTripData returns as `days`). An app-owned date's `items` are its
 * live stops as items; a date that only App_Schedule has (inside the trip) is added in date order, labelled 'M/D'. A day that is not app-owned is
 * left as it is (the same object); with no rows at all the same array comes back.
 */
export function mergeDays(sheetDays, rows) {
  const days = Array.isArray(sheetDays) ? sheetDays : [];
  const owned = scheduleByDate(rows);
  if (owned.size === 0) return days;
  const out = days.map((day) => (owned.has(day.date) ? { ...day, items: owned.get(day.date).stops.map(itemOf) } : day));
  for (const [date, d] of owned) {
    if (days.some((day) => day.date === date) || !inTrip(date)) continue;
    const at = out.findIndex((day) => day.date > date);
    out.splice(at < 0 ? out.length : at, 0, { date, label: monthDay(date), items: d.stops.map(itemOf) });
  }
  return out;
}

// ---- copying a day, and importing the Sheet's changes into it -------------------------------------------------------

/**
 * The stops for the first save of a day: one per Sheet line, sheet_text = text = the line's text, detail and note copied, and sheet_note /
 * sheet_detail = the line's note / detail (the baseline). Every text is cut to the backend's cap here too (asStored), so the baseline is what the
 * backend will hold. A Sheet day with no usable lines (or none at all) gives [].
 */
export function copyDay(sheetDay) {
  return (Array.isArray(sheetDay?.items) ? sheetDay.items : [])
    .map((it) => {
      const text = asStored(it?.text);
      const detail = asStored(it?.detail);
      const note = asStored(it?.note);
      return { id: '', text, detail, note, place_id: '', sheet_text: text, sheet_note: note, sheet_detail: detail, deleted: '' };
    })
    .filter((s) => s.text !== '');
}

/** A Sheet day that exists: an object with an `items` array (a real empty day, items [], is one: the Sheet emptied it). */
const hasSheetDay = (d) => d !== null && typeof d === 'object' && Array.isArray(d.items);

/**
 * What the Sheet's current lines differ in from the baseline of a day's rows (see sheetChanges), with what importSheetChanges needs: the ordered rows,
 * the Sheet's lines, `pair` (line index -> the row that is that line's baseline), `added` (with the line's index), `removedRows`, `changed`
 * [{row, note?, detail?}]. With no Sheet day (tab missing, not parsed, the day's header changed) nothing is known about the Sheet: there are no changes
 * at all (it must never read as "the Sheet emptied the day").
 *
 * Pairing. Two identical lines are two lines, and they may differ in note / detail (「回飯店」 at 14:00 and at 22:00). Every Sheet line is paired with
 * a row (live or tombstone) of the same sheet_text, one row per line: first, per text, each line with a row whose baseline note and detail are the line's
 * own (a live row before a tombstone), so the lines the Sheet did not touch find their own rows however the app reordered or deleted its copies; then the
 * lines still unpaired with what is left of that text, in order (a live row before a tombstone: a line the app already deleted, that the Sheet then
 * drops too, costs the live rows nothing). A line with no row is `added`; a live row no line is paired with is `removed`; a live row paired with a
 * line that has another note / detail is `changed`.
 */
function diffDay(sheetDay, dayRows) {
  const rows = inOrder((Array.isArray(dayRows) ? dayRows : []).map(norm).filter(Boolean));
  if (!hasSheetDay(sheetDay)) return { rows, lines: [], pair: new Map(), added: [], removedRows: [], changed: [] };
  const lines = sheetDay.items.map((it) => ({ text: asStored(it?.text), detail: asStored(it?.detail), note: asStored(it?.note) })).filter((l) => l.text !== '');
  const rowsOfText = new Map(); // sheet_text -> the rows holding it (live and tombstones: the Sheet lines the app copy has seen), in order
  for (const r of rows) if (r.sheet_text !== '') rowsOfText.set(r.sheet_text, [...(rowsOfText.get(r.sheet_text) ?? []), r]);
  const linesOfText = new Map(); // text -> the indexes of the Sheet lines that have it, in order
  lines.forEach((l, i) => linesOfText.set(l.text, [...(linesOfText.get(l.text) ?? []), i]));
  const pair = new Map();
  const used = new Set();
  for (const [text, idxs] of linesOfText) {
    const take = (ok) => {
      const free = (rowsOfText.get(text) ?? []).filter((r) => !used.has(r) && ok(r));
      return free.find((r) => !isTombstone(r)) ?? free[0];
    };
    const bind = (i, row) => { if (row) { used.add(row); pair.set(i, row); } };
    for (const i of idxs) bind(i, take((r) => r.sheet_note === lines[i].note && r.sheet_detail === lines[i].detail));
    for (const i of idxs) if (!pair.has(i)) bind(i, take(() => true));
  }
  const added = [];
  const changed = [];
  lines.forEach((l, index) => {
    const row = pair.get(index);
    if (!row) {
      added.push({ text: l.text, detail: l.detail, note: l.note, after: index > 0 ? lines[index - 1].text : null, index });
      return;
    }
    if (isTombstone(row)) return;
    const change = {};
    if (row.sheet_note !== l.note) change.note = { from: row.sheet_note, to: l.note };
    if (row.sheet_detail !== l.detail) change.detail = { from: row.sheet_detail, to: l.detail };
    if (change.note || change.detail) changed.push({ row, ...change });
  });
  const removedRows = rows.filter((r) => r.sheet_text !== '' && !isTombstone(r) && !used.has(r));
  return { rows, lines, pair, added, removedRows, changed };
}

/**
 * The Sheet's current lines of a day (`sheetDay`, from parseSchedule) against the app copy's rows (`dayRows`, tombstones included), comparing the
 * Sheet's lines with the baseline (every row's sheet_text / sheet_note / sheet_detail), pairing each line with one row (see diffDay: identical lines are
 * separate lines, matched by their baseline note / detail first, so reordering or deleting copies in the app never looks like a Sheet change):
 *   added    {text, detail, note, after}: a Sheet line no row (live or tombstone) accounts for; `after` is the text of the Sheet line just before it
 *            (null when it is the first)
 *   removed  [stopId]: live Sheet-origin rows no Sheet line is paired with
 *   changed  [{stopId, note?: {from, to}, detail?: {from, to}}]: a live Sheet-origin stop whose Sheet line (paired as above) has another note
 *            and / or detail than the baseline; from = the baseline, to = what the Sheet has now. The app's own edit of note / detail is not looked at.
 * A stop added in the app (sheet_text '') is never removed or changed; a tombstone is never revived. With no Sheet day (undefined, not an object
 * with an `items` array) there are no changes.
 */
export function sheetChanges(sheetDay, dayRows) {
  const d = diffDay(sheetDay, dayRows);
  return {
    added: d.added.map(({ index, ...a }) => a),
    removed: d.removedRows.map((r) => r.id),
    changed: d.changed.map(({ row, ...c }) => ({ stopId: row.id, ...c })),
  };
}

/**
 * The list for saveDay after importing the Sheet's changes into an app-owned day:
 *  - the removed rows are dropped (no tombstone: the Sheet no longer has them);
 *  - a stop whose Sheet line has a new note / detail gets it (the Sheet wins, even over the app's own edit) and its baseline moves to it;
 *  - every added line goes in right after the live stop of the Sheet line before it; when that stop is gone or deleted, after the nearest earlier
 *    Sheet line that has a live stop; with none (the Sheet's first line, or every earlier line is gone), at the START of the list. It is a new stop with
 *    sheet_text = text and the baseline note / detail. Unless a live stop that was added in the app has exactly that text: that stop becomes the
 *    line's stop (its sheet_text, sheet_note, sheet_detail are set; its own note, detail and place stay) and nothing is inserted;
 *  - everything else keeps its place, tombstones included.
 * With no Sheet day (see sheetChanges) the list is the day's stops unchanged. Afterwards sheetChanges(sheetDay, the saved rows) is empty.
 */
export function importSheetChanges(sheetDay, dayRows) {
  const d = diffDay(sheetDay, dayRows);
  const gone = new Set(d.removedRows);
  const change = new Map(d.changed.map((c) => [c.row, c]));
  const stopOfRow = new Map();
  const list = d.rows.filter((r) => !gone.has(r)).map((r) => {
    const stop = stopOf(r);
    const c = change.get(r);
    if (c?.note) Object.assign(stop, { note: c.note.to, sheet_note: c.note.to });
    if (c?.detail) Object.assign(stop, { detail: c.detail.to, sheet_detail: c.detail.to });
    stopOfRow.set(r, stop);
    return stop;
  });
  // The live stop that stands for each Sheet line: the one of the row the line is paired with (the same pairing as sheetChanges; a line whose row is a
  // tombstone has none), and, as the added lines go in, the stop each of them became.
  const stopOfLine = new Map();
  for (const [j, row] of d.pair) {
    const stop = stopOfRow.get(row);
    if (stop && !isTombstone(stop)) stopOfLine.set(j, stop);
  }
  const anchor = (j) => (stopOfLine.has(j) ? list.indexOf(stopOfLine.get(j)) : -1); // the index in `list` of Sheet line j's live stop, or -1
  for (const a of d.added) {
    const mine = list.find((s) => s.sheet_text === '' && !isTombstone(s) && s.text === a.text);
    if (mine) {
      Object.assign(mine, { sheet_text: a.text, sheet_note: a.note, sheet_detail: a.detail });
      stopOfLine.set(a.index, mine);
      continue;
    }
    let at = -1;
    for (let j = a.index - 1; j >= 0 && at < 0; j--) at = anchor(j);
    const stop = { id: '', text: a.text, detail: a.detail, note: a.note, place_id: '', sheet_text: a.text, sheet_note: a.note, sheet_detail: a.detail, deleted: '' };
    list.splice(at < 0 ? 0 : at + 1, 0, stop);
    stopOfLine.set(a.index, stop);
  }
  return list;
}

// ---- editing a list of stops (each returns a new array) -------------------------------------------------------------

const clampIndex = (i, max) => Math.max(0, Math.min(i, max));

/** The stop at `from` moved so that it ends up at index `to`. */
export function moveStop(stops, from, to) {
  const list = [...stops];
  if (!Number.isInteger(from) || from < 0 || from >= list.length || !Number.isInteger(to)) return list;
  const [stop] = list.splice(from, 1);
  list.splice(clampIndex(to, list.length), 0, stop);
  return list;
}

/** `stop` ({text, detail?, note?, place_id?}; text is trimmed) inserted at `index` (the end when it is past it or not a number), as a new stop. */
export function insertStop(stops, index, stop) {
  const list = [...stops];
  const s = {
    id: clean(stop?.id), text: clean(stop?.text), detail: clean(stop?.detail), note: clean(stop?.note), place_id: clean(stop?.place_id),
    sheet_text: clean(stop?.sheet_text), sheet_note: clean(stop?.sheet_note), sheet_detail: clean(stop?.sheet_detail), deleted: '',
  };
  list.splice(Number.isInteger(index) ? clampIndex(index, list.length) : list.length, 0, s);
  return list;
}

/** The stop at `index` removed: a stop that came from the Sheet stays as a tombstone (deleted 'TRUE', in the same place), an app-added one is dropped. */
export function removeStop(stops, index) {
  const list = [...stops];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  const stop = list[index];
  if (clean(stop.sheet_text) === '') list.splice(index, 1);
  else list[index] = { ...stop, deleted: 'TRUE' };
  return list;
}

/** The stop at `index` with its text, detail, note and place_id taken from `patch` (the keys it has); nothing else of a stop can be edited this way. */
export function editStop(stops, index, patch) {
  const list = [...stops];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  const next = { ...list[index] };
  for (const k of EDITABLE) if (patch && k in patch) next[k] = String(patch[k] ?? '');
  list[index] = next;
  return list;
}

// ---- what the phone shows -------------------------------------------------------------------------------------------

/**
 * createScheduleStore() -> {setServer(rows, serverTime), applyDay(answer), applyReset(date), forget(date), rows(), version(date)}: the rows the phone
 * works with, the newest snapshot's (snapshot.schedule) with what this phone saved laid over them, a day at a time, until the server's truth is in.
 *   setServer(rows, serverTime)
 *                     the rows of the newest snapshot and the time it was made (snapshot.serverTime, an ISO time). A day saved from this phone stays
 *                     laid over until a snapshot made at or after that save arrives, whatever that snapshot says for the day (somebody else may have
 *                     reset or saved it since: the server's truth wins), or until a snapshot has the day at the saved version or later; a day reset
 *                     from this phone stays reset until a snapshot has no row for it or a version newer than the one that was reset. Without a
 *                     serverTime only the version rule applies. With the mock backend (its snapshot's serverTime is old, no snapshot ever has the
 *                     day) a save stays for the page's life.
 *   applyDay(answer)  what saveDay answered, {date, version, rows}; an answer with no row (the day went back to the Sheet) is a reset
 *   applyReset(date)  the day went back to the Sheet (resetDay answered)
 *   forget(date)      drop what this phone laid over that day (after 'stale': the day shows the snapshot's rows again, until a refetch brings newer
 *                     ones); true when there was something to drop
 *   rows()            every row, tombstones included: what loadTripData's second argument and scheduleByDate take
 *   version(date)     the day's version now ('' when it is not app-owned): the `base` of the next save
 */
export function createScheduleStore() {
  let server = [];
  const applied = new Map(); // date -> {reset: false, version, rows} | {reset: true, from}
  const rows = () => {
    const out = server.filter((r) => !applied.has(r.date));
    for (const a of applied.values()) if (!a.reset) out.push(...a.rows);
    return out;
  };
  const version = (date) => dayVersion(rows(), date);
  return {
    setServer(list, serverTime) {
      server = (Array.isArray(list) ? list : []).map(norm).filter(Boolean);
      const days = scheduleByDate(server);
      const at = clean(serverTime);
      for (const [date, a] of [...applied]) {
        const sv = days.get(date)?.version ?? '';
        if (a.reset ? sv === '' || sv > a.from : sv >= a.version || (at !== '' && at >= a.version)) applied.delete(date);
      }
    },
    forget(date) {
      return applied.delete(date);
    },
    applyDay(answer) {
      const date = clean(answer?.date);
      if (!isISODate(date)) return;
      const list = (Array.isArray(answer.rows) ? answer.rows : []).map(norm).filter(Boolean);
      if (list.length === 0 || clean(answer.version) === '') applied.set(date, { reset: true, from: version(date) });
      else applied.set(date, { reset: false, version: clean(answer.version), rows: list });
    },
    applyReset(date) {
      if (isISODate(date)) applied.set(date, { reset: true, from: version(date) });
    },
    rows,
    version,
  };
}
