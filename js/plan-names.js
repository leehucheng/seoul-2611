// "還沒上地圖": names the group wrote in the Sheet (Store, 銀杏, Schedule) that have no pin on the map yet.
// Pure: input is snapshot.tabs (string[][] per tab), the places, and config.ignore_names.
import { hasHangul } from './i18n.js';
import { normalizeName, unmappedNames } from './match.js';
import { PEOPLE } from './people.js';
import { hasCoords, isHidden } from './place-view.js';
import { parseSchedule } from './sheet-parse.js';

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isNa = (s) => /^n\/a$/i.test(s);
const colOf = (header, name) => header.findIndex((c) => flat(c) === name);
const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const PERSON_SUFFIX = new RegExp(` - (${PEOPLE.map((p) => p.name).join('|')})$`);
const KIND_PREFIX = /^[^\s-][^-]{0,11} - (?=\S)/; // "銀杏 - 昌德宮": the kind of stop, then the place

/**
 * One entry per sheet row / plan item:
 *   tab      'Store' | '銀杏' | 'Exhibition' | 'Schedule'
 *   label    the name as written in the Sheet (what the list shows)
 *   shop     the same without a leading "銀杏 - " and trailing " - Lee" (suggested 店名)
 *   kr       the Korean name column, '' when none
 *   query    what to search for: the Korean name when there is one, else `shop`
 *   aliases  every wording a place can match this entry by
 *   area     the Area column ('' for Schedule), day  'M/D' for Schedule items ('' otherwise)
 */
function entry({ tab, label, kr = '', area = '', day = '' }) {
  const stripped = label.replace(PERSON_SUFFIX, '');
  const shop = tab === 'Schedule' ? stripped.replace(KIND_PREFIX, '') || stripped : stripped; // only itinerary lines carry a "kind - " prefix
  const korean = hasHangul(kr) ? kr : '';
  const aliases = [...new Set([label, stripped, flat(kr)].filter((s) => s && !isNa(s)))];
  return { tab, label: stripped, shop, kr: korean, query: korean || shop, aliases, area, day };
}

/** The Store tab has several sections, each with its own header row ("Area", ...) and its own columns. */
function storeEntries(rows) {
  const out = [];
  let cols = null;
  for (const r of rows ?? []) {
    if (flat(r[1]) === 'Area') {
      cols = { name: colOf(r, 'Name'), kr: colOf(r, 'Korean name'), area: colOf(r, 'Area') };
      continue;
    }
    if (!cols || cols.name < 0) continue;
    const name = flat(r[cols.name]);
    if (!name || isNa(name)) continue; // section title rows ("Food") and blank rows
    out.push(entry({ tab: 'Store', label: name, kr: cols.kr >= 0 ? flat(r[cols.kr]) : '', area: flat(r[cols.area]) }));
  }
  return out;
}

function ginkgoEntries(rows) {
  const h = (rows ?? []).findIndex((r) => flat(r[1]) === 'Area');
  if (h < 0) return [];
  const [areaCol, nameCol, krCol] = ['Area', 'Name', 'Korean name'].map((n) => colOf(rows[h], n));
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const name = flat(r[nameCol]);
    const kr = flat(r[krCol]);
    const label = !name || isNa(name) ? kr : name; // "N/A" rows only have the Korean name
    if (!label) continue;
    out.push(entry({ tab: '銀杏', label, kr: kr === label ? '' : kr, area: flat(r[areaCol]) }));
  }
  return out;
}

/**
 * The Exhibition tab: only its "Exhibition" and "Must-go" lists (names in the third column); the 光州雙年展
 * write-up below them is prose, not a list of places.
 */
function exhibitionEntries(rows) {
  const out = [];
  let inList = false;
  for (const r of rows ?? []) {
    const name = flat(r[2]);
    if (!name) continue;
    if (name === 'Exhibition' || name === 'Must-go') { inList = true; continue; }
    if (/光州雙年展/.test(name)) break;
    if (inList) out.push(entry({ tab: 'Exhibition', label: name }));
  }
  return out;
}

/** The itinerary is only a list of places for the days the group is together in Seoul. */
export const SCHEDULE_FROM = '2026-11-05';
export const SCHEDULE_TO = '2026-11-09';

// Flights, trains and "go back to the hotel" lines are part of the plan but not places a pin could mark.
const TRANSPORT_WORDS = ['KTX', '機場', '航班', '抵達', '出發', '回飯店'];
const FLIGHT_NUMBER = /\b[A-Z]{2}\d{3,4}\b/;
const AIRPORT_LEG = /\b[A-Z]{3}\s+\d{1,2}:\d{2}\s*-\s*[A-Z]{3}\s+\d{1,2}:\d{2}\b/; // "TPE 17:05 - ICN 20:30": a flight written as airports and times

/** An itinerary line about getting somewhere (flight, train, airport, hotel return), not a place. */
export function isTransportLine(text) {
  const t = String(text ?? '');
  return TRANSPORT_WORDS.some((w) => t.includes(w)) || FLIGHT_NUMBER.test(t) || AIRPORT_LEG.test(t);
}

function scheduleEntries(rows) {
  const out = [];
  for (const day of parseSchedule(rows ?? [])) {
    if (day.date < SCHEDULE_FROM || day.date > SCHEDULE_TO) continue;
    for (const it of day.items) {
      const label = flat(it.text);
      if (label && !isTransportLine(label)) out.push(entry({ tab: 'Schedule', label, day: md(day.date) }));
    }
  }
  return out;
}

/**
 * Every named thing the Sheet's plan tabs list, in tab order (Store, 銀杏, Exhibition, Schedule 11/5-11/9 without
 * transport lines), first spelling wins.
 */
export function collectPlanEntries(tabs) {
  const all = [
    ...storeEntries(tabs?.Store),
    ...ginkgoEntries(tabs?.['銀杏']),
    ...exhibitionEntries(tabs?.Exhibition),
    ...scheduleEntries(tabs?.Schedule),
  ];
  const seen = new Set();
  return all.filter((e) => {
    const key = normalizeName(e.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Entries that no pin on the map answers to. "Has a pin" means visible and with coordinates: a row that exists in
 * App_Places but was never located (or was hidden) still counts as not on the map. An entry is on the map when
 * any of its wordings matches a pin; it is skipped when any wording is in `ignore` (config.ignore_names).
 */
export function unmappedEntries(tabs, places, ignore = []) {
  const pins = (places ?? []).filter((p) => !isHidden(p) && hasCoords(p));
  const skip = new Set((ignore ?? []).map(normalizeName));
  return collectPlanEntries(tabs).filter((e) => {
    if (e.aliases.some((a) => skip.has(normalizeName(a)))) return false;
    return unmappedNames(e.aliases, pins, ignore).length === e.aliases.length;
  });
}
