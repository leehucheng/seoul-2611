// 熱門必買: what Seoul buys social media and the news talked about from 8/3 to 11/3 (data and rules: trending.js; the file: data/trending.json).
//
// initTrending(app, {load}) -> app.trending = {load(), data(), count(), group(), setGroup(id)}: the file, read once (load() reads it the first
//     time the screen opens and keeps it; `load` is what reads it, js/trending.js loadTrendingFile by default), and the group chip kept on this phone
//     (app.storage, `seoul.trend.group`; a blocked storage keeps it in memory). Emits app.emit('trending') when the file has been read.
// trendingCard(app, onOpen) -> {element, paint()}: the row 「熱門必買」 of the 清單 view, with 「103 項・社群與新聞 8/3–11/3」 under it (before the
//     file has been read: 「社群與新聞 8/3–11/3」). paint() redraws the line. A tap calls onOpen(button).
// openTrending(app, {behind, trigger, onClose}) -> {element, close}: the screen, an overlay of its own as the 代購 screen is (ui/shopping.js): the 清單
//     view stays open under it and `behind` goes inert. It holds one back-stack entry: Back (the phone's), Esc and the × close it, with focus back on
//     `trigger`. Top to bottom: the title, one line, the group chips (全部 and the six, with counts), the search box, then the items by group and sub.
//     An item has a thumbnail (its photo when the file has an https one, else the group's mark; images load lazily, only when the cards are drawn),
//     「給店員看」 (the Korean name on a full-screen card, as the 韓文卡's phrases, with the photo above it; the thumbnail does the same when tapped),
//     「來源」 (the first https source) and 「加到我的代購」 (the 代購 add form for me with the item filled in, photo address included; 「已在代購清單」
//     and 「再加一個」 once I have it).
// Text only goes in through dom.js (textContent). A link from the file is used only when it is an https address.
import { holdBack } from '../back-stack.js';
import { FAMILIES } from '../colors.js';
import {
  ALL_GROUPS, TREND_GROUPS, TREND_LEAD, TREND_LOAD_FAILED, groupCounts, groupLabel, groupMark, imageCaption, inShoppingList, isTrendGroup, loadTrendGroup,
  loadTrendingFile, metaOf, parseTrending, priceText, saveTrendGroup, shoppingPrefill, sourceLink, tagsOf, trendCardLine, visibleGroups,
} from '../trending.js';
import { append, clear, famDot, h, icon } from './dom.js';
import { openPhraseCard } from './phrase-cards.js';
import { openShopping } from './shopping.js';

export function initTrending(app, { load } = {}) {
  const read = load ?? (() => loadTrendingFile());
  let data = null;
  let pending = null;
  let group = loadTrendGroup(app.storage);
  app.trending = {
    data: () => data,
    count: () => (data ? data.items.length : null),
    group: () => group,
    setGroup(id) {
      if (!isTrendGroup(id)) return;
      group = id;
      saveTrendGroup(app.storage, id);
    },
    /** The parsed file (read the first time, kept after); rejects when it cannot be read: the next call tries again. */
    load() {
      if (data) return Promise.resolve(data);
      pending ??= Promise.resolve().then(read).then(parseTrending).then((parsed) => {
        data = parsed;
        app.emit('trending');
        return parsed;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

// ---- the row on the 清單 view ------------------------------------------------------------------------------------------------

export function trendingCard(app, onOpen) {
  const line = h('span', { class: 'hb-card-line' });
  const btn = h('button', { class: 'hb-card', type: 'button' },
    h('span', { class: 'chip-ink' }, icon('i-flame')),
    h('span', { class: 'hb-card-main' }, h('span', { class: 'hb-card-title' }, '熱門必買'), line),
    icon('i-chevron-right'));
  btn.addEventListener('click', () => onOpen(btn));
  const paint = () => { line.textContent = trendCardLine(app.trending.count()); };
  paint();
  return { element: btn, paint };
}

// ---- the screen ------------------------------------------------------------------------------------------------------------

/** A sheet of paper with tape on its top corners (the look of the 代購 screen's groups). */
const sheet = (cls, ...kids) => h('div', { class: `hb-paper ${cls}`.trim() }, h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }), ...kids);

export function openTrending(app, { behind = [], trigger = null, onClose } = {}) {
  const trend = app.trending;
  const state = { group: trend.group(), query: '' };
  const behindEls = behind.filter(Boolean);
  const offs = [];
  const syncs = []; // one per item on the screen: shows whether I have it in my 代購 list
  let items = []; // the file's items, once read
  let built = false; // the chips and the search box are made once the file is in
  let closed = false;
  let release = () => {};
  let korean = null; // the full-screen Korean card, if open
  let shop = null; // the 代購 add form, if open

  const body = h('div', { class: 'hb-body' });
  const scroll = h('div', { class: 'hb-scroll' }, body);
  const slot = h('div', { class: 'hb-slot' }); // what is under the lead line: a status, a failure with its button, or the list
  const el = h('div', { class: 'hb', role: 'dialog', 'aria-modal': 'true', 'aria-label': '熱門必買', tabindex: '-1' });

  // ---- the items ----

  // (while a card or the form is open this screen is inert, so neither can be opened a second time: one at a time, no need to close the last)
  function showKorean(item, btn) {
    korean = openPhraseCard({ ko: item.name_ko, zh: item.name_zh, rr: '' }, { behind: [el], trigger: btn, item: true, image: item.image_url, onClose: () => { korean = null; } });
  }

  /**
   * The 72 px thumbnail in a box of its own size (nothing moves when the photo arrives) and, under it, 「品牌照」 / 「門市照」 for a brand's or a store's photo.
   * No photo, or one that does not load: the group's mark in the same box (never a broken-image icon, and the caption goes with the photo).
   * With a Korean name the box is a button that does what 「給店員看」 does (the button next to the price stays the one a keyboard and a screen reader use).
   */
  function thumbnail(item, onShow) { // onShow(): opens the Korean card (the caller gives it the 給店員看 button as the place focus comes back to)
    const mark = groupMark(item.group);
    const box = h('span', { class: 'hb-pic' });
    const caption = imageCaption(item);
    const cap = caption === '' ? null : h('span', { class: 'hb-pic-cap' }, caption);
    if (item.image_url === '') {
      box.append(famDot({ icon: mark.icon, ...FAMILIES[mark.family] }));
    } else {
      const img = h('img', { src: item.image_url, alt: '', loading: 'lazy', decoding: 'async', width: '72', height: '72', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        clear(box).append(famDot({ icon: mark.icon, ...FAMILIES[mark.family] }));
        cap?.remove();
      });
      box.append(img);
    }
    const face = item.name_ko ? h('button', { class: 'hb-pic-btn', type: 'button', 'aria-hidden': 'true', tabindex: '-1' }, box) : box;
    if (item.name_ko) face.addEventListener('click', () => onShow());
    return h('span', { class: 'hb-pic-col' }, face, cap);
  }

  function addToShopping(item, btn) {
    shop = openShopping(app, { behind: [el], trigger: btn, prefill: shoppingPrefill(item), onClose: () => { shop = null; } });
  }

  function itemRow(item) {
    const link = sourceLink(item);
    const meta = metaOf(item);
    const have = h('span', { class: 'hb-tag hb-tag--have' }, icon('i-check'), '已在代購清單');
    const add = h('button', { class: 'hb-btn hb-btn--add', type: 'button', 'aria-label': `加到我的代購：${item.name_zh}` }, '加到我的代購');
    add.addEventListener('click', () => addToShopping(item, add));
    const sync = () => {
      const on = inShoppingList(item, app.shopping?.mine());
      have.hidden = !on;
      add.textContent = on ? '再加一個' : '加到我的代購';
      add.setAttribute('aria-label', `${on ? '再加一個' : '加到我的代購'}：${item.name_zh}`);
      add.classList.toggle('hb-btn--again', on);
    };
    syncs.push(sync);
    sync();

    const tags = tagsOf(item).map((t) => h('span', { class: `hb-tag hb-tag--${t.kind}` }, t.text));
    const show = item.name_ko ? h('button', { class: 'hb-btn', type: 'button', 'aria-label': `給店員看：${item.name_zh}` }, '給店員看') : null;
    show?.addEventListener('click', () => showKorean(item, show));
    const src = link
      ? h('a', { class: 'hb-link', href: link.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `來源：${link.label}（開新分頁）` },
        h('span', { class: 'hb-link-t' }, '來源'), link.label ? h('span', { class: 'hb-link-s' }, link.label) : null, icon('i-arrow'))
      : null;

    return h('li', { class: 'hb-item' },
      h('div', { class: 'hb-row' },
        thumbnail(item, () => showKorean(item, show)), // from the thumbnail too, focus comes back to 給店員看 (the thumbnail is aria-hidden)
        h('span', { class: 'hb-main' },
          h('span', { class: 'hb-name' }, item.name_zh),
          meta ? h('span', { class: 'hb-meta' }, meta) : null,
          h('span', { class: `hb-price${item.price_krw === null ? ' is-unknown' : ''}` },
            h('b', { class: 'num' }, priceText(item)), item.price_note ? h('i', null, item.price_note) : null))),
      item.why ? h('span', { class: 'hb-why' }, item.why) : null,
      h('span', { class: 'hb-tags' }, have, tags),
      show || src ? h('span', { class: 'hb-acts' }, show, src) : null,
      add);
  }

  // ---- the list under the chips and the search box ----

  const list = h('div', { class: 'hb-groups' });
  const found = h('p', { class: 'hb-found', role: 'status' });
  found.hidden = true;
  let chips = [];
  let search = null;

  function paintList() {
    syncs.length = 0;
    const groups = visibleGroups(items, { group: state.group, query: state.query });
    clear(list);
    const n = groups.reduce((sum, g) => sum + g.subs.reduce((s, sub) => s + sub.items.length, 0), 0);
    const asked = state.query.trim() !== '';
    found.textContent = asked ? `找到 ${n} 項` : '';
    found.hidden = !asked;
    if (n === 0) {
      list.append(h('p', { class: 'hb-empty' }, asked ? '沒有符合的東西。換個字，或選「全部」。' : '這一類沒有東西。'));
      return;
    }
    for (const g of groups) {
      list.append(h('section', { class: 'hb-grp', 'data-group': g.id },
        h('h2', { class: 'hb-h2' }, g.label),
        g.subs.map((s) => h('section', { class: 'hb-sub' },
          h('h3', { class: 'hb-h3' }, s.sub),
          sheet('hb-items', h('ul', null, s.items.map(itemRow)))))));
    }
  }

  function pick(id) {
    state.group = id;
    trend.setGroup(id);
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.getAttribute('data-group') === id));
    paintList();
    scroll.scrollTop = 0;
  }

  function showReady() {
    items = trend.data().items;
    if (!isTrendGroup(state.group)) state.group = ALL_GROUPS;
    if (!built) {
      built = true;
      const counts = groupCounts(items);
      chips = [[ALL_GROUPS, groupLabel(ALL_GROUPS)], ...TREND_GROUPS].map(([id, label]) => h('button', {
        class: 'hb-chip', type: 'button', 'data-group': id, 'aria-pressed': String(id === state.group), onclick: () => pick(id),
      }, label, ' ', h('span', { class: 'num' }, counts[id])));
      search = h('input', {
        class: 'field hb-search', type: 'search', placeholder: '搜尋名稱、品牌、店名', 'aria-label': '搜尋熱門必買', autocomplete: 'off', autocapitalize: 'off',
        spellcheck: 'false', enterkeyhint: 'search', maxlength: '40',
      });
      search.addEventListener('input', () => { state.query = search.value; paintList(); });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.blur?.(); }); // done typing: the keyboard goes away
    }
    append(clear(slot), [h('div', { class: 'hb-chips', role: 'group', 'aria-label': '分類' }, chips), search, found, list]);
    paintList();
  }

  function showFailure() {
    const retry = h('button', { class: 'btn btn--primary hb-retry', type: 'button', onclick: () => start() }, '重試');
    append(clear(slot), [h('div', { class: 'hb-fail' }, h('p', { class: 'hb-msg', role: 'alert' }, TREND_LOAD_FAILED), retry)]);
    retry.focus({ preventScroll: true });
  }

  function start() {
    if (trend.data()) { showReady(); return; }
    el.focus({ preventScroll: true });
    append(clear(slot), [h('p', { class: 'hb-status', role: 'status' }, '正在讀熱門清單…')]);
    trend.load().then(() => { if (!closed) showReady(); }, () => { if (!closed) showFailure(); });
  }

  // ---- closing ----

  const screen = {
    element: el,
    close() {
      if (closed) return;
      closed = true;
      release();
      offs.forEach((off) => off());
      el.removeEventListener('keydown', onKey);
      korean?.close();
      shop?.close();
      for (const b of behindEls) b.inert = false;
      el.remove();
      try { onClose?.(); } catch (e) { console.error(e); }
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
    },
  };
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    screen.close();
  }

  body.append(h('p', { class: 'hb-lead' }, TREND_LEAD), slot);
  el.append(
    h('header', { class: 'hb-head' },
      h('h1', { class: 'hb-title' }, '熱門必買'),
      h('button', { class: 'icon-btn hb-close', type: 'button', 'aria-label': '關閉', onclick: () => screen.close() }, icon('i-close'))),
    scroll);
  el.addEventListener('keydown', onKey);
  const syncAll = () => { if (!closed) syncs.forEach((sync) => sync()); };
  offs.push(app.on('shopping', syncAll)); // (a new snapshot, a saved item, a tick or a deleted item all arrive as 'shopping')
  offs.push(app.on('me', syncAll));
  for (const b of behindEls) b.inert = true;
  document.body.append(el);
  el.focus({ preventScroll: true });
  release = holdBack(() => screen.close());
  start();
  return screen;
}
