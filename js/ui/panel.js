// A full-height view above the map and below the tab bar (the 今天 page, the 今晚住 hotel card, the 清單 hub, the 未上地圖 list): a <dialog> the caller fills
// with a head and a body. It is opened non-modally (show(), not showModal()): a modal dialog would sit in the browser's top layer
// and cover the tab bar, and the tab bar has to stay visible and tappable. The map, chips and 定位 button behind it are made
// inert by main.js while a view is open (app.on('view')).
//
// One view at a time: opening another closes the one that is open. Esc closes it. The phone's Back button closes it too
// (back-stack.js). Closing hands focus back to what had it before. A view that has somewhere to go back to (the 未上地圖 list opened from the
// 清單 hub) passes onBack: Esc, the browser's own close request and the phone's Back call it instead of closing, and it closes the view itself.
import { holdBack } from '../back-stack.js';
import { h, icon } from './dom.js';

let current = null;
const watchers = new Set();

/** The id of the open view ('today' | 'hotel' | 'lists' | 'list'), or 'map' when none is open. */
export const currentView = () => current?.view ?? 'map';

/** Call fn(view) whenever the open view changes (a view opened, closed, or replaced by another). -> off() */
export function onViewChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function announce() {
  const view = currentView();
  for (const fn of [...watchers]) {
    try { fn(view); } catch (e) { console.error(e); }
  }
}

/** Close whatever view is open (the 地圖 tab). */
export const closeView = () => current?.close();

/** createPanel({cls, label, view, onClose, onBack}) -> {dialog, view, close}. `close` can be called more than once. */
export function createPanel({ cls = '', label = '', view = 'panel', onClose, onBack } = {}) {
  current?.close();
  const dialog = h('dialog', { class: `panel ${cls}`.trim(), 'aria-label': label, tabindex: '-1' });
  let closed = false;
  let releaseBack = () => {};
  let prevFocus = document.activeElement;
  const panel = {
    dialog,
    view,
    close() {
      if (closed) return;
      closed = true;
      releaseBack();
      dialog.removeEventListener('keydown', onKey);
      const wasCurrent = current === panel;
      if (wasCurrent) current = null;
      try { dialog.close(); } catch { /* it was not open */ }
      dialog.remove();
      if (wasCurrent) announce();
      try { onClose?.(); } catch (e) { console.error(e); }
      if (wasCurrent && prevFocus?.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
      prevFocus = null;
    },
  };
  const dismiss = () => { if (onBack) onBack(); else panel.close(); }; // Esc, a browser's close request, the phone's Back
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } }
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); }); // a browser's own close request
  document.body.append(dialog);
  current = panel;
  if (typeof dialog.show === 'function') dialog.show(); else dialog.setAttribute('open', '');
  dialog.focus({ preventScroll: true });
  releaseBack = holdBack(dismiss);
  announce();
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
