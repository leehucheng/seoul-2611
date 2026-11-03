// 給店員看: the phrase half of the 韓文卡 panel (the hotel card is the other half, ui/hotel-card.js). Phrases come from phrases.js.
//
// phraseSection(onOpen) -> the heading and one button per phrase (the Korean large, the Chinese under it, the romanization small).
//     A tap calls onOpen(phrase, button).
// openPhraseCard(phrase, {behind, trigger, onClose}) -> {element, close}: the full-screen card to hold up to a shop assistant: the Korean
//     very large on taped paper, the Chinese under it, the romanization smaller. It is an overlay of its own, not a panel: the 韓文卡 panel
//     stays open under it, and it sits above the tab bar (app.css .pc, z-index 30). `behind` are the elements that go inert while it is open.
//     It holds one back-stack entry: Back (the phone's), Esc and the × all close it and show the list again, with focus back on `trigger`.
//     A phrase without `rr` has no third line. {item: true} (the 熱門必買 screen's 「給店員看」: the Korean name of a thing to buy, the Chinese name
//     under it) lets a tap anywhere on the card close it too and sets the Chinese name smaller, so a long Korean name stays the biggest thing on the card.
//     {image: 'https://…'} (the caller has checked it is https) puts that photo above the Korean text, contained in a box 40% of the screen
//     high from the start (the text does not jump when the photo arrives); a photo that does not load is taken away with its box, once, and the text is as it
//     was (no referrer is sent with it, and it is loaded only when the card opens).
import { holdBack } from '../back-stack.js';
import { PHRASE_GROUPS } from '../phrases.js';
import { h, icon } from './dom.js';

// The Korean line is sized from the screen width: width * cardScale(ko) px. A Hangul syllable is about one em wide, a space and a
// question mark are narrower; ~82% of the width is left for the line (the sheet's padding takes the rest), so a phrase fits one line
// where it can: the longest one still does at 33 px on a 390 px screen; shorter ones get bigger, up to 22% of the width.
const FILL = 0.82;
const SCALE_MIN = 0.085;
const SCALE_MAX = 0.22;
const emWidth = (ch) => (ch === ' ' ? 0.3 : /[?!.,]/.test(ch) ? 0.6 : 1);

/** The Korean line's font size on the full card, as a fraction of the screen width (the CSS caps the width at 600 px). */
export function cardScale(ko) {
  let ems = 0;
  for (const ch of String(ko ?? '')) ems += emWidth(ch);
  const k = FILL / Math.max(ems, 1);
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, k)) * 1000) / 1000;
}

function row(phrase, onOpen) {
  const btn = h('button', { class: 'pc-row', type: 'button' },
    h('span', { class: 'pc-row-main' },
      h('span', { class: 'pc-row-ko kr', lang: 'ko' }, phrase.ko),
      h('span', { class: 'pc-row-zh' }, phrase.zh),
      h('span', { class: 'pc-row-rr' }, phrase.rr)),
    icon('i-chevron-right'));
  btn.addEventListener('click', () => onOpen(phrase, btn));
  return h('li', null, btn);
}

export function phraseSection(onOpen) {
  return h('section', { class: 'pc-section' },
    h('div', { class: 'pc-head' },
      h('h3', { class: 'pc-title' }, '給店員看'),
      h('p', { class: 'hc-label' }, '點一句，整個螢幕放大，拿給對方看')),
    PHRASE_GROUPS.map((g) => h('div', { class: 'pc-group', 'data-group': g.id },
      h('h4', { class: 'pc-gtitle' }, g.title),
      h('ul', { class: 'pc-items' }, g.phrases.map((p) => row(p, onOpen))))));
}

/** The photo above the Korean text: gone altogether (no broken-image icon) when the file does not load. */
function photo(src) {
  const box = h('div', { class: 'pc-photo' });
  const img = h('img', { src, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => box.remove());
  box.append(img);
  return box;
}

export function openPhraseCard(phrase, { behind = [], trigger = null, onClose, item = false, image = '' } = {}) {
  const ko = h('p', { class: 'pc-ko kr', lang: 'ko' }, phrase.ko);
  ko.style.setProperty('--pc-k', String(cardScale(phrase.ko)));
  const el = h('div', { class: item ? 'pc pc--item' : 'pc', role: 'dialog', 'aria-modal': 'true', 'aria-label': `韓文卡：${phrase.zh}`, tabindex: '-1' });
  let closed = false;
  let release = () => {};
  const behindEls = behind.filter(Boolean);
  const card = {
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
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); card.close(); } }

  el.append(
    h('button', { class: 'icon-btn pc-close', type: 'button', 'aria-label': '關閉', onclick: () => card.close() }, icon('i-close')),
    h('section', { class: 'pc-sheet' },
      h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }),
      h('div', { class: 'pc-text' }, // the scrolling part: the tape sits on the sheet's corners, outside it
        image ? photo(image) : null,
        ko,
        h('p', { class: 'pc-zh' }, phrase.zh),
        phrase.rr ? h('p', { class: 'pc-rr' }, phrase.rr) : null)));
  el.addEventListener('keydown', onKey);
  if (item) el.addEventListener('click', () => card.close());
  for (const b of behindEls) b.inert = true;
  document.body.append(el);
  el.focus({ preventScroll: true });
  release = holdBack(() => card.close());
  return card;
}
