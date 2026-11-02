// Tiny DOM helpers. Text always goes in through textContent / createTextNode, never innerHTML:
// every string on a card comes from a shared Google Sheet and must not be able to inject markup.
const SVG_NS = 'http://www.w3.org/2000/svg';

/** h('button', {class:'x', onclick: fn, 'aria-label': 'y'}, 'text', childNode, ...) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** An inline icon from the sprite in index.html: icon('i-flame'). Decorative: the label lives on the button. */
export function icon(id, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ico ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// The ginkgo leaf of docs/design/g2b/dir-g2b.html: a 32-unit box, the fan opening up; yellow with an ink outline (app.css .gl).
const LEAF_BLADE = 'M16 23C12.4 19.4 5.8 14.2 1.2 11.73C4.34 7.61 9.05 4.99 14.2 4.49L16 8L17.8 4.49C22.95 4.99 27.66 7.61 30.8 11.73C26.2 14.2 19.6 19.4 16 23Z';
const LEAF_STEM = 'M16 22.2C16.1 25.3 16.5 28.4 17.3 31.2';

/** The ginkgo leaf: leaf() or leaf('off') for the outline-only one (a star button that is not on). */
export function leaf(cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `gl ${cls}`.trim());
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [cls2, d] of [['gl-stem', LEAF_STEM], ['gl-blade', LEAF_BLADE]]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', cls2);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * The curved top edge of a drawer (the place card, the add form): cream fill with the edge drawn in ink, 44 px tall, as wide as the
 * drawer. The curve comes from docs/design/g2b/dir-g2b.html (the card sheet), squeezed to the drawer's width.
 */
export function sheetEdge() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sheet-edge');
  svg.setAttribute('viewBox', '0 0 390 44');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const curve = 'C52 36 92 8 172 6 C246 4 268 34 318 35 C352 36 374 30 390 26';
  for (const [cls, d] of [['edge-fill', `M0 40 ${curve} L390 44 L0 44 Z`], ['edge-line', `M-2 40 ${curve} L392 26`]]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The family colour pair of a category (colors.js) as CSS variables --fam / --on on an element: everything drawn from them follows. */
export function famStyle(el, cat) {
  el.style.setProperty('--fam', cat.color);
  el.style.setProperty('--on', cat.on);
  return el;
}

/** A round family-coloured mark with the category's icon: famDot(categoryOf(id)) or famDot(cat, 'fdot--sm'). */
export function famDot(cat, cls = '') {
  return famStyle(h('span', { class: `fdot ${cls}`.trim() }, icon(cat.icon)), cat);
}

export function clear(el) {
  el.replaceChildren();
  return el;
}
