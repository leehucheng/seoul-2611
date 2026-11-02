// Zoom-aware pin labels (pure, no DOM, so Node tests run it). A pin is always a round coloured dot. From zoom 16 up it also
// gets a white capsule with the place's name; when capsules would overlap, the ones with the lower priority are hidden
// (the dot always stays). map.js measures the capsules, calls pickVisibleLabels() after the map has stopped moving and
// toggles one class per capsule.
import { zhOf } from './i18n.js';

/** Names show from this zoom (the map snaps to half zoom levels) and up; below it only dots. */
export const LABEL_MIN_ZOOM = 16;
export const labelsShownAt = (zoom) => Number.isFinite(zoom) && zoom >= LABEL_MIN_ZOOM;

/** The longest name, in CJK-character units (a Latin letter counts LATIN_UNIT), before it is cut with an ellipsis. */
export const LABEL_MAX_UNITS = 10;
const LATIN_UNIT = 0.6;
const WIDE = /[ᄀ-ᇿ⺀-〿぀-鿿가-힯豈-﫿＀-￯\u{1f000}-\u{1ffff}]/u;
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The name a pin goes by, uncut. Every Korean string shown has Traditional Chinese with it (spec section 12), so: the Chinese name,
 * else the Chinese translation of the Korean name (`translations` is the snapshot's Korean -> Chinese map, as on the card), else the
 * English name, else the Korean name itself (nothing better is known yet), else a generic word.
 */
export function placeName(place, translations) {
  const raw = String(place?.name_kr ?? '');
  const kr = clean(raw);
  const zh = zhOf(raw, translations) || zhOf(kr, translations); // the key as the Sheet wrote it first (as the card looks it up), then with blanks collapsed
  return clean(place?.name_zh) || (zh ? clean(zh) : '') || clean(place?.name_en) || kr || '店家';
}

/** Label text of a place: placeName(), cut to `maxUnits` + 「…」. */
export function labelText(place, maxUnits = LABEL_MAX_UNITS, translations) {
  const name = placeName(place, translations);
  let used = 0;
  let out = '';
  const chars = Array.from(name); // by code point: an emoji or a rare Han character is one unit, never half
  for (let i = 0; i < chars.length; i += 1) {
    const unit = WIDE.test(chars[i]) ? 1 : LATIN_UNIT;
    if (used + unit > maxUnits + 1e-9) return `${out.trimEnd()}…`;
    used += unit;
    out += chars[i];
  }
  return out;
}

/** Who wins a crowded spot: the selected place, then a starred one, then one the person wants to go to, then the rest. */
export const PRIORITY = Object.freeze({ selected: 3, starred: 2, mine: 1, other: 0 });
export function labelPriority({ selected = false, starred = false, mine = false } = {}) {
  if (selected) return PRIORITY.selected;
  if (starred) return PRIORITY.starred;
  if (mine) return PRIORITY.mine;
  return PRIORITY.other;
}

/** The drawn dot is this many px wide and tall; the capsule is as tall and starts at the dot's left edge. */
export const DOT_SIZE = 32;
export const dotRect = (x, y) => ({ x: x - DOT_SIZE / 2, y: y - DOT_SIZE / 2, w: DOT_SIZE, h: DOT_SIZE });
/** The capsule of a pin at screen point (x, y); `width` is its measured width (dot included). */
export const labelRect = (x, y, width) => ({ x: x - DOT_SIZE / 2, y: y - DOT_SIZE / 2, w: Math.max(DOT_SIZE, width), h: DOT_SIZE });

const usable = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Which capsules stay. items: [{id, x, y, w, h, priority}] (screen px; a higher priority wins). -> Set of the ids to show.
 * Greedy in priority order (ties: the one listed first): a capsule is kept unless it overlaps, or is closer than `gap` px to,
 * one that is already kept, or covers another pin's dot (`dots`: [{id, x, y, w, h}]; its own dot is fine). A capsule with the
 * selected priority is always kept. Items without a usable rectangle never show. The input is not changed.
 */
export function pickVisibleLabels(items, { gap = 4, dots = [] } = {}) {
  const order = [];
  (items ?? []).forEach((it, i) => { if (it && usable(it)) order.push([it, i]); });
  order.sort((a, b) => (Number(b[0].priority) || 0) - (Number(a[0].priority) || 0) || a[1] - b[1]);
  const obstacles = (dots ?? []).filter(usable);

  const keep = new Set();
  const kept = [];
  for (const [it] of order) {
    const always = (Number(it.priority) || 0) >= PRIORITY.selected;
    const blocked = !always && (kept.some((k) => overlaps(it, k, gap)) || obstacles.some((d) => d.id !== it.id && overlaps(it, d, 0)));
    if (blocked) continue;
    keep.add(it.id);
    kept.push(it);
  }
  return keep;
}
