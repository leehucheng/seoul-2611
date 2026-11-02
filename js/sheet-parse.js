// Pure parsers for the trip Sheet tabs. Input is string[][] (CSV rows or Sheet display values);
// every parser locates its header row by cell content, never by fixed row number.
import { initialOf } from './people.js';

const YEAR = 2026;
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (m, d) => `${YEAR}-${pad(m)}-${pad(d)}`;
const clean = (s) => String(s ?? '').trim();
const colOf = (header, name) => header.findIndex((c) => clean(c) === name);
const headerRow = (rows, name) => rows.findIndex((r) => r.some((c) => clean(c) === name));

/**
 * One Sheet cell -> items. Lines that all start with the same "X - " prefix are separate
 * items (e.g. a cell listing several 銀杏 spots); otherwise line 1 is the item and the
 * remaining lines are its detail text.
 */
export function splitCellItems(cell) {
  const lines = String(cell ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const prefixes = lines.map((l) => /^(.+?) - /.exec(l)?.[1]);
  if (prefixes[0] && prefixes.every((p) => p === prefixes[0])) {
    return lines.map((text) => ({ text, detail: '' }));
  }
  return [{ text: lines[0], detail: lines.slice(1).join('\n') }];
}

export function parseSchedule(rows) {
  // The tab may hold an old June itinerary above the real one; only the last header row counts.
  const headerIdx = rows.findLastIndex((r) => clean(r[0]) === 'Date');
  if (headerIdx < 0) return [];
  const header = rows[headerIdx];
  const detailsCol = colOf(header, 'Details');
  const timeNoteCol = detailsCol + 1; // unnamed column right after Details, e.g. "日落 17:20"
  const transportCol = colOf(header, 'Transportation / Notes 1');

  const days = [];
  let day = null;
  for (const r of rows.slice(headerIdx + 1)) {
    const m = /^(\d{1,2})\/(\d{1,2})/.exec(clean(r[0]));
    if (m) {
      day = { date: isoDate(+m[1], +m[2]), label: clean(r[0]), items: [] };
      days.push(day);
    }
    if (!day) continue;
    const note = [r[timeNoteCol], r[transportCol]].map(clean).filter(Boolean).join('；');
    // Rows with empty Details (e.g. the wish list under 11/15) add nothing.
    for (const it of splitCellItems(r[detailsCol])) day.items.push({ ...it, note });
  }
  return days;
}

export function parseFlights(rows) {
  const h = headerRow(rows, 'Name');
  if (h < 0) return [];
  const header = rows[h];
  const nameCol = colOf(header, 'Name');
  const [dateCol, fromCol, toCol, flightCol, airlineCol] =
    ['Date', 'Departure', 'Destination', 'Air number', 'Airlines'].map((n) => colOf(header, n));

  const flights = [];
  let dir = 'out';
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = clean(r[nameCol]);
    if (name === '去' || name === '回') { dir = name === '去' ? 'out' : 'back'; continue; }
    if (!name) continue;
    // The row below a flight (name cell empty) carries departure / arrival times.
    const t = rows[i + 1] && !clean(rows[i + 1][nameCol]) ? rows[++i] : [];
    const m = /(\d{1,2})\/(\d{1,2})/.exec(clean(r[dateCol]));
    flights.push({
      people: name.split('/').map(clean).filter(Boolean),
      dir,
      date: m ? isoDate(+m[1], +m[2]) : '',
      from: clean(r[fromCol]),
      to: clean(r[toCol]),
      dep: clean(t[fromCol]),
      arr: clean(t[toCol]),
      flight: clean(r[flightCol]),
      airline: clean(r[airlineCol]),
    });
  }
  return flights;
}

const nightsBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function parseHotels(rows) {
  const h = headerRow(rows, 'Hotel name');
  if (h < 0) return { hotels: [], undated: [] };
  const header = rows[h];
  const dateCol = colOf(header, 'Date');
  const cityCol = colOf(header, '地點');
  const bookerCol = colOf(header, '訂房者');
  const nameCol = colOf(header, 'Hotel name');
  const sharedCol = colOf(header, 'Shared');
  const addressCol = colOf(header, '地址');
  const mapCol = dateCol - 1; // unnamed column left of Date holds the Google Maps link

  const hotels = [];
  const undated = [];
  for (const r of rows.slice(h + 1)) {
    const name = clean(r[nameCol]);
    if (!name) continue;
    const booker = clean(r[bookerCol]);
    const m = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/.exec(clean(r[dateCol]));
    if (!m) { undated.push({ name, booker }); continue; }
    const from = isoDate(+m[1], +m[2]);
    const to = isoDate(+m[3], +m[4]);
    const sharedText = clean(r[sharedCol]);
    const shared = sharedText
      ? sharedText.split('/').map(clean).filter(Boolean)
      : [initialOf(booker)].filter(Boolean); // Shared empty -> only the booker
    hotels.push({
      from, to, city: clean(r[cityCol]), name, booker, shared,
      nights: nightsBetween(from, to),
      address: clean(r[addressCol]),
      mapUrl: clean(r[mapCol]),
    });
  }
  return { hotels, undated };
}

export function parsePurchase(rows) {
  const items = [];
  for (const r of rows) {
    if (clean(r[1]) === 'Brand') continue; // header row (repeats per section)
    const item = clean(r[2]);
    if (!item) continue; // section marker rows such as "New"
    items.push({ brand: clean(r[1]), item, remark: clean(r[3]), forWhom: clean(r[0]) || null });
  }
  return items;
}
