// 行李清單: the November packing checklist (content: packing.js; what is ticked: packing-ticks.js, on this phone only).
//
// initPacking(app) -> app.packing = {total, saved, has(id), count(), toggle(id), reset()}; every change emits app.emit('packing').
// packingCard(app, onOpen) -> {element, sync(date), paint()}: the card on the 今天 page, 「行李清單 N/46」 with a short line under it. It
//     belongs on the first and the last trip day only: sync(date) puts that day's line on it and says whether it shows that day (the
//     caller adds it to the page then). paint() redraws the count (the caller calls it on app.on('packing')). A tap calls onOpen(button).
// openPacking(app, {behind, trigger, onClose}) -> {element, close}: the screen, an overlay of its own as the phrase card is (phrase-cards.js):
//     the 今天 page stays open under it and `behind` (the page, the tab bar) goes inert. It holds one back-stack entry: Back (the phone's),
//     Esc and the × close it and show the 今天 page again, with focus back on `trigger`. It is built once and then patched in place.
//     Order: title, lead, the total with its bar and 「全部重設」, the tag key, the weather strip, the 8 groups, the facts, the rules, the footer.
// Links open in a new tab. Text only goes in through dom.js (textContent); nothing here uses the network.
import { holdBack } from '../back-stack.js';
import {
  PACKING_CITIES, PACKING_FACTS, PACKING_FOOTER, PACKING_GROUPS, PACKING_LEAD, PACKING_RULES, PACKING_TAGS, PACKING_TITLE, PACKING_WEATHER, packingCardLine,
} from '../packing.js';
import { createPacking } from '../packing-ticks.js';
import { h, icon } from './dom.js';

export function initPacking(app) {
  app.packing = createPacking({ storage: app.storage, onChange: () => app.emit('packing') });
}

// ---- the card on the 今天 page --------------------------------------------------------------------------------------

export function packingCard(app, onOpen) {
  const count = h('b', { class: 'num' });
  const line = h('span', { class: 'pk-card-line' });
  const btn = h('button', { class: 'pk-card', type: 'button' },
    h('span', { class: 'chip-ink' }, icon('i-luggage')),
    h('span', { class: 'pk-card-main' }, h('span', { class: 'pk-card-title' }, '行李清單 ', count), line),
    icon('i-chevron-right'));
  btn.addEventListener('click', () => onOpen(btn));
  const paint = () => { count.textContent = `${app.packing.count()}/${app.packing.total}`; };
  return {
    element: btn,
    sync(date) {
      const text = packingCardLine(date);
      if (text !== null) line.textContent = text;
      paint();
      return text !== null;
    },
    paint,
  };
}

// ---- the screen -----------------------------------------------------------------------------------------------------

/** A text made of parts (packing.js): a plain string, {b} bold, {a, href} a link that opens in a new tab. */
const rich = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.a ? link(p.a, p.href) : h('b', null, p.b)));
const link = (text, href) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const tag = (id) => h('span', { class: `pk-tag pk-tag--${id}` }, PACKING_TAGS[id].label);
/** A sheet of paper with tape on its top corners (the look of the 今天 board and the hotel card). */
const sheet = (cls, ...kids) => h('div', { class: `pk-paper ${cls}`.trim() }, h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }), ...kids);
const section = (id, title, ...kids) => h('section', { class: 'pk-sec', 'aria-labelledby': id }, h('h2', { class: 'pk-h2', id }, title), ...kids);

function dayChip(d) {
  const cls = ['pk-day', d.cold && 'pk-day--cold', d.avg && 'pk-day--avg', d.range && 'pk-day--rng'].filter(Boolean).join(' ');
  return h('li', { class: cls },
    h('div', { class: 'pk-dd' }, h('b', null, d.md), h('span', null, d.weekday)),
    h('div', { class: 'pk-hl' }, h('i', null, d.avg ? '約高' : '高'), h('b', null, d.hi)),
    h('div', { class: 'pk-hl pk-hl--lo' }, h('i', null, d.avg ? '約低' : '低'), h('b', null, d.lo)),
    h('div', { class: 'pk-cue' }, d.cue),
    h('div', { class: 'pk-src' }, d.src));
}

export function openPacking(app, { behind = [], trigger = null, onClose } = {}) {
  const model = app.packing;
  const boxes = []; // {id, input, row}
  const counts = []; // {group, el}

  const totalN = h('b', { class: 'pk-total-n' }, '0');
  const totalMsg = h('div', { class: 'pk-left' });
  const fill = h('span', { class: 'pk-fill' });
  const bar = h('div', { class: 'pk-bar', role: 'progressbar', 'aria-label': '備齊進度', 'aria-valuemin': '0', 'aria-valuemax': String(model.total), 'aria-valuenow': '0' }, fill);
  const note = h('p', { class: 'pk-note' }, '這個環境存不了勾選，重新整理會清空。');
  note.hidden = true;

  const resetOpen = h('button', { class: 'pk-btn', type: 'button' }, '全部重設');
  const resetYes = h('button', { class: 'pk-btn pk-btn--primary', type: 'button' }, '確定重設');
  const resetNo = h('button', { class: 'pk-btn', type: 'button' }, '取消');
  const askRow = h('div', { class: 'pk-confirm', role: 'group', 'aria-label': '確認重設' }, // the question is asked here, in the page, not in a browser dialog
    h('p', null, '確定清除全部勾選？清除後無法復原。'),
    h('div', { class: 'pk-crow' }, resetYes, resetNo));
  askRow.hidden = true;

  /** Show the model: every item, every group's count, the total, the bar. */
  function paint() {
    for (const b of boxes) {
      const on = model.has(b.id);
      b.input.checked = on;
      b.row.className = on ? 'pk-item is-done' : 'pk-item';
    }
    for (const c of counts) {
      const n = c.group.items.filter((i) => model.has(i.id)).length;
      c.el.textContent = `${n}/${c.group.items.length}`;
      c.el.className = n === c.group.items.length ? 'pk-gcount is-full' : 'pk-gcount';
    }
    const n = model.count();
    totalN.textContent = String(n);
    totalMsg.textContent = n === model.total ? '全部備齊' : `還差 ${model.total - n} 件`;
    bar.setAttribute('aria-valuenow', String(n));
    fill.style.setProperty('--p', String(n / model.total));
    note.hidden = model.saved;
  }

  function itemRow(it) {
    const input = h('input', { class: 'pk-ck', type: 'checkbox', id: it.id });
    const row = h('label', { class: 'pk-item' }, input,
      h('span', { class: 'pk-txt' },
        h('span', { class: 'pk-nm' }, it.name, it.tag ? tag(it.tag) : null),
        h('span', { class: 'pk-why' }, it.why)));
    input.addEventListener('change', () => {
      if (input.checked !== model.has(it.id)) model.toggle(it.id);
      paint();
    });
    boxes.push({ id: it.id, input, row });
    return row;
  }

  function groupSection(g) {
    const el = h('span', { class: 'pk-gcount' });
    counts.push({ group: g, el });
    return h('section', { class: 'pk-grp', 'data-group': g.id, 'aria-labelledby': g.id },
      h('div', { class: 'pk-gh' }, h('div', null, h('h2', { class: 'pk-h2 pk-h2--group', id: g.id }, g.title), h('p', { class: 'pk-hint' }, g.hint)), el),
      sheet('pk-items', g.items.map(itemRow)));
  }

  const el = h('div', { class: 'pk', role: 'dialog', 'aria-modal': 'true', 'aria-label': '行李清單', tabindex: '-1' });
  let closed = false;
  let release = () => {};
  const behindEls = behind.filter(Boolean);
  const screen = {
    element: el,
    close() {
      if (closed) return;
      closed = true;
      release();
      el.removeEventListener('keydown', onKey);
      for (const b of behindEls) b.inert = false;
      el.remove();
      try { onClose?.(); } catch (e) { console.error(e); }
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
    },
  };
  function closeConfirm() { askRow.hidden = true; resetOpen.focus(); }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!askRow.hidden) closeConfirm(); else screen.close(); // Esc first puts the question away, then the screen
  }

  resetOpen.addEventListener('click', () => { askRow.hidden = false; resetYes.focus(); });
  resetNo.addEventListener('click', closeConfirm);
  resetYes.addEventListener('click', () => { model.reset(); paint(); closeConfirm(); });

  const { m, r } = PACKING_TAGS;
  el.append(
    h('header', { class: 'pk-head' },
      h('h1', { class: 'pk-title' }, PACKING_TITLE),
      h('button', { class: 'icon-btn pk-close', type: 'button', 'aria-label': '關閉', onclick: () => screen.close() }, icon('i-close'))),
    h('div', { class: 'pk-scroll' },
      h('p', { class: 'pk-lead' }, PACKING_LEAD),

      sheet('pk-prog',
        h('div', { class: 'pk-progrow' },
          h('div', { class: 'pk-total', 'aria-live': 'polite' }, totalN, h('span', { class: 'pk-total-of' }, `/${model.total}`)),
          totalMsg, resetOpen),
        bar, askRow, note,
        h('p', { class: 'pk-key' },
          h('span', { class: 'pk-key-row' }, tag('m'), m.note),
          h('span', { class: 'pk-key-row' }, tag('r'), r.note))),

      section('pk-wx-h', PACKING_WEATHER.title,
        h('ol', { class: 'pk-days' }, PACKING_WEATHER.days.map(dayChip)),
        h('p', { class: 'pk-small pk-legend' }, rich(PACKING_WEATHER.legend)),
        PACKING_WEATHER.notes.map((n) => h('p', { class: 'pk-small pk-wxnote' }, rich(n))),
        sheet('pk-side',
          h('h3', { class: 'pk-h3' }, PACKING_CITIES.title),
          PACKING_CITIES.lines.map((l) => h('p', null, h('b', null, l.name), '　', l.text)),
          h('p', { class: 'pk-small' }, PACKING_CITIES.note))),

      h('div', { class: 'pk-groups' }, PACKING_GROUPS.map(groupSection)),

      section('pk-why-h', PACKING_FACTS.title,
        sheet('pk-facts-box',
          h('ul', { class: 'pk-facts' }, PACKING_FACTS.items.map((f) => h('li', null, h('b', null, f.head), rich(f.body)))))),

      section('pk-rule-h', PACKING_RULES.title,
        sheet('pk-rules-box',
          h('div', { class: 'pk-rules' }, PACKING_RULES.items.map((rule) => h('div', { class: 'pk-rule' },
            h('div', { class: 'pk-rh' }, h('b', null, rule.title), h('span', { class: `pk-st pk-st--${rule.state}` }, rule.status)),
            rule.paras.map((p) => h('p', null, rich(p))),
            rule.links.length > 0 ? h('div', { class: 'pk-links' }, rule.links.map((l) => link(l.text, l.href))) : null))))),

      h('footer', { class: 'pk-foot' },
        h('p', { class: 'pk-small' }, h('b', null, PACKING_FOOTER[0])),
        h('p', { class: 'pk-small' }, PACKING_FOOTER[1]))));
  el.addEventListener('keydown', onKey);
  paint();
  for (const b of behindEls) b.inert = true;
  document.body.append(el);
  el.focus({ preventScroll: true });
  release = holdBack(() => screen.close());
  return screen;
}
