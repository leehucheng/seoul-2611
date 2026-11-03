// What the "add a place" box does with the text it was given.
// A link (or a whole share text that contains one) goes to the server's resolveLink; anything else
// is a name to search for. "A link" means http:// or https:// somewhere in the text; api.js's mock
// resolveLink uses the same test, so the mock and this classifier never disagree.
//
// A name goes to the server's searchPlace, which is the Google geocoder: an address lookup, not a shop search. A chain's name alone
// ("olive young") finds nothing there, but with a district after it ("olive young 성수") it finds the branches. So planSearch() sends
// the name as typed AND the name with the Korean name of the district nearest to the middle of the map (or to me), and
// mergeResults() puts the answers together: no duplicates, the nearest branch first, at most 8. Pure, no DOM, no network.
import { distanceMeters } from './geo.js';

const LINK = /https?:\/\//i;

// -> {kind: 'empty'|'url'|'query', value}. value is the trimmed text; for 'url' it is the WHOLE text,
// because a share text carries the place name and address next to the link and the server uses them.
export function classifyPlaceInput(s) {
  const value = (s === null || s === undefined ? '' : String(s)).trim();
  if (value === '') return { kind: 'empty', value: '' };
  if (LINK.test(value)) return { kind: 'url', value };
  return { kind: 'query', value };
}

// ---- search: the district names ------------------------------------------------------------------------------------------------

export const SEOUL_CITY_HALL = Object.freeze({ lat: 37.5663, lng: 126.9779 });
/** The map middle (or me) farther than this from City Hall is not in Seoul: only the name as typed is searched. */
export const SEOUL_RADIUS_M = 40_000;
/** Results shown at most. */
export const MAX_MERGED = 8;
/** Two results nearer to each other than this are the same place. */
export const SAME_SPOT_M = 30;
const MAX_QUERY_LEN = 100; // the server's (and api.js's) limit for one search text

// [Chinese name as the Sheet writes it, Korean word added to a search, lat, lng, other ways to write it: Chinese, Korean (a stem is
// enough: 성수 is also in 성수동), English]. The centres are station / landmark coordinates (tools/areas.mjs has the same for most).
const AREA_ROWS = [
  ['聖水', '성수', 37.5446, 127.0559, ['聖水洞', 'seongsu']],
  ['安國', '안국', 37.5765, 126.9854, ['anguk']],
  ['市廳', '시청', 37.5657, 126.9769, ['시청역', 'city hall', 'sicheong']],
  ['明洞', '명동', 37.5609, 126.9863, ['myeongdong']],
  ['弘大', '홍대', 37.5572, 126.9245, ['弘益', '홍익', 'hongdae', 'hongik']],
  ['狎鷗亭', '압구정', 37.5270, 127.0284, ['apgujeong']],
  ['江南', '강남', 37.4979, 127.0276, ['gangnam']],
  ['漢南洞', '한남동', 37.5345, 127.0010, ['漢南', '한남', 'hannam']],
  ['龍山', '용산', 37.5298, 126.9648, ['yongsan']],
  ['蠶室', '잠실', 37.5133, 127.1001, ['jamsil']],
  ['西村', '서촌', 37.5800, 126.9700, ['seochon']],
  ['惠化', '혜화', 37.5822, 127.0018, ['hyehwa']],
  ['景福宮', '경복궁', 37.5796, 126.9770, ['gyeongbokgung']],
  ['德壽宮', '덕수궁', 37.5658, 126.9751, ['deoksugung']],
  ['成均館大學', '성균관대', 37.5878, 126.9946, ['成均館', '성균관', 'sungkyunkwan', 'seonggyungwan']],
  ['東大門', '동대문', 37.5711, 127.0095, ['dongdaemun']],
  ['新村', '신촌', 37.5552, 126.9369, ['sinchon']],
  ['梨泰院', '이태원', 37.5345, 126.9946, ['itaewon']],
  ['鐘路3街', '종로3가', 37.5704, 126.9921, ['鐘路', '종로', 'jongno', 'jongro']],
  ['光化門', '광화문', 37.5759, 126.9768, ['gwanghwamun']],
  ['仁寺洞', '인사동', 37.5740, 126.9850, ['insadong', 'insa-dong']],
  ['三清洞', '삼청동', 37.5826, 126.9806, ['samcheongdong']],
  ['北村', '북촌', 37.5826, 126.9835, ['bukchon']],
  ['益善洞', '익선동', 37.5745, 126.9890, ['ikseondong']],
  ['延南洞', '연남동', 37.5624, 126.9250, ['延南', '연남', 'yeonnam']],
  ['望遠洞', '망원동', 37.5559, 126.9017, ['望遠', '망원', 'mangwon']],
  ['建大', '건대', 37.5404, 127.0692, ['건국대', 'konkuk', 'kondae']],
  ['首爾林', '서울숲', 37.5445, 127.0374, ['seoul forest', 'seoulsup']],
];

const isLatin = (s) => /^[a-z0-9][a-z0-9 -]*$/i.test(s);
// A Latin name matches at the start of a word only ("anguk" is not in "hanguk"), with a space or a hyphen inside it optional ("city hall").
const latinPattern = (names) => new RegExp(`(?:^|[^a-z])(?:${names.map((n) => n.toLowerCase().replace(/[ -]+/g, '[ -]*')).join('|')})`, 'i');

/** The districts a search can be widened with: {zh, kr, lat, lng, names (every way to write it), latin (RegExp or null)}. */
export const SEARCH_AREAS = Object.freeze(AREA_ROWS.map(([zh, kr, lat, lng, more]) => {
  const names = [zh, kr, ...more];
  const latin = names.filter(isLatin);
  return Object.freeze({
    zh, kr, lat, lng,
    names: Object.freeze(names.filter((n) => !isLatin(n))),
    latin: latin.length ? latinPattern(latin) : null,
  });
}));

/** The district a search text names (in Chinese, Korean or English: 聖水 / 성수 / 성수동 / Seongsu), or null. */
export function areaIn(text) {
  const s = String(text ?? '');
  return SEARCH_AREAS.find((a) => a.names.some((n) => s.includes(n)) || (a.latin !== null && a.latin.test(s))) ?? null;
}

// A number, or NaN: null, '' and booleans are not positions (Number() would make them 0 or 1).
const coord = (v) => (v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v));
const validCentre = (c) => (c && Number.isFinite(coord(c.lat)) && Number.isFinite(coord(c.lng)) ? { lat: coord(c.lat), lng: coord(c.lng) } : null);

/** The district whose centre is nearest to `centre` ({lat, lng}), or null without a usable centre. */
export function nearestArea(centre) {
  const c = validCentre(centre);
  if (!c) return null;
  let best = null;
  let bestM = Infinity;
  for (const a of SEARCH_AREAS) {
    const m = distanceMeters(c, a);
    if (m < bestM) { best = a; bestM = m; }
  }
  return best;
}

/**
 * The searches to run for a typed name. `centre` is the middle of the map, or my position while the map follows me ({lat, lng}).
 * -> {queries, centre, area, hadArea}: `queries` are the texts to send (in parallel): the name as typed, and, unless the text already
 * names a district, the name + the Korean word of the nearest district (`area`). With no centre, a centre more than 40 km from City
 * Hall, or a widened text over the 100-character limit, it is the name as typed only. `centre` is the usable centre or null.
 */
export function planSearch(query, centre) {
  const typed = String(query ?? '').trim();
  const c = validCentre(centre);
  const plan = { queries: [typed], centre: c, area: null, hadArea: areaIn(typed) !== null };
  if (!c || plan.hadArea || distanceMeters(c, SEOUL_CITY_HALL) > SEOUL_RADIUS_M) return plan;
  const area = nearestArea(c);
  const widened = `${typed} ${area.kr}`;
  if (widened.length > MAX_QUERY_LEN) return plan;
  return { ...plan, queries: [typed, widened], area };
}

// ---- search: putting the answers together ----------------------------------------------------------------------------------------

const addressKey = (a) => String(a ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The answers of several searches ([[{name, address, lat, lng, ...}, ...], ...], the typed name's first) as one list: a result without a
 * usable position is dropped; so is one that has the same address as, or lies within 30 m of, one already kept (the earlier list wins);
 * the rest is sorted by distance from `centre` (nearest first; a tie keeps the order it came in) and cut to 8. With a centre every result gets
 * `distanceM` (metres, straight line); without one the order is kept and there is none. The results are copies; the input is not changed.
 */
export function mergeResults(lists, centre, max = MAX_MERGED) {
  const c = validCentre(centre);
  const kept = [];
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const r of Array.isArray(list) ? list : []) {
      const lat = coord(r?.lat);
      const lng = coord(r?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = addressKey(r.address);
      const dup = kept.some((k) => (key !== '' && k.key === key) || distanceMeters(k.pos, { lat, lng }) < SAME_SPOT_M);
      if (!dup) kept.push({ r, key, pos: { lat, lng }, order: kept.length });
    }
  }
  if (c) for (const k of kept) k.m = distanceMeters(c, k.pos);
  if (c) kept.sort((a, b) => a.m - b.m || a.order - b.order);
  return kept.slice(0, max).map((k) => (c ? { ...k.r, distanceM: k.m } : { ...k.r }));
}

/**
 * Promise.allSettled results of the searches -> {lists, error}: the answers of the ones that worked. One failing search does not hide the
 * others; `error` (the first search's, else the next one's) is only set when none worked, so the caller can show it as before.
 */
export function collectSearches(settled) {
  const lists = [];
  let error = null;
  for (const s of Array.isArray(settled) ? settled : []) {
    if (s?.status === 'fulfilled') lists.push(Array.isArray(s.value) ? s.value : []);
    else if (error === null) error = s?.reason ?? new Error('unknown');
  }
  return lists.length > 0 ? { lists, error: null } : { lists, error: error ?? new Error('unknown') };
}

/** 350 m, 1.2 km (nearest 10 m below a kilometre, one decimal up to 10 km, whole kilometres beyond). '' for anything that is not a distance. */
export function formatDistance(meters) {
  const m = typeof meters === 'number' ? meters : NaN;
  if (!Number.isFinite(m) || m < 0) return '';
  const r = Math.round(m / 10) * 10;
  if (r < 1000) return `${Math.max(r, 10)} m`;
  const tenths = Math.round(m / 100) / 10;
  return tenths < 10 ? `${tenths.toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}
