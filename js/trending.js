// 熱門必買: the logic of the list of what Seoul buys social media and the news talked about (8/3-11/3), apart from the screen (ui/trending.js).
// The data is app/data/trending.json, public product information only: {made, window, items: [{id, group, sub, name_zh, name_ko, brand, where,
// price_krw, price_note, why, limited, buzz, sources: [{url, platform, date, note}]}]}. It is read once, when the screen is first opened.
//
// parseTrending(raw)           the file as the screen uses it ({made, window, items}); throws Error('bad_trending') when it is not that
// groupCounts(items)           {all, cvs, mart, ...}: how many items in each group
// visibleGroups(items, {group, query})  [{id, label, subs: [{sub, items}]}]: the six groups in their fixed order, inside one the subs in the
//                              order the file has them, inside a sub `buzz: high` first and file order otherwise; `group` is 'all' or a group
//                              id, `query` (blanks around it ignored, any case) must be contained in name_zh, name_ko, brand or where
// priceText(item)              '₩12,000' or 「價格未知」;  tagsOf(item): the pills 「討論度高」 / 「討論度中」 and 「限定・…」
// sourceLink(item)             {url, label: 'Naver・10/12'} for the first source with an https address, else null (news / blog / magazine / media
//                              are shown as 新聞 / 部落格 / 雜誌 / 媒體; a name such as Naver or Musinsa as it is)
// item.image_url / item.image_kind  an optional photo on the brand's or retailer's own site (the app links to it, never copies it): an https
//                              address (anything else is no photo) and 'product' | 'brand' | 'store' (a brand's or a store's photo is captioned
//                              「品牌照」 / 「門市照」, see imageCaption). groupMark(id): the icon and colour family of a group, shown where there is no photo
// shoppingPrefill(item)        what 「加到我的代購」 puts in the 代購 add form (ui/shopping.js openShopping({prefill})); the photo's address goes in 圖片連結
// inShoppingList(item, mine)   one of my shopping items has the same name_ko (the same name_zh when the item has no name_ko)
// loadTrendGroup / saveTrendGroup(storage)  the group chip, per phone: localStorage `seoul.trend.group`; a storage that is blocked never breaks it
import { REFERENCE_SOURCE, formatKrw, priceDateLabel } from './shopping.js';
import { safeHttpsUrl } from './place-view.js';

export const TREND_GROUP_KEY = 'seoul.trend.group';
export const ALL_GROUPS = 'all';
/** The six groups, in the order the screen shows them: [id, label]. */
export const TREND_GROUPS = Object.freeze([
  ['cvs', '便利商店'], ['mart', '超市'], ['souvenir', '伴手禮'], ['fashion', '衣服'], ['beauty', '美妝'], ['perfume', '香水'],
].map((g) => Object.freeze(g)));
export const TREND_WINDOW = '社群與新聞 8/3–11/3';
export const TREND_LEAD = `${TREND_WINDOW} 討論最多的東西・價格以現場為準`;
export const TREND_LOAD_FAILED = '讀不到熱門清單，連上網路再試一次';
export const PRICE_UNKNOWN = '價格未知';
export const PRICE_SOURCE = REFERENCE_SOURCE; // the 代購 list calls a price with this source 「參考價」 (shopping.js priceLabel)

const clean = (v) => String(v ?? '').trim();

/** The row's second line on the 清單 view: 「103 項・社群與新聞 8/3–11/3」, or without the count before the file has been read. */
export const trendCardLine = (count) => (Number.isInteger(count) ? `${count} 項・${TREND_WINDOW}` : TREND_WINDOW);

export const isTrendGroup = (id) => id === ALL_GROUPS || TREND_GROUPS.some(([g]) => g === id);

export const groupLabel = (id) => (id === ALL_GROUPS ? '全部' : TREND_GROUPS.find(([g]) => g === id)?.[1] ?? '');

// ---- the file ------------------------------------------------------------------------------------------------------------

/** What a photo is of: the caption it gets under the thumbnail ('' for the product itself, which needs none). */
export const IMAGE_KINDS = Object.freeze({ product: '', brand: '品牌照', store: '門市照' });

/** The icon (an SVG symbol of index.html) and colour family (colors.js FAMILIES) of a group: the mark that stands in for a photo. */
export const GROUP_MARKS = Object.freeze({
  cvs: Object.freeze({ icon: 'i-cake', family: 'sweet' }),
  mart: Object.freeze({ icon: 'i-bowl', family: 'eat' }),
  souvenir: Object.freeze({ icon: 'i-bag', family: 'shop' }),
  fashion: Object.freeze({ icon: 'i-shirt', family: 'shop' }),
  beauty: Object.freeze({ icon: 'i-perfume', family: 'shop' }),
  perfume: Object.freeze({ icon: 'i-perfume', family: 'shop' }),
});
export const groupMark = (id) => GROUP_MARKS[id] ?? GROUP_MARKS.souvenir;

/** The caption under a photo ('' when the item has no photo or the photo is of the product). */
export const imageCaption = (item) => (item.image_url !== '' ? IMAGE_KINDS[item.image_kind] ?? '' : '');

function toSource(row) {
  if (row === null || typeof row !== 'object') return null;
  return { url: clean(row.url), platform: clean(row.platform), date: clean(row.date), note: clean(row.note) };
}

function toPrice(v) {
  const n = typeof v === 'number' ? v : /^\d{1,9}$/.test(clean(v)) ? Number(clean(v)) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** One item of the file as an item (strings trimmed, price a whole number of won or null), or null when it is not one the screen can show. */
export function toTrendItem(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  const item = {
    id: clean(row.id), group: clean(row.group), sub: clean(row.sub), name_zh: clean(row.name_zh), name_ko: clean(row.name_ko),
    brand: clean(row.brand), where: clean(row.where), price_krw: toPrice(row.price_krw), price_note: clean(row.price_note), why: clean(row.why),
    limited: clean(row.limited), buzz: clean(row.buzz),
    image_url: safeHttpsUrl(row.image_url) ?? '', // only an https address is a photo
    image_kind: Object.hasOwn(IMAGE_KINDS, clean(row.image_kind).toLowerCase()) ? clean(row.image_kind).toLowerCase() : '',
    sources: (Array.isArray(row.sources) ? row.sources : []).map(toSource).filter((s) => s !== null),
  };
  if (item.id === '' || !TREND_GROUPS.some(([g]) => g === item.group) || (item.name_zh === '' && item.name_ko === '')) return null;
  if (item.name_zh === '') item.name_zh = item.name_ko; // the card's bold line is never empty
  return item;
}

export function parseTrending(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.items)) throw new Error('bad_trending');
  const items = raw.items.map(toTrendItem).filter((it) => it !== null);
  if (items.length === 0) throw new Error('bad_trending');
  return { made: clean(raw.made), window: clean(raw.window), items };
}

/** Reads app/data/trending.json (next to js/, so it follows the app under any sub-path). */
export async function loadTrendingFile(fetchFn = fetch) {
  const res = await fetchFn(new URL('../data/trending.json', import.meta.url));
  if (!res.ok) throw new Error(`trending ${res.status}`);
  return res.json();
}

// ---- what the screen shows -----------------------------------------------------------------------------------------------

export function groupCounts(items) {
  const counts = { [ALL_GROUPS]: items.length };
  for (const [id] of TREND_GROUPS) counts[id] = items.filter((it) => it.group === id).length;
  return counts;
}

const fold = (s) => clean(s).normalize('NFC').toLowerCase();

export function matchesQuery(item, query) {
  const q = fold(query);
  return q === '' || [item.name_zh, item.name_ko, item.brand, item.where].some((v) => fold(v).includes(q));
}

export function visibleGroups(items, { group = ALL_GROUPS, query = '' } = {}) {
  const out = [];
  for (const [id, label] of TREND_GROUPS) {
    if (group !== ALL_GROUPS && group !== id) continue;
    const subs = [];
    for (const it of items) {
      if (it.group !== id || !matchesQuery(it, query)) continue;
      let sub = subs.find((s) => s.sub === it.sub);
      if (!sub) subs.push(sub = { sub: it.sub, items: [] });
      sub.items.push(it);
    }
    for (const s of subs) { // high first, file order among equals (the index breaks ties, so the order does not depend on the sort being stable)
      const at = new Map(s.items.map((it, i) => [it, i]));
      s.items.sort((a, b) => (b.buzz === 'high') - (a.buzz === 'high') || at.get(a) - at.get(b));
    }
    if (subs.length > 0) out.push({ id, label, subs });
  }
  return out;
}

export const priceText = (item) => (item.price_krw === null ? PRICE_UNKNOWN : formatKrw(item.price_krw));

/** 「brand · where」 with whatever of the two there is (once, when they are the same word). */
export const metaOf = (item) => [...new Set([item.brand, item.where].filter(Boolean))].join(' · ');

/** [{kind: 'high' | 'mid' | 'limited', text}] */
export function tagsOf(item) {
  const tags = [];
  if (item.buzz === 'high') tags.push({ kind: 'high', text: '討論度高' });
  else if (item.buzz === 'medium') tags.push({ kind: 'mid', text: '討論度中' });
  if (item.limited !== '') tags.push({ kind: 'limited', text: `限定・${item.limited}` });
  return tags;
}

/** The plain words the file uses for a kind of source, in Chinese; a name (Naver, Musinsa, OY 榜單彙整 ...) is shown as it is. */
const PLATFORM_NAMES = Object.freeze({ news: '新聞', blog: '部落格', magazine: '雜誌', media: '媒體' });
export const platformName = (platform) => PLATFORM_NAMES[clean(platform).toLowerCase()] ?? clean(platform);

export function sourceLink(item) {
  for (const s of item.sources) {
    const url = safeHttpsUrl(s.url);
    if (url !== null) return { url, label: [platformName(s.platform), priceDateLabel(s.date)].filter(Boolean).join('・') };
  }
  return null;
}

/** The newest date among the item's sources ('2026-10-12'), '' when none has a date. */
export function newestSourceDate(item) {
  return item.sources.map((s) => (/^\d{4}-\d{2}-\d{2}/.test(s.date) ? s.date.slice(0, 10) : '')).filter(Boolean).sort().at(-1) ?? '';
}

export function shoppingPrefill(item) {
  return {
    name_zh: item.name_zh, name_ko: item.name_ko, brand: item.brand, where: item.where,
    price_krw: item.price_krw === null ? '' : String(item.price_krw), image_url: item.image_url,
    price_source: PRICE_SOURCE, price_date: newestSourceDate(item), note: item.price_note,
  };
}

export function inShoppingList(item, mine) {
  const key = item.name_ko !== '' ? 'name_ko' : 'name_zh';
  return (mine ?? []).some((it) => clean(it[key]) === item[key]);
}

// ---- the group chip, per phone ---------------------------------------------------------------------------------------------

export function loadTrendGroup(storage) {
  try {
    const v = storage.getItem(TREND_GROUP_KEY);
    return isTrendGroup(v) ? v : ALL_GROUPS;
  } catch { return ALL_GROUPS; } // missing, blocked or odd storage: 「全部」
}

export function saveTrendGroup(storage, id) {
  try { storage.setItem(TREND_GROUP_KEY, id); } catch { /* private mode / quota: it still works until the page is closed */ }
}
