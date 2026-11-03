// 代購清單: the logic of the shopping list, apart from the screen (ui/shopping.js). Every item belongs to one person (`owner`, the name the
// app calls them by: app.me); the rows come from the Sheet's App_Shopping tab (snapshot.shopping) and are written by the backend's
// saveShopping / deleteShopping / setBought (api.js).
//
// toItem(row)            a row of the snapshot (or of an answer) as an item: every SHOP_FIELDS key, a trimmed string; null when it is not a row with an id.
// itemsOf(items, owner)  the visible items of one person, in list order. ownersOf(items, me): [me, ...everyone else who has an item].
// groupByWhere(items)    [{where, items}] in first-seen order; an item without a 「在哪買」 is in 「其他」.
// summarize / summaryText / cardLine   the numbers on the screen and on the card.
// checkForm(values, {owner, item})     the add / edit form -> {ok, item} to send, or {ok: false, field, error}.
// createShopping()       what the phone shows: the last snapshot's rows, with what was saved from this phone laid over them until a snapshot has it.
import { SHOP_FIELDS } from './fields.js';
import { safeHttpsUrl } from './place-view.js';

export const OTHER_GROUP = '其他';
export const SAVE_FAILED = '沒存到，連上網路再試一次';

const clean = (v) => String(v ?? '').trim();

/** 'TRUE' (any case) is true; bought and hidden are 'TRUE' or ''. */
export const isTrue = (v) => clean(v).toUpperCase() === 'TRUE';

export function toItem(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  const item = {};
  for (const k of SHOP_FIELDS) item[k] = clean(row[k]);
  return item.id === '' ? null : item;
}

/** The items that are not deleted (hidden), as items. */
export const visibleItems = (rows) => (Array.isArray(rows) ? rows : []).map(toItem).filter((it) => it !== null && !isTrue(it.hidden));

export const itemsOf = (items, owner) => items.filter((it) => owner !== '' && it.owner === owner);

/** [me, ...the other owners that have at least one item, in the order they first appear]. `me` is first whether or not it has items. */
export function ownersOf(items, me) {
  const out = [me];
  for (const it of items) if (it.owner !== '' && !out.includes(it.owner)) out.push(it.owner);
  return out;
}

export function groupByWhere(items) {
  const groups = [];
  for (const it of items) {
    const where = it.where === '' ? OTHER_GROUP : it.where;
    let g = groups.find((x) => x.where === where);
    if (!g) groups.push(g = { where, items: [] });
    g.items.push(it);
  }
  return groups;
}

/** The quantity as a whole number (1 when the cell is blank or odd). */
export function qtyOf(item) {
  const n = Number(item.qty);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** The price in won as a whole number; null when there is none (blank or not a number). */
export function priceOf(item) {
  return /^\d{1,9}$/.test(item.price_krw) ? Number(item.price_krw) : null;
}

/** 12500 -> '₩12,500' */
export const formatKrw = (n) => `₩${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** '2026-11-03' (or a full ISO time) -> '11/3'; '' for anything else. */
export function priceDateLabel(value) {
  const m = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(clean(value));
  return m ? `${Number(m[1])}/${Number(m[2])}` : '';
}

/** 「brand・spec」 with whatever of the two there is. */
export const metaLine = (item) => [item.brand, item.spec].filter(Boolean).join('・');

/**
 * count: items; bought: how many are ticked; total: the sum of price x quantity over the items that have a price; unpriced: how many have none.
 * (The brief says 「官網價合計」: a ×3 item counts three times.)
 */
export function summarize(items) {
  let total = 0;
  let unpriced = 0;
  for (const it of items) {
    const price = priceOf(it);
    if (price === null) unpriced += 1;
    else total += price * qtyOf(it);
  }
  return { count: items.length, bought: items.filter((it) => isTrue(it.bought)).length, total, unpriced };
}

export const summaryText = (s) => `${s.count} 項・已買 ${s.bought}・官網價合計 ${formatKrw(s.total)}`;
export const unpricedText = (s) => (s.unpriced > 0 ? `另有 ${s.unpriced} 項沒有價格` : '');

/** The card's second line: 「我的 N 項・已買 M」 over my own visible items. */
export function cardLine(mine) {
  const s = summarize(mine);
  return `我的 ${s.count} 項・已買 ${s.bought}`;
}

// ---- the add / edit form ------------------------------------------------------------------------------------------------

/** The form fields, in the order the form shows them: [field, label, kind]. The name is one of the first two (at least one is required). */
export const FORM_FIELDS = [
  ['name_zh', '中文名'], ['name_ko', '韓文名'], ['brand', '品牌'], ['spec', '規格'], ['qty', '數量'], ['for_whom', '幫誰買'],
  ['price_krw', '官網價 ₩'], ['where', '在哪買'], ['official_url', '官網連結'], ['image_url', '圖片連結'], ['note', '備註'],
];

/** What the form shows for an item (null: a new one, quantity 1). */
export function formValues(item) {
  const out = {};
  for (const [k] of FORM_FIELDS) out[k] = item ? item[k] ?? '' : '';
  if (!item) out.qty = '1';
  return out;
}

/**
 * Checks what was typed. `values` is {field: text}; `owner` is who is saving (app.me); `item` is the item being edited, or null for a new one.
 * -> {ok: true, item} where item is what saveShopping gets, or {ok: false, field, error}.
 *    A new item: the owner and every form field. An edit: only the id, the owner and the form fields the person changed (a field left as the
 *    form showed it is not sent, so a cell somebody typed into the Sheet meanwhile is never put back to what this phone had cached; it is not
 *    checked either), plus price_date / price_source / price_note as '' when the price is one of the changed fields (they described the old
 *    price). Nothing else of the item is sent: no actual_krw, no bought.
 * A price may be typed as ₩12,500; a link must be https; the quantity is 1-99.
 */
export function checkForm(values, { owner, item = null } = {}) {
  const typed = {};
  for (const [k] of FORM_FIELDS) typed[k] = clean(values[k]);
  if (clean(owner) === '') return { ok: false, field: 'name_zh', error: '先選好你是誰' };
  if (typed.name_zh === '' && typed.name_ko === '') return { ok: false, field: 'name_zh', error: '中文名和韓文名至少填一個' };
  const shown = formValues(item); // what the form had in it when it opened
  const out = item ? { id: item.id, owner } : { owner };
  for (const [k] of FORM_FIELDS) {
    if (item && typed[k] === clean(shown[k])) continue;
    let v = typed[k];
    if (k === 'qty') {
      if (v === '') v = '1';
      if (!/^\d{1,9}$/.test(v) || Number(v) < 1 || Number(v) > 99) return { ok: false, field: 'qty', error: '數量要是 1 到 99 的整數' };
      v = String(Number(v));
    } else if (k === 'price_krw') {
      v = v.replace(/[₩,\s]/g, '');
      if (v !== '' && !/^\d{1,9}$/.test(v)) return { ok: false, field: 'price_krw', error: '官網價只填數字，例如 12500' };
      v = v === '' ? '' : String(Number(v));
    } else if ((k === 'official_url' || k === 'image_url') && v !== '' && safeHttpsUrl(v) === null) {
      return { ok: false, field: k, error: `${k === 'official_url' ? '官網連結' : '圖片連結'}要用 https:// 開頭` };
    }
    out[k] = v;
  }
  if (item && 'price_krw' in out) Object.assign(out, { price_date: '', price_source: '', price_note: '' });
  return { ok: true, item: out };
}

// ---- what the phone shows -------------------------------------------------------------------------------------------------

/**
 * createShopping() -> {setServer(rows), apply(row), all()}
 *   setServer(rows)  the rows of the newest snapshot (snapshot.shopping; the backend leaves out the deleted ones)
 *   apply(row)       a row the backend answered (saved, ticked, deleted): it shows at once and stays laid over the snapshot's rows until a snapshot
 *                    has it (the same updated_at or newer; a deleted row: until a snapshot no longer lists it). With the mock backend no snapshot
 *                    ever has it, so it stays for the life of the page.
 *   all()            the visible items: the snapshot's rows with the applied ones laid over them, new ones at the end, deleted ones gone
 */
export function createShopping() {
  let server = [];
  const applied = new Map(); // id -> item
  return {
    setServer(rows) {
      server = visibleItems(rows);
      for (const [id, it] of [...applied]) {
        const seen = server.find((s) => s.id === id);
        if (isTrue(it.hidden) ? !seen : seen && seen.updated_at >= it.updated_at) applied.delete(id);
      }
    },
    apply(row) {
      const it = toItem(row);
      if (it) applied.set(it.id, it);
    },
    all() {
      const out = server.map((s) => applied.get(s.id) ?? s);
      for (const [id, it] of applied) if (!server.some((s) => s.id === id)) out.push(it);
      return out.filter((it) => !isTrue(it.hidden));
    },
  };
}
