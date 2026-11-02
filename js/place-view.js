// Pure view-model helpers for the place card and the map (no DOM, no globals) so they run in Node tests.
// Every Place value arrives from the Sheet as a string; nothing here trusts a value to be well formed.
import { CATEGORIES } from './categories.js';
import { NEUTRAL } from './colors.js';
import { formatHoursBadge } from './hours.js';
import { hasHangul, zhOf } from './i18n.js';
import { googleDirUrl, naverLinks } from './links.js';
import { itemsForPlace } from './match.js';
import { nameOf } from './people.js';

const NAVER_APPNAME = 'seoul-2611';
const clean = (v) => String(v ?? '').trim();

const OTHER = Object.freeze({ id: 'other', label: '其他', color: '#475569', ...NEUTRAL, icon: 'i-pin' });

/** Category record for a place's `category` id; an unknown id (e.g. typed by hand in the Sheet) gets a neutral pin. */
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === clean(id)) ?? OTHER;

/**
 * The category chip filter. It must compare the same normalised id the chips are built from, otherwise a place
 * with an empty or unknown category gets a "其他" chip that filters to nothing.
 */
export const matchesCategory = (place, filter) => filter === 'all' || categoryOf(place?.category).id === filter;

/**
 * Names for the top of the card. The Chinese name is the title and the Korean name sits under it, smaller;
 * with no Chinese name the Korean name is the title and gets its Chinese line (`zh`) under it. Any Korean string
 * on a line carries `zh` too when the snapshot has a translation; null means "nothing extra".
 * -> {title: {text, zh}, sub: [{text, zh}]}
 */
export function nameBlock(place, translations) {
  const zhName = clean(place?.name_zh);
  const kr = clean(place?.name_kr);
  const en = clean(place?.name_en);
  const text = zhName || kr || en || '（未命名）';
  const zhFor = (s) => (hasHangul(s) ? zhOf(s, translations) : null);
  const sub = [];
  if (zhName && kr && kr !== zhName) sub.push({ text: kr, zh: null }); // the title above is this Korean name's Chinese line
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

/** Signature dish / item; same "unverified -> 待確認" rule as the hours. null for places added in the app. */
export function signatureView(place) {
  if (clean(place?.source) === 'app') return null;
  const text = clean(place?.signature);
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

const mapsQuery = (place) => clean(place?.name_kr) || clean(place?.name_zh) || clean(place?.name_en);

/** Google Maps: directions by coordinates, or a name search when the place has no coordinates (never an empty `dir`). */
export function googleUrl(place) {
  if (hasCoords(place)) return googleDirUrl({ lat: place.lat, lng: place.lng });
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery(place))}`;
}

/**
 * Naver Map target per platform. kind 'web' opens in a new tab; 'intent' (Android) carries its own web
 * fallback; 'app' (iOS custom scheme) needs the caller to fall back to `fallback` if the page stays visible.
 * Without coordinates there is nothing to route to, so every platform gets the search-by-name page.
 */
export function naverTarget(place, platform) {
  const named = { ...place, name_kr: mapsQuery(place), name_zh: '' };
  const links = naverLinks(named, NAVER_APPNAME);
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
