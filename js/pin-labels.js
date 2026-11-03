// Zoom-aware pin labels (pure, no DOM, so Node tests run it). A pin is always a round family-coloured dot (a small plain dot below
// zoom 16, the full pin with its icon from 16 up). From zoom 16 up it also gets a white capsule: the name in Chinese, bold, with the
// Korean name small under it. A name is never cut here (css/app.css lets a capsule run up to ~60% of the map's width, and only a name
// longer than that gets an ellipsis), and the Korean line is never dropped under a first line that has Han characters. When capsules
// would overlap, the ones with the lower priority are hidden entirely (the dot always stays). map.js measures the capsules, calls
// pickLabelLayout() after the map has stopped moving and sets one side per capsule.
import { hasHan, hasHangul, zhOf } from './i18n.js';

/** Names show from this zoom (the map snaps to half zoom levels) and up; below it only dots. */
export const LABEL_MIN_ZOOM = 16;
export const labelsShownAt = (zoom) => Number.isFinite(zoom) && zoom >= LABEL_MIN_ZOOM;

/** A capsule may run this share of the map's width (css/app.css --cap-max, set by ui/map.js); a longer name is cut with an ellipsis there. */
export const CAP_MAX_SHARE = 0.6;
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

/**
 * The two lines of a capsule, uncut: `zh` is placeName() (Chinese, else its translation, else English, else the Korean itself) and `kr`
 * the Korean name small under it. `kr` is '' when there is no Korean name, when it is already the first line (nothing is shown twice), and
 * when the first line has no Han (Chinese) character: Korean never stands next to a name the readers cannot read as Chinese. Whenever the
 * first line has a Han character the Korean line is there, whatever the room: crowding hides a whole capsule, it never trims one.
 */
export function labelLines(place, translations) {
  const name = placeName(place, translations);
  const kr = clean(place?.name_kr);
  return { zh: name, kr: kr && kr !== name && hasHangul(kr) && hasHan(name) ? kr : '' };
}

/**
 * Who wins a crowded spot: the selected place, then today's next stop (the one in the 下一站 strip: where the person is headed, so its
 * name matters most after the open card's), then a starred one, then one the person wants to go to, then the rest. `next` is below
 * `selected` on purpose: only the selected pin is kept when its capsule would overlap (pickLabelLayout). A pin of the 7 月 layer comes
 * after all of them (below `other`, whatever else it is: starred included), so its name never takes the room of one of our places'; only
 * while it is the selected one (its card is open) is its name always kept.
 */
export const PRIORITY = Object.freeze({ selected: 3, next: 2.5, starred: 2, mine: 1, other: 0, july: -1 });
export function labelPriority({ selected = false, next = false, starred = false, mine = false, july = false } = {}) {
  if (selected) return PRIORITY.selected;
  if (july) return PRIORITY.july;
  if (next) return PRIORITY.next;
  if (starred) return PRIORITY.starred;
  if (mine) return PRIORITY.mine;
  return PRIORITY.other;
}

// ---- the marks of a pin: my wish-list, 推薦, star, 銀杏 leaf (spec 5.2) -------------------------------------------------------------

const inSet = (set, id) => (set instanceof Set ? set.has(id) : Array.isArray(set) ? set.includes(id) : false);

/**
 * What a pin shows besides its family colour: `wanted` (my initial is among the Sheet's who-wants-to-go initials, `a|b|c`; drawn as a
 * 3 px ginkgo-yellow ring and raises the label's priority), `recommended` (the 推薦 source; drawn as a dashed ink ring), `starred` (the
 * ginkgo leaf at the end of the name) and `ginkgo` (the small leaf on the pin, the 銀杏 tab). `july` (a place of the 7 月 layer, the `july`
 * source: drawn muted, under the others). `mine` is my initial ('' = nobody picked); `starred` / `ginkgo` are Sets (or arrays) of place ids.
 */
export function pinFlags(place, { mine = '', starred, ginkgo } = {}) {
  const id = place?.id;
  return {
    wanted: Boolean(mine) && String(place?.who ?? '').split('|').map((s) => s.trim()).includes(mine),
    recommended: String(place?.source ?? '').trim() === 'recommend',
    starred: inSet(starred, id),
    ginkgo: inSet(ginkgo, id),
    july: String(place?.source ?? '').trim() === 'july',
  };
}

/**
 * The class list of a pin's box for its flags (css/app.css draws `want` and `rec` as rings around the dot, `star` / `ginkgo` as the leaves,
 * `july` as the muted pin of the 7 月 layer).
 */
export const pinClass = ({ wanted, recommended, starred, ginkgo, july } = {}) => ['pin-stack', starred && 'star', ginkgo && 'ginkgo', wanted && 'want', recommended && 'rec', july && 'july'].filter(Boolean).join(' ');

/** The drawn dot (30 px, its 2 px white ring and thin ink ring included) is this many px wide and tall; the capsule starts behind it. */
export const DOT_SIZE = 36;
/** The capsule's near end sits this many px beyond the dot's centre (it runs under the dot). */
export const CAP_GAP = 4;
/**
 * How far the rings of a pin reach past the plain pin's own (white ring and thin ink ring), each side, in px: the ginkgo ring of a wanted
 * pin 3, the dashed ring of a recommended one 4.5, both 7.5 (css/app.css --ring has the same numbers).
 */
export const ringFor = ({ wanted = false, recommended = false } = {}) => (wanted ? 3 : 0) + (recommended ? 4.5 : 0);
/** The size of a pin's dot with its rings (2 px of room on top of them): DOT_SIZE for a plain pin. A capsule is never laid over a ring. */
export const dotSizeFor = (flags) => { const ring = ringFor(flags); return DOT_SIZE + 2 * ring + (ring > 0 ? 2 : 0); };
export const dotRect = (x, y, size = DOT_SIZE) => ({ x: x - size / 2, y: y - size / 2, w: size, h: size });
/**
 * The rectangle of a pin at screen point (x, y) together with its capsule: `width` is the whole span, dot included, running to the
 * right (side 'r', the default) or to the left ('l') of the dot. `height` defaults to the dot's.
 */
export function labelRect(x, y, width, { height = DOT_SIZE, side = 'r' } = {}) {
  const w = Math.max(DOT_SIZE, width);
  return { x: side === 'l' ? x + DOT_SIZE / 2 - w : x - DOT_SIZE / 2, y: y - height / 2, w, h: height };
}
/** A capsule sitting under or over the dot (side 'b' / 't') starts this many px from the dot's centre. */
export const CAP_VGAP = 12;
/**
 * The rectangle a measured capsule (`capWidth` x `capHeight` px) of a pin at (x, y) takes, with the dot where it runs under it.
 * side 'r' / 'l': beside the dot, starting CAP_GAP px past its centre, never shorter than the dot, moved down by `dy` px (negative: up);
 * side 'b' / 't': centred under / over the dot, CAP_VGAP px from its centre (the dot is not part of the rectangle), `ring` px further for a
 * pin with a ginkgo or dashed ring (css/app.css --ring).
 */
export function capsuleRect(x, y, capWidth, capHeight, side = 'r', dy = 0, ring = 0) {
  if (side === 'b' || side === 't') {
    const gap = CAP_VGAP + ring;
    return { x: x - capWidth / 2, y: side === 'b' ? y + gap : y - gap - capHeight, w: capWidth, h: capHeight };
  }
  const r = labelRect(x, y, DOT_SIZE / 2 + CAP_GAP + capWidth, { height: Math.max(DOT_SIZE, capHeight), side });
  return dy ? { ...r, y: r.y + dy } : r;
}

const usable = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Where each capsule goes. items: [{id, priority, options: [{x, y, w, h}, ...]}] (screen px; a higher priority wins; an item with
 * no `options` is its own single option: {id, x, y, w, h, priority}). `options` are alternatives in order of preference (the capsule
 * to the right of its dot, then shifted up or down, then to the left, then under and over the dot). -> Map id -> index of the chosen
 * option; an id that is not in the Map shows no capsule.
 * Greedy in priority order (ties: the one listed first): an item takes its first option that does not overlap, or come closer
 * than `gap` px to, an option already chosen, and does not cover another pin's dot (`dots`: [{id, x, y, w, h}]; its own dot is
 * fine). An item with the selected priority is always kept: a free option if there is one, else its first. Options without a usable
 * rectangle are skipped. The input is not changed.
 * A dot with `under: true` is the dot of a pin drawn under the others (a 7 月 pin): only an item of a priority below PRIORITY.other (another
 * 7 月 pin) keeps clear of it; a capsule of one of our pins may lie over it, since it is drawn above it.
 */
export function pickLabelLayout(items, { gap = 4, dots = [] } = {}) {
  const order = [];
  (items ?? []).forEach((it, i) => {
    if (!it) return;
    const options = Array.isArray(it.options) ? it.options : [it];
    if (options.some(usable)) order.push([it, options, i]);
  });
  order.sort((a, b) => (Number(b[0].priority) || 0) - (Number(a[0].priority) || 0) || a[2] - b[2]);
  const obstacles = (dots ?? []).filter(usable);

  const chosen = new Map();
  const kept = [];
  for (const [it, options] of order) {
    const low = (Number(it.priority) || 0) < PRIORITY.other;
    const free = (r) => usable(r) && !kept.some((k) => overlaps(r, k, gap)) && !obstacles.some((d) => d.id !== it.id && (low || !d.under) && overlaps(r, d, 0));
    const always = (Number(it.priority) || 0) >= PRIORITY.selected;
    let pick = options.findIndex(free);
    if (pick < 0 && always) pick = options.findIndex(usable);
    if (pick < 0) continue;
    chosen.set(it.id, pick);
    kept.push(options[pick]);
  }
  return chosen;
}

/** The ids of the capsules that stay (pickLabelLayout() without the choice of option). A Set. */
export const pickVisibleLabels = (items, opts) => new Set(pickLabelLayout(items, opts).keys());
