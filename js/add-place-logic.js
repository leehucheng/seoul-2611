// Pure helpers of the "add a place" form (no DOM, no globals) so they run in Node tests:
// error code -> Chinese message, Android share-target parameters, search-result wording, the aliases and
// the payload sent to addPlace, and "did my add reach the server after all" after a network failure.
import { CATEGORIES } from './categories.js';
import { hasHangul, zhOf } from './i18n.js';
import { normalizeName } from './match.js';

const clean = (v) => String(v ?? '').trim();

export const MSG = Object.freeze({
  noPermission: '這個網址沒有新增權限，請用分享給你的完整網址',
  unresolved: '讀不到這個連結的位置，改用店名搜尋',
  unsupported: '只支援 Google Map 和 Naver Map 的連結',
  noResults: '找不到，換個關鍵字，或用定位／點地圖',
  addNetwork: '可能已經存了，先重新整理再看看，不要重複送出',
  lookupNetwork: '連不上伺服器，等一下再試，或用定位／點地圖',
  emptyInput: '貼上連結，或打店名再按搜尋',
  noName: '請填店名',
  noLoc: '還沒選位置：用上面的搜尋選一家，或按「我現在的位置」／「在地圖上點」',
  noGps: '拿不到定位，請在地圖上點位置',
  busy: '大家同時在存，等幾秒再試',
});

/**
 * An Error code from api.js -> one Chinese line for the user. `action` is 'resolve' (pasted link), 'search'
 * (typed name) or 'add' (the final submit). Anything not listed shows its code so it can be reported.
 */
export function errorMessage(action, err) {
  const code = typeof err === 'string' ? err : clean(err?.message) || 'unknown';
  if (code === 'bad_key' || code === 'not_configured') return MSG.noPermission;
  if (code === 'busy') return MSG.busy; // the server's write lock was taken for 10 s: nothing was saved, trying again in a moment works
  if (action === 'resolve') {
    if (code === 'unsupported_link') return MSG.unsupported;
    if (code === 'unresolved' || code === 'no_url') return MSG.unresolved;
    if (code === 'bad_text') return '貼的文字太長，只貼連結就好';
    if (code === 'network') return MSG.lookupNetwork;
  }
  if (action === 'search') {
    if (code === 'bad_query') return '關鍵字太長，縮短一點再搜';
    if (code === 'OVER_QUERY_LIMIT') return '搜尋次數用完了，改用定位或在地圖上點';
    if (code === 'network') return MSG.lookupNetwork;
  }
  if (action === 'add' && code === 'network') return MSG.addNetwork;
  return `出了點問題（${code}）`;
}

const SHARE_KEYS = ['share_title', 'share_text', 'share_url'];

/**
 * Android share target (GET ?share_title=&share_text=&share_url=) -> what to put in the search box.
 * Map apps usually put the whole share text (name, address, link) in `text`; the link is added only when the
 * text lacks it, and the title is used only when there is no text. `search` is the query string with the share
 * parameters removed ('' or '?a=b'), for history.replaceState.
 * -> {text, hadShare, search}
 */
export function parseShareParams(search) {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  const get = (k) => clean(params.get(k));
  const text = get('share_text');
  const title = get('share_title');
  const url = get('share_url');
  const main = text || title;
  const pieces = [];
  if (main) pieces.push(main);
  if (url && !main.includes(url)) pieces.push(url);
  const hadShare = SHARE_KEYS.some((k) => params.has(k));
  for (const k of SHARE_KEYS) params.delete(k);
  const rest = params.toString();
  return { text: pieces.join('\n'), hadShare, search: rest ? `?${rest}` : '' };
}

/** A Chinese line is only shown under a Korean string, and only when it says something new. */
function zhLine(text, explicit, translations) {
  if (!hasHangul(text)) return '';
  const zh = clean(explicit) || zhOf(text, translations) || '';
  return zh && zh !== text ? zh : '';
}

/** A search / link result -> what one result row shows: the Korean name and address, each with its Chinese line. */
export function searchResultView(r, translations) {
  const name = clean(r?.name);
  const address = clean(r?.address);
  return {
    name,
    nameZh: zhLine(name, r?.name_zh, translations),
    address,
    addressZh: zhLine(address, r?.address_zh, translations),
  };
}

/** The suggested 店名 for a picked result: the Chinese name when there is one, else the name as given. */
export function nameFromPick(r, translations) {
  const v = searchResultView(r, translations);
  return clean(r?.name_zh) || v.nameZh || v.name;
}

/**
 * The `aliases` column (`|` separated): the sheet's own wording (presetAlias, a string or an array), then the
 * picked result's own name (Korean usually) so the sheet's text and the map's name find each other. A name the
 * place already has, or one seen twice, is left out.
 */
export function buildAliases({ name, pick, preset }) {
  const raw = [...(Array.isArray(preset) ? preset : [preset]), pick?.name, pick?.name_zh];
  const seen = new Set([normalizeName(name)]);
  const out = [];
  for (const a of raw) {
    const s = clean(a).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    const key = normalizeName(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.join('|');
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const NAME_MAX = 80;
const NOTE_MAX = 200;
const ADDRESS_MAX = 200;

/**
 * What the picked search / link result adds to the stored place: its Korean name (`name_kr`), Korean address
 * (`address_kr`) and, when the result carries one, the Chinese address (`address_zh`). Only a string that really is
 * Korean goes into a `_kr` column (an English share-text address would be wrong on a card shown to a taxi driver);
 * with no pick all three stay ''.
 */
export function koreanFromPick(pick) {
  const name = clean(pick?.name);
  const address = clean(pick?.address);
  return {
    name_kr: hasHangul(name) ? name.slice(0, NAME_MAX) : '',
    address_kr: hasHangul(address) ? address.slice(0, ADDRESS_MAX) : '',
    address_zh: clean(pick?.address_zh).slice(0, ADDRESS_MAX),
  };
}

/**
 * Form values -> {ok:true, payload} for addPlace, or {ok:false, field:'name'|'loc'}.
 * `loc` is {lat, lng}; a missing or impossible position (and 0,0) is "no location": wrong beats missing is
 * the rule for pins, so the form never guesses one. `pick` is the chosen result (or null); `locationSource` is where
 * `loc` came from ('pick' | 'gps' | 'tap'). A position set by GPS or a tap after the pick no longer matches the
 * result's address, so the address (Korean and Chinese) is dropped; the name is still what the user chose and stays.
 */
export function buildPayload({ name, category, note, loc, me, aliases, pick = null, locationSource = 'pick' }) {
  const n = clean(name);
  if (n === '' || n.length > NAME_MAX) return { ok: false, field: 'name' };
  const lat = loc?.lat === '' || loc?.lat === null ? NaN : Number(loc?.lat);
  const lng = loc?.lng === '' || loc?.lng === null ? NaN : Number(loc?.lng);
  const good = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!good) return { ok: false, field: 'loc' };
  const cat = CATEGORIES.some((c) => c.id === clean(category)) ? clean(category) : '';
  const fromPick = koreanFromPick(pick);
  if (locationSource === 'gps' || locationSource === 'tap') {
    fromPick.address_kr = '';
    fromPick.address_zh = '';
  }
  return {
    ok: true,
    payload: {
      name_zh: n,
      ...fromPick,
      category: cat,
      lat: round6(lat),
      lng: round6(lng),
      note: clean(note).slice(0, NOTE_MAX),
      added_by: clean(me),
      aliases: clean(aliases),
    },
  };
}

/**
 * After a network failure on addPlace the server may have stored the place anyway. A place in `places` that was
 * added from an app, by the same person, with the same name at the same spot is that place.
 */
export function findSavedDuplicate(places, payload) {
  if (!Array.isArray(places) || !payload) return null;
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-5;
  return places.find((p) => p
    && clean(p.source) === 'app'
    && clean(p.added_by) === clean(payload.added_by)
    && clean(p.name_zh) === clean(payload.name_zh)
    && near(p.lat, payload.lat)
    && near(p.lng, payload.lng)) ?? null;
}
