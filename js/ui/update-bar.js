// 「新版本好了」: a small bar just above the tab bar with a 「更新」 button, shown when a new service worker takes control of a page that
// already had a controller at load (the worker's `controllerchange`). The button reloads the page; the page is never reloaded by itself
// (someone may be typing in the add form). No bar on a first install: a page that had no controller at load only gets the worker claiming it.
//
// initUpdateBar({nav, reload, parent}) -> {bar, off} | null (null: no service worker support, or no controller at load). Call it before the
// worker is registered, while the load-time controller can still be seen. `nav`, `reload` and `parent` are injectable for tests.
import { h } from './dom.js';

export function initUpdateBar({ nav = globalThis.navigator, reload = () => window.location.reload(), parent = globalThis.document?.body } = {}) {
  const sw = nav?.serviceWorker;
  if (!sw || !sw.controller || typeof sw.addEventListener !== 'function') return null;
  let bar = null;
  const show = () => {
    if (bar) return; // one bar, however many times control changes
    bar = h('div', { class: 'update-bar', role: 'status' },
      h('span', { class: 'update-text' }, '新版本好了'),
      h('button', { class: 'update-btn', type: 'button', onclick: () => reload() }, '更新'));
    parent.append(bar);
  };
  sw.addEventListener('controllerchange', show);
  return {
    get bar() { return bar; },
    off() { sw.removeEventListener?.('controllerchange', show); },
  };
}
