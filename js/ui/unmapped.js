// "還沒上地圖": the names in the Sheet's plan tabs that have no pin yet. Lives in the ≡ menu with its count; tapping a
// name opens the add form with that name searched, and the Sheet's wording stored as an alias of the new pin.
//
// renderUnmapped(entries, onPick, {translations}) -> element   (a list grouped by where the name came from)
// initUnmapped(app)  registers the menu entry; app.openUnmapped() opens the list
import { holdBack } from '../back-stack.js';
import { hasHangul, zhOf } from '../i18n.js';
import { unmappedEntries } from '../plan-names.js';
import { append, h, icon } from './dom.js';

const GROUPS = [['Store', '店家清單'], ['銀杏', '銀杏景點'], ['Exhibition', '展覽'], ['Schedule', '行程表']];

function twoLine(text, translations) {
  const korean = hasHangul(text);
  const tx = h('span', { class: 'tx' }, h('span', { class: korean ? 'kr' : undefined, lang: korean ? 'ko' : undefined }, text));
  const zh = korean ? zhOf(text, translations) : null;
  if (zh) tx.append(h('span', { class: 'zh' }, zh));
  return tx;
}

/** `entries` are plan-names.js entries (a plain string counts as an entry with just a label). */
export function renderUnmapped(entries, onPick, { translations = {} } = {}) {
  const list = entries.map((e) => (typeof e === 'string' ? { tab: '', label: e, shop: e, kr: '', query: e, aliases: [e], area: '', day: '' } : e));
  const box = h('div', { class: 'up-list' });
  if (list.length === 0) {
    box.append(h('p', { class: 'up-empty' }, '表上寫的名字，地圖上都找得到 pin 了。'));
    return box;
  }
  const known = new Set(GROUPS.map(([tab]) => tab));
  const groups = [...GROUPS, ['', '其他']].map(([tab, title]) => [title, list.filter((e) => (tab === '' ? !known.has(e.tab) : e.tab === tab))]);
  for (const [title, items] of groups) {
    if (items.length === 0) continue;
    box.append(h('section', { class: 'up-group' },
      h('h3', { class: 'up-title' }, `${title}（${items.length}）`),
      h('ul', { class: 'up-items' }, items.map((e) => {
        const where = [e.area, e.day].filter(Boolean).join(' · ');
        return h('li', null, h('button', { class: 'up-item', type: 'button', onclick: () => onPick(e) },
          h('span', { class: 'up-main' },
            twoLine(e.label, translations),
            e.kr && e.kr !== e.label ? twoLine(e.kr, translations) : null,
            where ? h('span', { class: 'up-where' }, where) : null),
          icon('i-plus', 'up-add')));
      }))));
  }
  return box;
}

export function initUnmapped(app) {
  const compute = () => unmappedEntries(app.snapshot?.tabs ?? {}, app.places, app.config?.ignore_names ?? []);

  function open() {
    const entries = compute();
    const dialog = h('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'up-heading' });
    let releaseBack = () => {};
    const close = () => {
      releaseBack(); // the history entry the open list holds (back-stack.js); a second call does nothing
      try { dialog.close(); } catch { /* not open */ }
      dialog.remove();
    };
    const pick = (entry) => {
      close();
      app.actions.add({
        mode: 'tap',
        presetName: entry.shop,
        presetQuery: entry.query,
        presetAlias: entry.aliases,
      });
    };
    const scroll = h('div', { class: 'sd-scroll' }, renderUnmapped(entries, pick, { translations: app.translations }));
    append(dialog, [
      h('div', { class: 'sd-head' },
        h('h2', { id: 'up-heading', class: 'sd-title' }, `還沒上地圖（${entries.length}）`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '關閉', onclick: close }, icon('i-close'))),
      entries.length ? h('p', { class: 'sd-hint' }, '表上有寫、地圖上還沒有 pin 的名字。點一個，搜尋後加到地圖。') : null,
      scroll,
    ]);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); }); // the dimmed area above the sheet
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    releaseBack = holdBack(close); // the Back button closes the list instead of leaving the app
    return dialog;
  }

  app.openUnmapped = open;
  app.addMenuItem({ id: 'unmapped', label: '還沒上地圖', iconId: 'i-pin', count: () => compute().length, onClick: open });
}
