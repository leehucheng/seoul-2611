// View model of the hotel card (the screen shown to a taxi driver). Pure: no DOM, no globals.
// The hotel comes from buildToday().hotel (the Sheet's own name); the Place is found by that name among the
// places of category `hotel`. Hotel names are never written here: they come from the Sheet at runtime.
import { hasHangul, zhOf } from './i18n.js';
import { matchPlace } from './match.js';
import { isHidden } from './place-view.js';

export const NO_HOTEL_TEXT = '表上沒寫今晚住哪';

const clean = (v) => String(v ?? '').trim();
const zhFor = (s, translations) => (hasHangul(s) ? zhOf(s, translations) : null);

/** The visible Place of category `hotel` that `name` (the Sheet's hotel name) points to, or null. Other categories never match. */
export function findHotelPlace(name, places) {
  const hotels = (places ?? []).filter((p) => clean(p?.category) === 'hotel' && !isHidden(p));
  const id = matchPlace(name, hotels);
  return id === null ? null : hotels.find((p) => p.id === id) ?? null;
}

// A phone cell may list several numbers ("02-000-0001 / 02-000-0002", "A, B", "A or B", one per line).
const PHONE_SEPARATORS = /[/,、;，；\n\r]|\s+or\s+/i;
// "ext. 9", "extension 9", "#9", "x 9", "轉 9", "分機 9": the extension and whatever follows is not part of the number to dial.
const PHONE_EXTENSION = /\s*(?:ext(?:ension)?\.?|#|轉|分機)\s*\d+.*$|\s+x\s*\d+.*$/i;

/**
 * The first phone number of a cell, as the target of a tel: link: digits, and a leading + only. A second number, an
 * extension and any other text never reach the link. '' when there are no digits ("no phone", an empty cell).
 */
export function telOf(phone) {
  for (const part of clean(phone).split(PHONE_SEPARATORS)) {
    const s = part.replace(PHONE_EXTENSION, '').trim();
    const digits = s.replace(/\D/g, '');
    if (digits !== '') return (/^[\s(（]*\+/.test(s) ? '+' : '') + digits;
  }
  return '';
}

const HANGUL_RUNS = /[가-힣][가-힣\d]*(?:\s+[가-힣\d]+)*/g;

/**
 * The Korean part of a Sheet hotel name: "서울호텔12(SEOUL HOTEL 12)" -> "서울호텔12". The text before the first
 * parenthesis when it has Hangul, else the whole name; of that, the Hangul run(s) ("Grand 한강 호텔 Seoul" -> "한강 호텔").
 * '' when the name has no Hangul.
 */
export function hangulPart(name) {
  const s = clean(name);
  if (!hasHangul(s)) return '';
  const head = s.split(/[(（]/)[0];
  return (hasHangul(head) ? head : s).match(HANGUL_RUNS)?.join(' ').trim() ?? '';
}

const uniq = (list) => [...new Set(list)];

/**
 * What the card draws.
 *   {kind: 'none', text}      no hotel for this person on this night -> NO_HOTEL_TEXT
 *   {kind: 'found', ...}      the Place was found: name (large, Korean when it has one) with its Chinese line,
 *                             other names, address (large Korean) with its Chinese line, phone, the Place for the nav buttons
 *   {kind: 'unmapped', ...}   the Sheet names a hotel but no hotel Place matches: the Sheet's name and a search-by-name nav
 * `name` / `address`: {text, zh, korean}; the Chinese line is null when there is none (nothing extra is drawn).
 */
export function hotelCardView({ stay, places, translations }) {
  if (!stay) return { kind: 'none', text: NO_HOTEL_TEXT };
  const place = findHotelPlace(stay.name, places);

  if (!place) {
    const text = clean(stay.name);
    const korean = hasHangul(text);
    return {
      kind: 'unmapped',
      stay,
      name: { text, zh: zhFor(text, translations), korean },
      others: [],
      address: null,
      phone: null,
      navPlace: korean ? { name_kr: text } : { name_en: text },
    };
  }

  const kr = clean(place.name_kr);
  const en = clean(place.name_en);
  const zhName = clean(place.name_zh);
  // The driver reads Korean first: the Place's Korean name, else the Korean part of the Sheet's hotel name, then English / Chinese.
  const sheetKr = hangulPart(stay.name);
  const text = kr || sheetKr || en || zhName || clean(stay.name);
  const korean = hasHangul(text);
  // The translations are keyed by whole Sheet cells, so a Korean part cut out of the Sheet name falls back to the whole name's translation.
  const zh = korean ? (zhName && zhName !== text ? zhName : zhFor(text, translations) ?? (text === sheetKr ? zhFor(stay.name, translations) : null)) : null;

  const addrKr = clean(place.address_kr);
  const addrZh = clean(place.address_zh);
  let address = null;
  if (addrKr) address = { text: addrKr, zh: hasHangul(addrKr) ? addrZh || zhFor(addrKr, translations) : null, korean: hasHangul(addrKr) };
  else if (addrZh) address = { text: addrZh, zh: null, korean: false }; // a Chinese address is not what a driver reads, but better than nothing

  const phoneText = clean(place.phone);
  return {
    kind: 'found',
    stay,
    place,
    name: { text, zh, korean },
    others: uniq([zhName, en].filter((s) => s && s !== text && s !== zh)),
    address,
    phone: phoneText ? { text: phoneText, tel: telOf(phoneText) } : null,
    navPlace: place,
  };
}
