// "還沒上地圖": the names in the Sheet's plan tabs that have no pin yet. It is a full-height view above the map and below the tab
// bar, the third row of the 清單 view (ui/lists.js). Tapping a name opens the add form with that name searched, and the Sheet's
// wording stored as an alias of the new pin.
//
// renderUnmapped(entries, onPick, {translations}) -> element   (a list grouped by where the name came from)
// unmappedLine(n) -> 「N 個」, or 「都上地圖了」 for 0
// unmappedCard(app, onOpen) -> {element, paint()}: the row 「未上地圖」 of the 清單 view, with unmappedLine under it. paint() redraws the line.
//     A tap calls onOpen(button).
// initUnmapped(app)  sets app.openUnmapped({from}) (opens the list; from: 'lists' puts 「← 清單」 first in its head, and Back / Esc / that
//     button go back to the 清單 view instead of the map) and app.unmappedCount() (the number on the 清單 view's row)
import { hasHangul, zhOf } from '../i18n.js';
import { unmappedEntries } from '../plan-names.js';
import { append, clear, h, icon } from './dom.js';
import { closeButton, createPanel } from './panel.js';

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

export const unmappedLine = (n) => (n > 0 ? `${n} 個` : '都上地圖了');

export function unmappedCard(app, onOpen) {
  const line = h('span', { class: 'up-card-line' });
  const btn = h('button', { class: 'up-card', type: 'button' },
    h('span', { class: 'chip-ink' }, icon('i-pin')),
    h('span', { class: 'up-card-main' }, h('span', { class: 'up-card-title' }, '未上地圖'), line),
    icon('i-chevron-right'));
  btn.addEventListener('click', () => onOpen(btn));
  const paint = () => {
    let n = null;
    if (app.snapshot) { try { n = Number(app.unmappedCount()) || 0; } catch { n = null; } } // no data yet, or the tabs cannot be read: no number to claim
    line.textContent = n === null ? '正在讀資料…' : unmappedLine(n);
  };
  paint();
  return { element: btn, paint };
}

export function initUnmapped(app) {
  const compute = () => unmappedEntries(app.snapshot?.tabs ?? {}, app.places, app.config?.ignore_names ?? []);

  function open({ from } = {}) {
    if (!app.snapshot) {
      app.showToast('資料還沒載入好，等一下再按一次');
      return null;
    }
    app.closeCard();
    const offs = [];
    const title = h('h2', { id: 'up-heading', class: 'panel-title' });
    const hint = h('p', { class: 'up-hint' }, '表上有寫、地圖上還沒有 pin 的名字。點一個，搜尋後加到地圖。');
    const list = h('div', { class: 'up-wrap' });
    const body = h('div', { class: 'panel-body' }, hint, list);
    const toLists = from === 'lists' && typeof app.openLists === 'function';
    const backToLists = () => { panel.close(); app.openLists({ focusRow: 'unmapped' }); };
    const panel = createPanel({
      cls: 'panel--list', label: '還沒上地圖', view: 'list', onClose: () => offs.forEach((off) => off()), onBack: toLists ? backToLists : undefined,
    });
    // from the 清單 view the first control is 「← 清單」 (it takes the place of ×; the 地圖 tab shows the map)
    const lead = toLists ? h('button', { class: 'ls-back', type: 'button', onclick: backToLists }, '← 清單') : closeButton(panel);
    append(panel.dialog, [h('header', { class: 'panel-head' }, lead, title), body]);

    const pick = (entry) => {
      panel.close(); // back to the map: the add form needs it to pick a spot
      app.actions.add({
        mode: 'tap',
        presetName: entry.shop,
        presetQuery: entry.query,
        presetAlias: entry.aliases,
      });
    };
    let sig = '';
    function render() {
      const entries = compute();
      sig = JSON.stringify([entries, app.translations]);
      const scroll = body.scrollTop;
      title.textContent = `還沒上地圖（${entries.length}）`;
      hint.hidden = entries.length === 0;
      clear(list).append(renderUnmapped(entries, pick, { translations: app.translations }));
      body.scrollTop = scroll;
    }
    render();
    offs.push(app.on('snapshot', () => { if (JSON.stringify([compute(), app.translations]) !== sig) render(); })); // a poll or a just-added pin changes the list
    return panel;
  }

  app.openUnmapped = open;
  app.unmappedCount = () => compute().length;
}
