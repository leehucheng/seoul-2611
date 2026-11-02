// A full-screen modal panel (the 今天 page and the hotel card): a <dialog> the caller fills with a head and a body.
// One panel at a time: opening another closes the one that is open. Esc closes it. Closing hands focus back to what
// had it before (the browser does that for modal dialogs). The phone's Back button closes it too (back-stack.js).
import { holdBack } from '../back-stack.js';
import { h, icon } from './dom.js';

let current = null;

/** createPanel({cls, label, onClose}) -> {dialog, close}. `close` can be called more than once. */
export function createPanel({ cls = '', label = '', onClose } = {}) {
  current?.close();
  const dialog = h('dialog', { class: `panel ${cls}`.trim(), 'aria-label': label, tabindex: '-1' });
  let closed = false;
  let releaseBack = () => {};
  const panel = {
    dialog,
    close() {
      if (closed) return;
      closed = true;
      releaseBack();
      if (current === panel) current = null;
      try { dialog.close(); } catch { /* it was not open */ }
      dialog.remove();
      try { onClose?.(); } catch (e) { console.error(e); }
    },
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); panel.close(); }); // Esc
  document.body.append(dialog);
  current = panel;
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  dialog.focus({ preventScroll: true });
  releaseBack = holdBack(() => panel.close());
  return panel;
}

/** The × button of a panel head. */
export const closeButton = (panel) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': '關閉', onclick: () => panel.close() }, icon('i-close'));

/** A string plus, when it contains Korean, its smaller Chinese line under it (`zh` null -> nothing extra). */
export function textWithZh(text, zh, { korean = false, cls = '' } = {}) {
  const tx = h('span', { class: `tx ${cls}`.trim() }, h('span', { class: korean ? 'kr' : undefined, lang: korean ? 'ko' : undefined }, text));
  if (zh) tx.append(h('span', { class: 'zh' }, zh));
  return tx;
}
