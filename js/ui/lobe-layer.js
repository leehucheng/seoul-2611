// The yellow district lobes on the map: a pale ginkgo wash at street zoom and a stronger multiplied fill far out (css/app.css), a 4 px
// ginkgo coast, and the area's name: zoomed out (below 16) in big black letters with its place count (聖水 / 성수동 ・ 9 個地點), at street
// zoom (16 and up) as a small capsule for the district under the middle of the screen. They sit under the pins and their names and are
// never tapped. What to draw comes from js/area-lobes.js; this file only draws it, and only touches the map when a shape really changed
// (the places are handed in again every 45 s: a lobe that did not change is not redrawn, so nothing flickers).
//
//   const lobes = createLobeLayer(map, el)   // `el`: the map's container; it gets class `lobes-far` below zoom 16 (css/app.css picks the fill)
//   lobes.update(places, {translations})     // any time; places with no area / hidden / no coordinates are ignored there. `translations`: the
//                                            // snapshot's Korean -> Chinese map: an area written in Korean is named by its translation
import {
  LOBE_STYLE, areaKorean, areaLobes, areaTitle, layoutLobeNames, lobeAt, lobeFillAt, lobeNameWidth, showAreaCapsuleAt, showAreaNameAt,
} from '../area-lobes.js';
import { h } from './dom.js';

const MIN_NAME_PX = 90; // a lobe narrower than this on the screen is too small to carry its name

/** `onShapes(lobes)` (optional) is told every set of lobes ({polygon, ...}): the vector map draws the street-zoom wash itself from them (ui/basemap-layer.js). */
export function createLobeLayer(map, el, { onShapes } = {}) {
  // three panes: the fill (blended with the base map by css/app.css), the coast, the big name; all under the overlay pane's accuracy circle and the pins
  const pane = (name, z) => { const p = map.getPane(name) ?? map.createPane(name); p.style.zIndex = z; p.classList.add('lobe-pane'); return p; };
  pane('lobeFill', 380);
  pane('lobeEdge', 381);
  pane('lobeName', 382);
  // Leaflet draws vectors into an SVG one screen plus `padding` on each side big and re-fits it only when the map stops. A lobe fills the whole
  // screen at street zoom, so with the default 0.1 a finger drag of more than 10% of the screen shows the SVG's straight edge (a strip of
  // map with no yellow) until the finger lifts. One extra screen on each side keeps a drag and most of a fling covered.
  const fillRenderer = L.svg({ pane: 'lobeFill', padding: 1 });
  const edgeRenderer = L.svg({ pane: 'lobeEdge', padding: 1 });

  const shapes = new Map(); // area -> {sig, fill, edge, name, data}
  let lastShapes = '';

  function nameIcon(lobe) {
    return L.divIcon({
      className: 'area-big-icon',
      iconSize: [0, 0],
      // never the raw Sheet text: always readable as Chinese; the Korean name (when known) only beside it
      html: h('div', { class: 'area-big' }, h('b', {}, lobe.title),
        h('span', {}, lobe.kr ? [h('span', { lang: 'ko' }, lobe.kr), ' ・ '] : null, `${lobe.count} 個地點`)),
    });
  }

  // The small area capsule at street zoom: a Leaflet control in the map's top-left corner (below the chips), never tapped.
  const AreaCap = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      this._el = L.DomUtil.create('div', 'area-cap');
      this._el.hidden = true;
      return this._el;
    },
    show(lobe) {
      const key = lobe ? `${lobe.title}|${lobe.kr}` : '';
      if (key === this._key) return;
      this._key = key;
      this._el.hidden = !lobe;
      this._el.replaceChildren(...(lobe ? [h('b', {}, lobe.title), lobe.kr ? h('span', { lang: 'ko' }, lobe.kr) : null].filter(Boolean) : []));
    },
  });
  const areaCap = new AreaCap().addTo(map);

  function add(lobe, sig) {
    const base = { interactive: false, bubblingMouseEvents: true };
    const entry = {
      sig,
      data: lobe,
      fill: L.polygon(lobe.polygon, { ...base, renderer: fillRenderer, className: 'lobe-fill', stroke: false, fill: true, fillOpacity: 1 }).addTo(map),
      edge: L.polygon(lobe.polygon, { ...base, renderer: edgeRenderer, className: 'lobe-edge', fill: false, stroke: true, color: LOBE_STYLE.coast, weight: LOBE_STYLE.coastPx, opacity: 1, lineJoin: 'round' }).addTo(map),
      name: L.marker(lobe.label, { pane: 'lobeName', interactive: false, keyboard: false, icon: nameIcon(lobe) }).addTo(map),
    };
    shapes.set(lobe.area, entry);
  }

  function change(entry, lobe, sig) {
    entry.sig = sig;
    entry.data = lobe;
    entry.fill.setLatLngs(lobe.polygon);
    entry.edge.setLatLngs(lobe.polygon);
    entry.name.setLatLng(lobe.label);
    entry.name.setIcon(nameIcon(lobe));
  }

  function remove(entry) {
    for (const part of [entry.fill, entry.edge, entry.name]) map.removeLayer(part);
  }

  function update(places, { translations } = {}) {
    const next = areaLobes(places).map((lobe) => ({ ...lobe, title: areaTitle(lobe.area, translations), kr: areaKorean(lobe.area, translations) }));
    const shapesSig = JSON.stringify(next.map((l) => l.polygon));
    if (shapesSig !== lastShapes) { // only when a shape changed: the places come in again every 45 s
      lastShapes = shapesSig;
      try { onShapes?.(next); } catch { /* the Leaflet wash still shows */ }
    }
    const seen = new Set();
    for (const lobe of next) {
      seen.add(lobe.area);
      const sig = JSON.stringify([lobe.count, lobe.title, lobe.kr, lobe.polygon, lobe.label]);
      const entry = shapes.get(lobe.area);
      if (!entry) add(lobe, sig);
      else if (entry.sig !== sig) change(entry, lobe, sig);
    }
    for (const [area, entry] of shapes) {
      if (seen.has(area)) continue;
      remove(entry);
      shapes.delete(area);
    }
    layoutNames();
  }

  // ---- the big names: only far out, sized by how big the lobe is on the screen, the bigger area wins a collision ----------------------
  function layoutNames() {
    const zoom = map.getZoom();
    el.classList.toggle('lobes-far', lobeFillAt(zoom) === 'far');
    const show = showAreaNameAt(zoom);
    const items = [];
    for (const [area, entry] of shapes) {
      const node = entry.name.getElement()?.querySelector('.area-big');
      if (!node) continue;
      const box = L.latLngBounds(entry.data.polygon);
      const a = map.latLngToContainerPoint(box.getSouthWest());
      const b = map.latLngToContainerPoint(box.getNorthEast());
      const widthPx = Math.abs(b.x - a.x);
      const fs = Math.max(26, Math.min(64, widthPx * 0.2));
      node.style.setProperty('--fs', `${fs.toFixed(1)}px`);
      const label = map.latLngToContainerPoint(entry.data.label);
      const w = lobeNameWidth(entry.data.title, fs);
      // a lobe that is too small on the screen, or whose area has no Chinese name, carries no name
      items.push({ id: area, node, usable: show && widthPx >= MIN_NAME_PX && entry.data.title !== '', count: entry.data.count, x: label.x - w / 2, y: label.y - fs / 2, w, h: fs * 1.7 });
    }
    const keep = layoutLobeNames(items.filter((it) => it.usable)); // overlapping names: the area with more places keeps its name
    for (const it of items) it.node.classList.toggle('is-off', !keep.has(it.id));

    // street zoom: the district under the middle of the screen, as a small capsule (nothing when the middle is outside every district)
    const c = map.getCenter();
    const under = showAreaCapsuleAt(zoom) ? lobeAt([...shapes.values()].map((s) => s.data), [c.lat, c.lng]) : null;
    areaCap.show(under && under.title ? under : null);
  }

  map.on('zoomend moveend resize', layoutNames);
  layoutNames(); // the fill strength (class lobes-far) is right from the start, also for the picture fallback's filter

  return { update, count: () => shapes.size };
}
