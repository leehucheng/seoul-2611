// The 「7 月」 layer (pure, no DOM, so Node tests run it): the places of the July trip are rows of App_Places whose `source` is 'july'. They are a
// layer of the map that is off by default and is switched per phone: localStorage `seoul.layer.july`, '1' = on.
//
//   splitJuly(places)             -> {own, july}. main.js keeps the two apart: app.places is ours only and app.julyPlaces the July ones, so everything
//                                    that reads app.places (the 今天 page, the 未上地圖 count, the first view, the district shapes, the 銀杏 tab, the
//                                    hotel card) never sees a July place, whether the layer is on or off.
//   mapPlaces(own, july, on)      -> what the map may draw: ours, and the July ones only while the layer is on (the chip row's categories and the
//                                    pins are made from this).
//   createJulyLayer(storage)      -> {isOn(), set(on)}: the layer's state. Read from `storage` once; set() writes it. A storage that is blocked
//                                    or full (app.storage is already an in-memory stand-in in private mode) never breaks it: the state stays here.
//   findJulyPlaces(places, text, {translations, limit}) -> the July places whose name or alias contains what was typed in the add form's search.
import { normalizeName } from './match.js';
import { placeName } from './pin-labels.js';
import { isHidden, isJulyPlace } from './place-view.js';

export const JULY_KEY = 'seoul.layer.july';
/** At most this many July places are offered under one search. */
export const JULY_RESULTS = 5;
const MIN_QUERY = 2; // normalised characters: one letter would match half of the list

export function splitJuly(places) {
  const own = [];
  const july = [];
  for (const p of Array.isArray(places) ? places : []) (isJulyPlace(p) ? july : own).push(p);
  return { own, july };
}

export const mapPlaces = (own, july, on) => (on ? [...(own ?? []), ...(july ?? [])] : [...(own ?? [])]);

export function loadJulyLayer(storage) {
  try { return storage.getItem(JULY_KEY) === '1'; } catch { return false; } // missing, blocked or odd storage: off
}

export function saveJulyLayer(storage, on) {
  try { storage.setItem(JULY_KEY, on ? '1' : '0'); } catch { /* private mode / quota: it still works until the page is closed */ }
}

export function createJulyLayer(storage) {
  let on = loadJulyLayer(storage);
  return {
    isOn: () => on,
    /** Switch the layer; true when that changed it. */
    set(next) {
      const value = Boolean(next);
      if (value === on) return false;
      on = value;
      saveJulyLayer(storage, on);
      return true;
    },
  };
}

/** Every normalised name of a place: the Chinese, Korean and English names, the aliases, and the name the map shows (a Korean-only name in Chinese). */
function namesOf(place, translations) {
  const raw = [place.name_zh, place.name_kr, place.name_en, placeName(place, translations), ...String(place.aliases ?? '').split('|')];
  return raw.map(normalizeName).filter(Boolean);
}

/**
 * The July places a typed text finds: a name or alias that contains it (blanks and case ignored), those where it comes earliest first (a
 * shop that starts with what was typed before one that has it in the middle), at most `limit`. A hidden place is not offered; text shorter
 * than two characters finds nothing. The input is not changed.
 */
export function findJulyPlaces(places, text, { translations = {}, limit = JULY_RESULTS } = {}) {
  const q = normalizeName(text);
  if ([...q].length < MIN_QUERY) return [];
  const hits = [];
  for (const place of Array.isArray(places) ? places : []) {
    if (!place || !isJulyPlace(place) || isHidden(place)) continue;
    const at = namesOf(place, translations).map((n) => n.indexOf(q)).filter((i) => i >= 0);
    if (at.length > 0) hits.push({ place, at: Math.min(...at) });
  }
  hits.sort((a, b) => a.at - b.at); // a stable sort: the same order as the list among equals
  return hits.slice(0, limit).map((hit) => hit.place);
}
