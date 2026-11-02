// "我是誰": which of the five people is holding this phone. Stored in localStorage `seoul.me` (the person's name).
import { PEOPLE, initialOf } from '../people.js';
import { append, h } from './dom.js';

export const ME_KEY = 'seoul.me';

/** The stored name if it is one of the five, else null. */
export function savedPerson(storage) {
  try {
    const v = storage.getItem(ME_KEY);
    return PEOPLE.some((p) => p.name === v) ? v : null;
  } catch {
    return null;
  }
}

/** Top-right button: the person's initial in an ink circle; its label says who and that it switches. */
export function showMeButton(btn, name) {
  btn.hidden = false;
  btn.textContent = initialOf(name) ?? '?';
  btn.setAttribute('aria-label', `你是 ${name}，按一下切換身分`);
  btn.title = `你是 ${name}，按一下切換`;
}

/**
 * Resolves the person's name. Already chosen -> resolves at once without showing anything.
 * `force` (the top-right button) always asks, and may be dismissed, which keeps the current person.
 * The very first time there is no way to dismiss it: everything on the cards depends on who you are.
 */
export function pickPerson(storage, { force = false } = {}) {
  const current = savedPerson(storage);
  if (current && !force) return Promise.resolve(current);

  return new Promise((resolve) => {
    const dismissible = Boolean(current);
    const dialog = h('dialog', { class: 'picker', 'aria-labelledby': 'picker-title' });
    const close = (name) => {
      try { dialog.close(); } catch { /* not open */ }
      dialog.remove();
      resolve(name);
    };

    const list = h('div', { class: 'picker-list' }, PEOPLE.map((p) => {
      const initial = h('span', { class: 'picker-initial', 'aria-hidden': 'true' }, p.initial);
      return h(
        'button',
        {
          class: 'picker-btn', type: 'button', 'aria-current': p.name === current ? 'true' : undefined,
          onclick: () => {
            try { storage.setItem(ME_KEY, p.name); } catch { /* private mode: still works until the page closes */ }
            close(p.name);
          },
        },
        initial,
        h('span', { class: 'picker-name' }, p.name),
      );
    }));

    append(dialog, [
      h('h2', { id: 'picker-title', class: 'picker-title' }, '你是誰？'),
      h('p', { class: 'picker-hint' }, dismissible ? '選一個，換成他的角度看店家。' : '只要選一次，這支手機會記住。右上角可以再改。'),
      list,
      dismissible ? h('button', { class: 'picker-cancel', type: 'button', onclick: () => close(current) }, '不換了') : null,
    ]);
    // Esc: the first-time dialog stays; a switch dialog just closes.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(current); });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    list.querySelector('button')?.focus();
  });
}
