// 代購清單: everybody's shopping list, each person keeps their own items (content and rules: shopping.js; the Sheet tab: App_Shopping).
//
// initShopping(app, {api}) -> app.shopping = {api, items(), mine(), apply(row)}: the items the phone shows (the last snapshot's snapshot.shopping with
//     what was saved from this phone laid over it) and the three calls that write them (api.save(item), api.remove({id, owner}),
//     api.setBought({id, owner, bought}); api.js by default, anything else in a test). Every change emits app.emit('shopping').
// shoppingCard(app, onOpen) -> {element, paint()}: the card 「代購清單」 on the 全程總覽 page and on every day page, with 「我的 N 項・已買 M」 under it.
//     paint() redraws the line (the caller calls it on app.on('shopping')). A tap calls onOpen(button).
// openShopping(app, {behind, trigger, onClose}) -> {element, close}: the screen, an overlay of its own as the packing screen is (ui/packing.js): the
//     今天 page stays open under it and `behind` goes inert. It holds one back-stack entry: Back (the phone's), Esc and the × close it, with focus
//     back on `trigger`. While the add / edit form is open, Back and Esc close the form first.
//     Top to bottom: person chips (「我的」, then everyone else who has an item), 「這是 <name> 的清單，只能看」 on somebody else's list, the numbers,
//     「＋ 新增想買的」, the items grouped by 「在哪買」. Somebody else's list has no button that changes anything. A write that fails says
//     「沒存到，連上網路再試一次」: a tick goes back, the form stays open.
// Text only goes in through dom.js (textContent). An image or link from the Sheet is used only when it is an https address.
import { deleteShopping, saveShopping, setBought } from '../api.js';
import { holdBack } from '../back-stack.js';
import { hasHangul } from '../i18n.js';
import { safeHttpsUrl } from '../place-view.js';
import {
  FORM_FIELDS, SAVE_FAILED, cardLine, checkForm, createShopping, formValues, formatKrw, groupByWhere, isTrue, itemsOf, metaLine, ownersOf, priceDateLabel, priceOf,
  qtyOf, summarize, summaryText, unpricedText,
} from '../shopping.js';
import { append, clear, h, icon } from './dom.js';

export function initShopping(app, { api } = {}) {
  const model = createShopping();
  model.setServer(app.snapshot?.shopping);
  app.shopping = {
    api: api ?? {
      save: (item) => saveShopping(app.cfg, item),
      remove: (args) => deleteShopping(app.cfg, args),
      setBought: (args) => setBought(app.cfg, args),
    },
    items: () => model.all(),
    mine: () => itemsOf(model.all(), app.me ?? ''),
    apply(row) {
      model.apply(row);
      app.emit('shopping');
    },
  };
  app.on('snapshot', () => {
    model.setServer(app.snapshot?.shopping);
    app.emit('shopping');
  });
}

// ---- the card on the 今天 page ---------------------------------------------------------------------------------------------

export function shoppingCard(app, onOpen) {
  const line = h('span', { class: 'sp-card-line' });
  const btn = h('button', { class: 'sp-card', type: 'button' },
    h('span', { class: 'chip-ink' }, icon('i-bag')),
    h('span', { class: 'sp-card-main' }, h('span', { class: 'sp-card-title' }, '代購清單'), line),
    icon('i-chevron-right'));
  btn.addEventListener('click', () => onOpen(btn));
  const paint = () => { line.textContent = app.snapshot ? cardLine(app.shopping.mine()) : '正在讀清單…'; };
  paint();
  return { element: btn, paint };
}

// ---- the screen -----------------------------------------------------------------------------------------------------------

/** A sheet of paper with tape on its top corners (the look of the packing screen's groups). */
const sheet = (cls, ...kids) => h('div', { class: `sp-paper ${cls}`.trim() }, h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }), ...kids);

/** The 72 px picture: gone altogether when the file does not load (no broken-image icon). */
function picture(src) {
  const wrap = h('span', { class: 'sp-pic' });
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', width: '72', height: '72', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => wrap.remove());
  wrap.append(img);
  return wrap;
}

/** What each form field is: how many characters, which keyboard. */
const INPUTS = {
  name_zh: { maxlength: '80' }, name_ko: { maxlength: '80', lang: 'ko' }, brand: { maxlength: '60' }, spec: { maxlength: '60' },
  qty: { maxlength: '2', inputmode: 'numeric' }, for_whom: { maxlength: '40' }, price_krw: { maxlength: '12', inputmode: 'numeric', placeholder: '例如 12500' },
  where: { maxlength: '60', placeholder: '例如 藥妝店、超市' }, official_url: { maxlength: '500', inputmode: 'url', placeholder: 'https://' },
  image_url: { maxlength: '500', inputmode: 'url', placeholder: 'https://' }, note: { maxlength: '300' },
};

export function openShopping(app, { behind = [], trigger = null, onClose } = {}) {
  const store = app.shopping;
  const api = store.api;
  const state = { owner: app.me ?? '', form: null, saving: false };
  const keyed = new Map(); // data-key -> element, so focus can go back to the same thing after the list is drawn again
  const busy = new Set(); // ids of the items whose tick is on its way
  let lastSig = '';
  let closed = false;
  let release = () => {};
  const offs = [];
  const behindEls = behind.filter(Boolean);

  const mark = (node, key) => {
    node.setAttribute('data-key', key);
    keyed.set(key, node);
    return node;
  };
  const msg = h('p', { class: 'sp-msg', role: 'alert' });
  msg.hidden = true;
  const showMsg = (text) => { msg.textContent = text; msg.hidden = text === ''; };
  const body = h('div', { class: 'sp-body' });
  const scroll = h('div', { class: 'sp-scroll' }, body);
  const formBox = h('div', { class: 'sp-scroll sp-formbox' });
  formBox.hidden = true;
  const el = h('div', { class: 'sp', role: 'dialog', 'aria-modal': 'true', 'aria-label': '代購清單', tabindex: '-1' });

  // ---- the list ----

  const sigOf = () => JSON.stringify([app.me ?? '', state.owner, store.items()]);

  function paintTick(btn, row, on) {
    btn.setAttribute('aria-pressed', String(on));
    row.classList.toggle('is-done', on);
  }

  async function onTick(item, btn, row) {
    if (busy.has(item.id)) return;
    busy.add(item.id);
    showMsg('');
    const on = !isTrue(item.bought);
    paintTick(btn, row, on); // at once; goes back if the write does not go through
    try {
      const answer = await api.setBought({ id: item.id, owner: app.me, bought: on });
      store.apply({ ...item, ...answer });
    } catch {
      paintTick(btn, row, !on);
      showMsg(SAVE_FAILED);
    } finally {
      busy.delete(item.id);
    }
  }

  function itemRow(item, mine) {
    const main = item.name_ko || item.name_zh;
    const sub = item.name_ko && item.name_zh ? item.name_zh : '';
    const bought = isTrue(item.bought);
    const price = priceOf(item);
    const date = priceDateLabel(item.price_date);
    const imgUrl = safeHttpsUrl(item.image_url);
    const linkUrl = safeHttpsUrl(item.official_url);
    const meta = metaLine(item);

    const text = h('span', { class: 'sp-txt' },
      h('span', { class: 'sp-ko', lang: item.name_ko ? 'ko' : undefined }, main),
      sub ? h('span', { class: 'sp-zh' }, sub) : null,
      meta ? h('span', { class: 'sp-meta' }, meta) : null,
      h('span', { class: 'sp-line' }, h('b', { class: 'sp-qty' }, `×${qtyOf(item)}`), item.for_whom ? h('span', { class: 'sp-for' }, `給 ${item.for_whom}`) : null),
      price === null ? null : h('span', { class: 'sp-price' }, h('b', { class: 'num' }, formatKrw(price)), h('i', null, `官網價${date ? `・${date}` : ''}`)));
    const pic = imgUrl ? picture(imgUrl) : null;
    const open = mine
      ? mark(h('button', { class: 'sp-open', type: 'button', 'aria-label': `編輯：${main}`, onclick: () => openForm(item) }, pic, text), `open:${item.id}`)
      : h('div', { class: 'sp-main' }, pic, text);

    const notes = [item.note, item.price_note ? `價格備註：${item.price_note}` : ''].filter(Boolean);
    const foot = linkUrl || notes.length > 0
      ? h('div', { class: `sp-foot${mine ? ' sp-foot--mine' : ''}` },
        linkUrl ? h('a', { class: 'sp-link', href: linkUrl, target: '_blank', rel: 'noopener', 'aria-label': `官網：${main}` }, '官網', icon('i-arrow')) : null,
        notes.length > 0 ? h('details', { class: 'sp-more' }, h('summary', null, '備註'), notes.map((n) => h('p', null, n))) : null)
      : null;

    const row = h('li', { class: `sp-item${bought ? ' is-done' : ''}` });
    const top = h('div', { class: 'sp-row' });
    if (mine) {
      const tick = mark(h('button', { class: 'sp-ck', type: 'button', 'aria-pressed': String(bought), 'aria-label': `已買：${main}` }, h('span', { class: 'sp-ck-c' }, icon('i-check', 'sp-ck-tick'))), `ck:${item.id}`);
      tick.addEventListener('click', () => onTick(item, tick, row));
      top.append(tick);
    }
    top.append(open);
    row.append(top);
    if (foot) row.append(foot);
    return row;
  }

  function render() {
    const me = app.me ?? '';
    const all = store.items();
    const who = ownersOf(all, me);
    if (!who.includes(state.owner)) state.owner = me;
    const mine = me !== '' && state.owner === me;
    const items = itemsOf(all, state.owner);
    const sum = summarize(items);
    const focusKey = document.activeElement?.getAttribute?.('data-key') ?? null;
    const top = scroll.scrollTop;
    keyed.clear();

    const chips = h('div', { class: 'sp-chips', role: 'group', 'aria-label': '看誰的清單' },
      who.map((name, i) => mark(h('button', {
        class: 'sp-chip', type: 'button', 'aria-pressed': String(name === state.owner),
        onclick: () => { state.owner = name; showMsg(''); render(); },
      }, i === 0 ? '我的' : name), `chip:${i}`)));
    const groups = groupByWhere(items).map((g, i) => h('section', { class: 'sp-grp', 'aria-labelledby': `sp-g-${i}` },
      h('h2', { class: 'sp-h2', id: `sp-g-${i}`, lang: hasHangul(g.where) ? 'ko' : undefined }, g.where),
      sheet('sp-items', h('ul', null, g.items.map((it) => itemRow(it, mine))))));

    clear(body);
    body.append(chips);
    if (!mine) body.append(h('p', { class: 'sp-ro' }, `這是 ${state.owner} 的清單，只能看`));
    body.append(h('div', { class: 'sp-sum', 'aria-live': 'polite' },
      h('p', { class: 'sp-sum-main' }, summaryText(sum)),
      sum.unpriced > 0 ? h('p', { class: 'sp-sum-note' }, unpricedText(sum)) : null));
    body.append(msg);
    if (mine) body.append(mark(h('button', { class: 'btn btn--primary sp-add', type: 'button', onclick: () => openForm(null) }, '＋ 新增想買的'), 'add'));
    if (items.length === 0) {
      body.append(h('p', { class: 'sp-empty' }, mine ? '還沒有想買的。按上面的「＋ 新增想買的」加第一個。' : '這份清單是空的。'));
    } else {
      body.append(h('div', { class: 'sp-groups' }, groups));
    }
    scroll.scrollTop = top;
    if (focusKey) keyed.get(focusKey)?.focus({ preventScroll: true });
    lastSig = sigOf();
  }

  // ---- the add / edit form (my own list only) ----

  let ui = null; // the open form's parts: {inputs, error, save, ask, del}

  function setError(text, field) {
    ui.error.textContent = text;
    for (const [k, input] of Object.entries(ui.inputs)) input.setAttribute('aria-invalid', String(text !== '' && k === field));
    if (text !== '' && field) ui.inputs[field]?.focus({ preventScroll: true });
  }

  function closeForm() {
    if (!state.form) return;
    const { item } = state.form;
    state.form = null;
    ui = null;
    clear(formBox);
    formBox.hidden = true;
    scroll.hidden = false;
    render();
    (keyed.get(item ? `open:${item.id}` : 'add') ?? keyed.get('add'))?.focus({ preventScroll: true });
  }

  async function save() {
    if (state.saving || !state.form) return;
    const { item } = state.form;
    const r = checkForm(Object.fromEntries(Object.entries(ui.inputs).map(([k, input]) => [k, input.value])), { owner: app.me ?? '', item });
    if (!r.ok) { setError(r.error, r.field); return; }
    setError('');
    const form = ui; // the form may be closed (and another opened) while the write is on its way: only touch it while it is still this one
    state.saving = true;
    form.save.disabled = true;
    form.save.textContent = '儲存中…';
    try {
      const answer = await api.save(r.item);
      store.apply({ ...(item ?? {}), ...r.item, ...answer }); // the backend's row has every field; the mock's has what was sent: the item as it was is the base
      if (ui === form) closeForm();
    } catch {
      if (ui === form) setError(SAVE_FAILED);
    } finally {
      state.saving = false;
      form.save.disabled = false;
      form.save.textContent = '儲存';
    }
  }

  async function remove() {
    if (state.saving || !state.form?.item) return;
    const { item } = state.form;
    const form = ui;
    state.saving = true;
    try {
      const answer = await api.remove({ id: item.id, owner: app.me });
      store.apply({ ...item, ...answer, hidden: 'TRUE' });
      if (ui === form) closeForm();
    } catch {
      if (ui === form) { form.ask.hidden = true; setError(SAVE_FAILED); }
    } finally {
      state.saving = false;
    }
  }

  /** `item` is one of my items to change, or null for a new one. */
  function openForm(item) {
    if (state.form || (app.me ?? '') === '') return;
    state.form = { item };
    const values = formValues(item);
    const inputs = {};
    const fields = FORM_FIELDS.map(([k, label]) => {
      const id = `sp-f-${k}`;
      const input = k === 'note' ? h('textarea', { class: 'field sp-text', id, rows: '3', ...INPUTS[k] }) : h('input', { class: 'field', id, type: 'text', autocomplete: 'off', ...INPUTS[k] });
      input.value = values[k];
      inputs[k] = input;
      return h('div', { class: 'sp-fld' }, h('label', { class: 'field-label', for: id }, label), input);
    });
    const error = h('p', { class: 'field-error', role: 'alert' });
    const saveBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => save() }, '儲存');
    const cancel = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => closeForm() }, '取消');
    const yes = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => remove() }, '確定刪除');
    const no = h('button', { class: 'btn btn--ghost', type: 'button' }, '取消');
    const ask = h('div', { class: 'sp-confirm', role: 'group', 'aria-label': '確認刪除' }, // the question is asked here, in the page, not in a browser dialog
      h('p', null, `確定刪除「${item ? item.name_ko || item.name_zh : ''}」？`),
      h('div', { class: 'sp-crow' }, yes, no));
    ask.hidden = true;
    const del = item ? h('button', { class: 'btn btn--ghost sp-del', type: 'button', onclick: () => { ask.hidden = false; yes.focus({ preventScroll: true }); } }, '刪除') : null;
    no.addEventListener('click', () => { ask.hidden = true; del?.focus({ preventScroll: true }); });
    ui = { inputs, error, save: saveBtn, ask, del };
    append(clear(formBox), [
      h('h2', { class: 'sp-h2 sp-formh' }, item ? '編輯' : '新增想買的'),
      h('p', { class: 'sp-hint' }, '中文名和韓文名至少填一個。韓文名可以直接拿給店員看。'),
      fields, error, saveBtn, cancel, del, ask]);
    scroll.hidden = true;
    formBox.hidden = false;
    inputs.name_zh.focus({ preventScroll: true });
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
      for (const b of behindEls) b.inert = false;
      el.remove();
      try { onClose?.(); } catch (e) { console.error(e); }
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
    },
  };
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (ui && !ui.ask.hidden) { ui.ask.hidden = true; ui.del?.focus({ preventScroll: true }); } // Esc first puts the question away, then the form, then the screen
    else if (state.form) closeForm();
    else screen.close();
  }

  el.append(
    h('header', { class: 'sp-head' },
      h('h1', { class: 'sp-title' }, '代購清單'),
      h('button', { class: 'icon-btn sp-close', type: 'button', 'aria-label': '關閉', onclick: () => screen.close() }, icon('i-close'))),
    scroll, formBox);
  el.addEventListener('keydown', onKey);
  offs.push(app.on('shopping', () => { if (!closed && !state.form && sigOf() !== lastSig) render(); }));
  offs.push(app.on('me', () => { state.owner = app.me ?? ''; if (state.form) closeForm(); else render(); }));
  render();
  for (const b of behindEls) b.inert = true;
  document.body.append(el);
  el.focus({ preventScroll: true });
  release = holdBack(() => {
    if (state.form) { closeForm(); return 'stay'; } // Back first closes the form, then the screen
    screen.close();
    return undefined;
  });
  return screen;
}
