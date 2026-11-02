// The line badges in front of a station's name on the vector map (app/map-style.json layer `station-label`): a row of small pills, one per
// line, in the line's colour with its number (or its name: 水仁盆唐, 機場鐵路 ...) in white, or in ink on a light colour (js/stations.js).
// The style asks for an image called `stn:2,7`; MapLibre says so with `styleimagemissing`, and this draws it on a canvas and hands it back.
//
//   badgeImage(lines, {doc, ratio}) -> ImageData (at `ratio` times its size in CSS px; the same 22 px tall for every station) or null
//   installStationBadges(gl, {doc, ratio}) -> off()   // gl: the MapLibre map; makes every `stn:` image the style asks for
import { badgeColors, linesOfBadgeId } from '../stations.js';

const H = 18; // the badge, in CSS px
const RING = 2; // the white ring around each badge: it stands out on the yellow district and on the white streets
const GAP = 3;
const FONT = '"Archivo", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

/** One image with a pill per line, side by side. null when there is no canvas (the label then shows without its badges). */
export function badgeImage(lines, { doc = globalThis.document, ratio = 2 } = {}) {
  let canvas;
  try { canvas = doc.createElement('canvas'); } catch { return null; }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  const text = (line) => (String(line).length > 1 ? 10 : 12); // a line's name in small type, a number a little bigger
  const widths = lines.map((line) => {
    ctx.font = `800 ${text(line) * ratio}px ${FONT}`;
    const w = ctx.measureText(String(line)).width / ratio;
    return Math.max(H, Math.ceil(w) + (String(line).length > 1 ? 10 : 0)); // a digit is a circle, a name a pill
  });
  const total = widths.reduce((s, w) => s + w + 2 * RING, 0) + GAP * (lines.length - 1);
  canvas.width = Math.ceil(total * ratio);
  canvas.height = (H + 2 * RING) * ratio;
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  let x = 0;
  lines.forEach((line, i) => {
    const w = widths[i];
    const { bg, fg } = badgeColors(line);
    const r = H / 2;
    const left = x + RING;
    const path = () => { g.beginPath(); g.moveTo(left + r, RING); g.arcTo(left + w, RING, left + w, RING + H, r); g.arcTo(left + w, RING + H, left, RING + H, r); g.arcTo(left, RING + H, left, RING, r); g.arcTo(left, RING, left + w, RING, r); g.closePath(); };
    path();
    g.lineWidth = RING * 2;
    g.strokeStyle = '#FFFFFF';
    g.lineJoin = 'round';
    g.stroke();
    path();
    g.fillStyle = bg;
    g.fill();
    g.fillStyle = fg;
    g.font = `800 ${text(line)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(line), left + w / 2, RING + H / 2 + 0.5);
    x += w + 2 * RING + GAP;
  });
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/** Answer MapLibre's `styleimagemissing` for the `stn:` images; any other image name is left alone. Never throws. */
export function installStationBadges(gl, { doc = globalThis.document, ratio = 2 } = {}) {
  const made = new Set();
  const onMissing = (e) => {
    try {
      const lines = linesOfBadgeId(e?.id);
      if (!lines || made.has(e.id)) return;
      const img = badgeImage(lines, { doc, ratio });
      if (!img) return;
      gl.addImage(e.id, img, { pixelRatio: ratio });
      made.add(e.id);
    } catch { /* the label shows without its badges */ }
  };
  gl.on('styleimagemissing', onMissing);
  return () => gl.off('styleimagemissing', onMissing);
}
