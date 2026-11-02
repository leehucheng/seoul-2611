// The ≡ menu in the top bar. Features register an entry with app.addMenuItem({id, label, iconId, count, onClick});
// `count` (optional) is called each time the menu opens and gives the number shown next to the label.
import { h, icon } from './dom.js';

export function initMenu(app) {
  const items = [];
  let pop = null;
  let offDoc = () => {};

  const btn = h('button', { id: 'menu-btn', class: 'menu-btn', type: 'button', 'aria-label': '選單', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('i-menu'));
  const me = document.getElementById('me-btn');
  me.parentElement.insertBefore(btn, me);

  function close({ refocus = true } = {}) {
    if (!pop) return;
    pop.remove();
    pop = null;
    offDoc();
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus({ preventScroll: true });
  }

  function open() {
    if (pop) return;
    pop = h('div', { class: 'menu', role: 'menu', 'aria-label': '選單' });
    for (const item of items) {
      let n = null;
      try { n = item.count ? item.count() : null; } catch { n = null; }
      const row = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' },
        item.iconId ? icon(item.iconId) : null,
        h('span', { class: 'menu-label' }, item.label),
        n !== null && n !== undefined ? h('span', { class: `menu-count${n === 0 ? ' is-zero' : ''}` }, String(n)) : null);
      row.addEventListener('click', () => { close({ refocus: false }); item.onClick(); });
      pop.append(row);
    }
    document.body.append(pop);
    btn.setAttribute('aria-expanded', 'true');

    const onDown = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close({ refocus: false }); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    offDoc = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    pop.querySelector('button')?.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => (pop ? close() : open()));

  app.addMenuItem = (item) => {
    items.push(item);
    return () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); };
  };
  app.closeMenu = close;
  return { open, close, button: btn };
}
