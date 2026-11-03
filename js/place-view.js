// Pure view-model helpers for the place card and the map (no DOM, no globals) so they run in Node tests.
// Every Place value arrives from the Sheet as a string; nothing here trusts a value to be well formed.
import { CATEGORIES } from './categories.js';
import { FAMILIES } from './colors.js';
import { formatHoursBadge, hoursToday } from './hours.js';
import { hasHan, hasHangul, zhOf } from './i18n.js';
import { naverShopLinks, placeSearchQuery } from './links.js';
import { itemsForPlace } from './match.js';
import { nameOf } from './people.js';

const NAVER_APPNAME = 'seoul-2611';
const clean = (v) => String(v ?? '').trim();

const OTHER = Object.freeze({ id: 'other', label: '其他', short: '其他', icon: 'i-pin', family: 'other', color: FAMILIES.other.color, on: FAMILIES.other.on });

/** Category record for a place's `category` id; an unknown id (e.g. typed by hand in the Sheet) gets a neutral pin. */
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === clean(id)) ?? OTHER;

/**
 * The category chip filter. It must compare the same normalised id the chips are built from, otherwise a place
 * with an empty or unknown category gets a "其他" chip that filters to nothing.
 */
export const matchesCategory = (place, filter) => filter === 'all' || categoryOf(place?.category).id === filter;

/** The filter id of the 銀杏 capsule (not a category: the places the Sheet's 銀杏 tab lists, see ginkgo.js). */
export const GINKGO_FILTER = 'ginkgo';

/** matchesCategory plus the 銀杏 filter. `ginkgoIds` is the Set from ginkgoPlaceIds(). */
export const matchesFilter = (place, filter, ginkgoIds) => (filter === GINKGO_FILTER ? Boolean(ginkgoIds?.has(place?.id)) : matchesCategory(place, filter));

/** The `source` of a place from the July trip (the 「7 月」 layer, july-layer.js): just a value of the column, no column of its own. */
export const JULY_SOURCE = 'july';
export const isJulyPlace = (place) => clean(place?.source) === JULY_SOURCE;

/**
 * The category capsules of the chip row for the places the map may show (the 7 月 ones only while their layer is on): every category with a
 * pin that is not hidden and has coordinates, in the CATEGORIES order, 「其他」 last; the pressed filter's capsule stays even when it has none.
 */
export function chipCategories(places, filter) {
  const inUse = new Set((places ?? []).filter((p) => !isHidden(p) && hasCoords(p)).map((p) => categoryOf(p.category).id));
  const shown = CATEGORIES.filter((c) => inUse.has(c.id) || c.id === filter);
  if (inUse.has('other') || filter === 'other') shown.push(categoryOf('other'));
  return shown;
}

/**
 * Names for the top of the card. The Chinese name is the title and the Korean name sits under it, smaller;
 * with no Chinese name the Korean name is the title and gets its Chinese line (`zh`) under it. Any Korean string
 * on a line carries `zh` too when the snapshot has a translation; null means "nothing extra". Under a Latin-only title (MONBREW) the
 * Korean name has no Chinese line above it that could stand for it, so it gets its own translation; with none it stays as it is (it is
 * what finds the shop).
 * -> {title: {text, zh}, sub: [{text, zh}]}
 */
export function nameBlock(place, translations) {
  const zhName = clean(place?.name_zh);
  const kr = clean(place?.name_kr);
  const en = clean(place?.name_en);
  const text = zhName || kr || en || '（未命名）';
  const zhFor = (s) => (hasHangul(s) ? zhOf(s, translations) : null);
  const sub = [];
  if (zhName && kr && kr !== zhName) sub.push({ text: kr, zh: hasHan(zhName) ? null : zhFor(kr) }); // a Chinese title is this Korean name's Chinese line
  if (en && en !== text && en !== kr) sub.push({ text: en, zh: zhFor(en) });
  return { title: { text, zh: zhFor(text) }, sub };
}

/** "37.54" -> 37.54; '' / 'abc' / null -> null. (Number('') is 0, which must never become a pin at 0,0.) */
export function toCoord(v) {
  const s = clean(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A place can be drawn / navigated by coordinates only when both are real numbers on Earth (and not 0,0). */
export function hasCoords(place) {
  const lat = toCoord(place?.lat);
  const lng = toCoord(place?.lng);
  if (lat === null || lng === null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** `hidden` column: the Apps Script writes 'yes' or ''; treat any other truthy-looking text as hidden too. */
export function isHidden(place) {
  const v = clean(place?.hidden).toLowerCase();
  return v !== '' && v !== '0' && v !== 'no' && v !== 'false' && v !== 'n';
}

/** JSON string -> plain object, else null ('' , bad JSON, arrays and scalars all count as "no data"). */
export function parseJsonObject(s) {
  const text = clean(s);
  if (text === '') return null;
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const isVerified = (place) => clean(place?.verified).toLowerCase() === 'yes';

/**
 * What the card shows for opening hours. null = show nothing (places added in the app carry no checked data).
 * tone: 'pending' | 'open' | 'closed' | 'plain'. Unverified or empty data is always 'pending' ("待確認"):
 * an unchecked time must never be shown as a fact, and never as open/closed.
 */
export function hoursView(place, now = new Date()) {
  if (clean(place?.source) === 'app') return null;
  const text = clean(place?.hours_text);
  const obj = parseJsonObject(place?.hours_json);
  if (clean(place?.category) === 'hotel' && text === '' && obj === null) return null; // a hotel has no shop hours to confirm
  if (!isVerified(place) || (text === '' && obj === null)) return { tone: 'pending', badge: '待確認', text };
  const state = obj ? formatHoursBadge(obj, now) : null;
  if (state === '營業中') return { tone: 'open', badge: state, text };
  if (state === '已打烊') return { tone: 'closed', badge: state, text };
  return text ? { tone: 'plain', badge: null, text } : { tone: 'pending', badge: '待確認', text };
}

/**
 * Today's hours as the price of a line on the 今日菜單: the windows of today as '11:00–21:00' (several joined by ' / '), 公休 for a
 * closed day, 24 小時 for a whole day. null whenever it would not be a checked fact: unverified, added in the app, no hours_json, or
 * a weekday the data does not cover (an empty price beats a wrong one).
 */
export function menuHours(place, now = new Date()) {
  if (!place || clean(place.source) === 'app' || !isVerified(place)) return null;
  const obj = parseJsonObject(place.hours_json);
  if (!obj) return null;
  const { windows } = hoursToday(obj, now);
  if (!windows) return null;
  if (windows.length === 0) return '公休';
  if (windows.length === 1 && windows[0][0] === '00:00' && windows[0][1] === '24:00') return '24 小時';
  return windows.map(([from, to]) => `${from}–${to}`).join(' / ');
}

const HOURS_LINE = /^(.*?\S)\s+(\d{1,2}:\d{2}.*)$/;

/**
 * hours_text -> the rows of the card's menu. A line written "label time…" (「每日 11:00–21:00」) is a row with the label on the left and
 * the time as the price; any other line (time first, no time, prose) stays one row of plain text: it is never cut up.
 * Lines are separated by '；', ';' or a line break. -> [{label, value, text}]
 */
export function splitHoursText(text) {
  return clean(text).split(/[；;\n]/).map(clean).filter(Boolean).map((line) => {
    const m = HOURS_LINE.exec(line);
    return m && !/\d:\d/.test(m[1]) ? { label: m[1], value: m[2], text: line } : { label: '', value: '', text: line };
  });
}

/**
 * What the card's hours block shows: the rows (splitHoursText) and the state line. status: {tone: 'open'|'closed'|'pending', badge,
 * leftMin (open: minutes to closing), opensInMin (closed: minutes to the next opening today)}, null when the Sheet only has text.
 * null for a place that shows no hours at all (see hoursView).
 */
export function hoursCard(place, now = new Date()) {
  const hv = hoursView(place, now);
  if (!hv) return null;
  const rows = splitHoursText(hv.text);
  if (hv.tone === 'pending') return { rows, status: { tone: 'pending', badge: hv.badge, leftMin: null, opensInMin: null } };
  if (hv.tone === 'plain') return { rows, status: null };
  if (rows.length === 0) { // checked, structured hours but no text: today's hours are the value (a bare 待確認 would contradict 營業中)
    const today = menuHours(place, now);
    if (today) rows.push({ label: '今天', value: today, text: `今天 ${today}` });
  }
  const t = hoursToday(parseJsonObject(place.hours_json), now);
  return { rows, status: { tone: hv.tone, badge: hv.badge, leftMin: t.closesInMin, opensInMin: t.opensInMin } };
}

/**
 * Signature dish / item; same "unverified -> 待確認" rule as the hours. A place added in the app has one only when the friend typed it in the add
 * form: then it is that text as it is (nothing to confirm, no 待確認); without it, null (no section).
 */
export function signatureView(place) {
  const text = clean(place?.signature);
  if (clean(place?.source) === 'app') return text === '' ? null : { text, pending: false };
  if (clean(place?.category) === 'hotel' && text === '') return null; // nothing "signature" about a hotel
  return { text, pending: !isVerified(place) || text === '' };
}

/** `who` ("A|J") -> names in the order written, unknown initials skipped, duplicates dropped. */
export function whoNames(place) {
  const out = [];
  for (const initial of clean(place?.who).split('|')) {
    const name = nameOf(initial.trim());
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * What is personal to `person` on this card. Only Lee has data today: purchase-list items matched by brand,
 * plus `personal_json.L.recs` (array of {name, why} or plain strings). Everything else is [] / empty.
 */
export function personalFor(place, person, purchases = []) {
  if (person !== 'Lee') return { items: [], recs: [] };
  const items = itemsForPlace(place, purchases);
  const mine = parseJsonObject(place?.personal_json)?.L;
  const rawRecs = mine && typeof mine === 'object' && Array.isArray(mine.recs) ? mine.recs : [];
  const recs = [];
  for (const r of rawRecs) {
    if (typeof r === 'string' && r.trim()) recs.push({ name: r.trim(), why: '' });
    else if (r && typeof r === 'object' && text(r.name)) recs.push({ name: text(r.name), why: text(r.why) });
  }
  return { items, recs };
}

/** 'android' | 'ios' | 'desktop' from navigator-like fields (iPadOS reports itself as a touch-capable Mac). */
export function detectPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (platform === 'MacIntel' && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/**
 * Google Maps: the search for the place's name (placeSearchQuery, links.js), which lands on the place's own page. Never a route, with or
 * without coordinates. `areaKr`: the Korean name of the place's area (area-lobes.js areaKoreanName), for a very short Korean name.
 */
export function googleUrl(place, areaKr = '') {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeSearchQuery(place, areaKr))}`;
}

/**
 * Naver Map target per platform that opens the place's own page (a search for its name, placeSearchQuery). kind 'web' opens in a new
 * tab; 'intent' (Android) carries its own web fallback; 'app' (iOS custom scheme) needs the caller to fall back to `fallback` if the
 * page stays visible. `areaKr`: the Korean name of the place's area (area-lobes.js areaKoreanName), for a very short Korean name.
 * Without coordinates every platform gets the search-by-name page.
 */
export function naverShopTarget(place, platform, areaKr = '') {
  const links = naverShopLinks(place, NAVER_APPNAME, areaKr);
  if (!hasCoords(place) || platform === 'desktop') return { kind: 'web', href: links.web };
  if (platform === 'android') return { kind: 'intent', href: links.intent, fallback: links.web };
  return { kind: 'app', href: links.app, fallback: links.web };
}

/** "30,000" / " 30000 " -> 30000; anything not a positive whole number -> null. */
export function parseAmount(s) {
  const t = clean(s).replace(/[,\s]/g, '');
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Only https links from the Sheet are ever put in an href (blocks javascript: and other schemes). */
export function safeHttpsUrl(s) {
  try {
    const u = new URL(clean(s));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
