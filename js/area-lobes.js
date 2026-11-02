// The yellow district lobes (商圈色塊): under the pins of every area that has enough places, one rounded ginkgo-yellow shape, so a
// district reads at a glance when the map is zoomed out. Pure geometry (no DOM, no Leaflet); ui/map.js draws what this returns.
//
//   areaLobes(places, {minPlaces: 3, maxRadiusM: 1200, padM: 320}) -> [{area, count, polygon: [[lat, lng], ...], label: [lat, lng]}]
//
// Places with no coordinates, hidden places and places with no area are left out; "Seoul" (the hotel's whole-city area) is not a
// neighbourhood. The shape is the convex hull of a circle (padM) around every place, pulled in to maxRadiusM from the middle of the
// places, then rounded with two rounds of corner cutting. The label point (where the big area name goes) is in the lower part of the lobe,
// below the pins. Biggest area first, so the order never depends on the order of the places.
import { hasHangul, zhOf } from './i18n.js';
import { PRIORITY, pickVisibleLabels } from './pin-labels.js';
import { hasCoords, isHidden, toCoord } from './place-view.js';

export const LOBE_DEFAULTS = Object.freeze({ minPlaces: 3, maxRadiusM: 1200, padM: 320 });
/** The 4 px ginkgo coast around a lobe (the fills are CSS: --ginkgo-pale from zoom 16, --lobe-far below it). */
export const LOBE_STYLE = Object.freeze({ coast: '#F3C10A', coastPx: 4 });
const NOT_AREAS = new Set(['', 'Seoul']);
const M_PER_DEG = 111_320;
const CIRCLE_POINTS = 16; // corners of the circle drawn around each place
const SMOOTH_ROUNDS = 2;
const LABEL_DEPTH = 0.78; // how far down the lobe (share of the way from the middle to its southern edge) the area name sits

/** Which fill the lobes have at this zoom: 'far' (stronger yellow: no streets to read yet) below 16, 'near' (pale: streets stay readable) from 16. */
export const lobeFillAt = (zoom) => (Number.isFinite(zoom) && zoom < 16 ? 'far' : 'near');

/**
 * The big area name (with its place count) is shown while the map is zoomed out: zoom 15 and below, and the half level 15.5 between it and
 * 16 (the whole far view, where the stronger yellow is too; no gap where neither name shows). From 16 up a small area capsule takes over.
 */
export const showAreaNameAt = (zoom) => Number.isFinite(zoom) && zoom < 16;

/** The small area capsule shows at street zoom (16 and up), for the district under the middle of the screen. */
export const showAreaCapsuleAt = (zoom) => Number.isFinite(zoom) && zoom >= 16;

// ---- the big area name -----------------------------------------------------------------------------------------------------

/** The Sheet's English area names, in Traditional Chinese (keys lower case). Every name the readers see is readable as Chinese. */
export const AREA_ZH = Object.freeze({ itaewon: '梨泰院', 'jongno 3 ga': '鐘路3街', seoul: '首爾', jeonju: '全州', gwangju: '光州' });

const word = (w, translations) => {
  const t = w.trim();
  if (t === '') return '';
  const known = AREA_ZH[t.toLowerCase()];
  if (known) return known;
  return hasHangul(t) ? (zhOf(t, translations) ?? '') : t; // Korean only through its stored translation, else not at all
};

/**
 * The name written on a lobe: the Chinese name of an English area (AREA_ZH), the stored Chinese translation of a Korean one (the
 * snapshot's `translations`, as on the card), Chinese as it is. A part that is Korean with no translation is left out ('東大門/청구' ->
 * '東大門'); nothing readable left -> ''. Parts are joined by the separators the Sheet used (/, &).
 */
export function areaTitle(area, translations) {
  const parts = String(area ?? '').trim().split(/(\s*[/＆&]\s*)/); // words at even places, the separators between them at odd ones
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const w = word(parts[i], translations);
    if (w) out += (out ? parts[i - 1].trim() : '') + w;
  }
  return out;
}

/**
 * The Korean names of the neighbourhoods the Sheet writes in Chinese (keys: the Chinese name as areaTitle() gives it). Shown small beside the
 * Chinese name on the district's big name and its capsule, and only ever together with it. A name that is not here shows no Korean.
 */
export const AREA_KR = Object.freeze({
  聖水: '성수동', 弘大: '홍대', 狎鷗亭: '압구정',漢南洞: '한남동', 安國: '안국동', 梨泰院: '이태원', '鐘路3街': '종로3가', 明洞: '명동',
  江南: '강남', 東大門: '동대문', 仁寺洞: '인사동', 三清洞: '삼청동', 北村: '북촌', 益善洞: '익선동', 延南洞: '연남동', 望遠洞: '망원동',
  龍山: '용산', 光化門: '광화문', 蠶室: '잠실', 新村: '신촌', 建大: '건대', 首爾林: '서울숲',
});

/**
 * The Korean name shown next to an area's Chinese name: the area itself when the Sheet wrote it in Korean (it has its Chinese
 * translation, or areaTitle() would show nothing), a Korean name from AREA_KR for a Chinese one. '' when there is none for every part
 * of the name, or when the Chinese name is not shown at all: Korean never stands without its Chinese.
 */
export function areaKorean(area, translations) {
  if (areaTitle(area, translations) === '') return '';
  const parts = String(area ?? '').trim().split(/(\s*[/＆&]\s*)/);
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i].trim();
    if (t === '') continue;
    const zh = word(t, translations);
    const kr = hasHangul(t) ? t : AREA_KR[zh] ?? '';
    if (kr === '') return '';
    out += (out ? parts[i - 1].trim() : '') + kr;
  }
  return out;
}

/** The lobe (of areaLobes(): {polygon: [[lat, lng]...]}) a point [lat, lng] lies in, the one with the most places when several do; null when none. */
export function lobeAt(lobes, [lat, lng]) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const inside = (ring) => {
    let on = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) on = !on;
    }
    return on;
  };
  let best = null;
  for (const lobe of lobes ?? []) {
    if (Array.isArray(lobe?.polygon) && inside(lobe.polygon) && (best === null || (lobe.count ?? 0) > (best.count ?? 0))) best = lobe;
  }
  return best;
}

const WIDE = /[ᄀ-ᇿ⺀-鿿가-힯＀-￯]/;
/** The width of `text` at font size `fs`: a Chinese character is as wide as the font size, a Latin letter about 0.62 of it. */
export const lobeNameWidth = (text, fs) => [...String(text ?? '')].reduce((s, ch) => s + (WIDE.test(ch) ? fs : fs * 0.62), 0);

/**
 * Which big names stay when they would overlap: the one of the area with more places wins, ties by id. `items`: [{id, count, x, y, w, h}]
 * (screen px, the name's box). Priorities are a rank between 0 and 2.5, below PRIORITY.selected on purpose: pickLabelLayout keeps an
 * item at that priority or above even when it overlaps (it is for the selected pin), and a lobe name has no right to that. -> Set of ids.
 */
export function layoutLobeNames(items, { gap = 6 } = {}) {
  const list = (items ?? []).filter(Boolean);
  const ranked = [...list].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const top = PRIORITY.selected - 0.5;
  const priority = new Map(ranked.map((it, i) => [it, (top * (ranked.length - i)) / ranked.length]));
  return pickVisibleLabels(list.map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, priority: priority.get(it) })), { gap });
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated first point, no collinear points. */
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const pt of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
      out.push(pt);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Corner cutting (Chaikin) on a closed ring: every corner is replaced by two points a quarter of the way along its edges. */
function round(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}

/** The lowest crossing of the vertical line x = 0 with a closed ring, or null. */
function southCrossing(ring) {
  let low = null;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if ((x1 > 0) === (x2 > 0)) continue;
    const y = y1 + ((0 - x1) / (x2 - x1)) * (y2 - y1);
    if (low === null || y < low) low = y;
  }
  return low;
}

function lobeOf(coords, { maxRadiusM, padM }) {
  const pts = [...coords].sort((a, b) => a[0] - b[0] || a[1] - b[1]); // the sum below does not depend on the input order
  const lat0 = pts.reduce((s, c) => s + c[0], 0) / pts.length;
  const lng0 = pts.reduce((s, c) => s + c[1], 0) / pts.length;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map(([lat, lng]) => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG]); // metres east / north of the middle

  const cloud = [];
  for (const [x, y] of xy) {
    for (let k = 0; k < CIRCLE_POINTS; k += 1) {
      const a = (2 * Math.PI * k) / CIRCLE_POINTS;
      cloud.push([x + padM * Math.cos(a), y + padM * Math.sin(a)]);
    }
  }
  let ring = convexHull(cloud).map(([x, y]) => {
    const r = Math.hypot(x, y);
    return r > maxRadiusM ? [(x * maxRadiusM) / r, (y * maxRadiusM) / r] : [x, y]; // never reaches past maxRadiusM from the middle
  });
  for (let i = 0; i < SMOOTH_ROUNDS; i += 1) ring = round(ring); // averages of points inside the circle stay inside it

  const south = southCrossing(ring);
  const labelY = south === null ? 0 : south * LABEL_DEPTH;
  const toLatLng = ([x, y]) => [lat0 + y / M_PER_DEG, lng0 + x / kx];
  return { polygon: ring.map(toLatLng), label: toLatLng([0, labelY]) };
}

export function areaLobes(places, options = {}) {
  const { minPlaces, maxRadiusM, padM } = { ...LOBE_DEFAULTS, ...options };
  const groups = new Map();
  for (const place of Array.isArray(places) ? places : []) {
    if (!place || isHidden(place) || !hasCoords(place)) continue;
    const area = String(place.area ?? '').trim();
    if (NOT_AREAS.has(area)) continue;
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push([toCoord(place.lat), toCoord(place.lng)]);
  }
  const lobes = [];
  for (const [area, coords] of groups) {
    if (coords.length >= minPlaces) lobes.push({ area, count: coords.length, ...lobeOf(coords, { maxRadiusM, padM }) });
  }
  return lobes.sort((a, b) => b.count - a.count || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
}
