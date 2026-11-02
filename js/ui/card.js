// Place card: a bottom sheet that slides up when a pin is tapped. Drag the top (handle or title) to pull it
// up for the full content, down to dismiss. Everything shown comes from the Sheet, so text is only ever set
// through textContent (see dom.js).
//
// openCard(place, ctx) / closeCard()
// ctx = { person, purchases, config, translations, starred, toggleStar(placeId) -> boolean, onClose?, now?, platform?, navigate?,
//         strip?, here?, openStop? }
// (`platform` and `navigate(url)` exist so tests can pick the iOS path and observe a page change without leaving the page)
//   strip     {index, total, time, prev, next} when the place is one of my stops today (prev / next: {name, time, placeId}): the
//             前一站 / 今天第 N 站 / 下一站 strip. openStop(placeId) opens a neighbour (its card, or the 今天 page when it has no pin).
//   here()    my position {lat, lng} or null: the 距離 line only shows when there is one.
//
// The look is the ginkgo fold-out: a cream drawer with a curved top edge (drawn in ink), the name large with the Korean name under it,
// the facts on a white paper menu taped to the drawer (hours with 營業中 / 再 N 打烊, distance), then 分類 / 誰想去, and the Naver
// (yellow, an arrow in an ink circle) and Google (outlined) capsules. The tab bar stays on top of the drawer's bottom edge.
import { holdBack } from '../back-stack.js';
import { createFallbackGuard } from '../fallback-guard.js';
import { hasHangul, zhOf } from '../i18n.js';
import { lightsplitShareUrl } from '../links.js';
import { distanceMeters, walkMinutes } from '../geo.js';
import { PEOPLE } from '../people.js';
import {
  categoryOf, detectPlatform, googleUrl, hasCoords, hoursCard, nameBlock, naverTarget, parseAmount, personalFor,
  safeHttpsUrl, signatureView, toCoord, whoNames,
} from '../place-view.js';
import { famDot, h, icon, leaf, sheetEdge } from './dom.js';

const HINT = '走路導航用 Naver；Google 在韓國通常只有大眾運輸路線';
const TAB_GAP = 12; // px between the navigation buttons and the tab bar (app.css .nav-block's sticky offset uses the same 12)
const MAX_SHEET = 0.92; // of the viewport height
const MAX_PEEK = 0.76;
const SNAP_MS = 320;
const IOS_FALLBACK_MS = 1500;
const clean = (v) => String(v ?? '').trim();

const state = { open: false, place: null, ctx: null, mode: 'peek', vis: 0, fullH: 0, peekH: 0, closeTimer: 0, prevFocus: null };
let els = null; // {sheet, grab, scroll, content, head, nav}
let releaseBack = null; // gives back the history entry the open card holds (back-stack.js)
let drag = null;
let suppressClickUntil = 0;

const root = () => document.documentElement;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---- content ----------------------------------------------------------------------------------------------

/** A string plus, when it contains Korean, a smaller Chinese line under it (explicit translation first, then the snapshot's). */
function textWithZh(s, translations, explicitZh = '') {
  const korean = hasHangul(s);
  const wrap = h('span', { class: 'tx' }, h('span', { class: korean ? 'kr' : undefined, lang: korean ? 'ko' : undefined }, s));
  const zh = korean ? clean(explicitZh) || zhOf(s, translations) : null;
  if (zh) wrap.append(h('span', { class: 'zh' }, zh));
  return wrap;
}

const koreanAttrs = (s, cls) => ({ class: [cls, hasHangul(s) ? 'kr' : ''].filter(Boolean).join(' ') || undefined, lang: hasHangul(s) ? 'ko' : undefined });

/**
 * One line made of several strings (brand, item, remark ...), then one smaller Chinese line under it for each
 * Korean string that has a translation. `sep` is plain text put before a part.
 */
function inlineWithZh(tr, parts) {
  const nodes = [];
  const zhLines = [];
  for (const { text, strong, sep, cls } of parts) {
    const s = clean(text);
    if (!s) continue;
    if (sep) nodes.push(sep);
    nodes.push(h(strong ? 'strong' : 'span', koreanAttrs(s, cls), s));
    const zh = hasHangul(s) ? zhOf(s, tr) : null;
    if (zh) zhLines.push(h('span', { class: 'zh' }, zh));
  }
  return [...nodes, ...zhLines];
}

const badge = (tone, label) => h('span', { class: `badge badge--${tone}` }, label);
const section = (cls, title, ...kids) => h('section', { class: cls }, title ? h('h3', { class: 'sec-title' }, title) : null, kids);

function buildHeader(place, ctx) {
  const { title, sub } = nameBlock(place, ctx.translations);
  const titles = h('div', { class: 'card-titles' });
  titles.append(h('h2', { ...koreanAttrs(title.text, `card-title${Array.from(title.text).length > 14 ? ' is-long' : ''}`) }, title.text));
  if (title.zh) titles.append(h('p', { class: 'card-sub' }, title.zh)); // Korean title (no Chinese name): its Chinese line
  if (sub.length) {
    // Korean (and English) name under the Chinese title, smaller; each Korean string keeps its own Chinese line below
    const line = h('p', { class: 'card-sub' });
    sub.forEach((s, i) => {
      if (i > 0) line.append(' · ');
      line.append(h('span', koreanAttrs(s.text), s.text));
    });
    titles.append(line);
    for (const s of sub) if (s.zh) titles.append(h('p', { class: 'card-sub card-sub--zh' }, s.zh));
  }

  // 收藏 is a ginkgo leaf, filled when on, an outline when off (only on this phone)
  const starBtn = h('button', { class: 'round star-btn', type: 'button', 'aria-pressed': String(Boolean(ctx.starred)), 'aria-label': '收藏（銀杏葉，只存在這支手機）' }, leaf(ctx.starred ? '' : 'off'));
  starBtn.addEventListener('click', () => {
    const on = ctx.toggleStar ? Boolean(ctx.toggleStar(place.id)) : false;
    ctx.starred = on;
    starBtn.setAttribute('aria-pressed', String(on));
    starBtn.replaceChildren(leaf(on ? '' : 'off'));
  });
  const closeBtn = h('button', { class: 'round', type: 'button', 'aria-label': '關閉', onclick: () => closeCard() }, icon('i-close'));
  return h('div', { class: 'card-head sheet-drag' }, titles, h('div', { class: 'sheet-acts' }, starBtn, closeBtn));
}

/** 前一站 · 今天第 N 站 · 下一站: where this place sits in my stops today (only for a place that is one of them). */
function buildStrip(place, ctx) {
  const s = ctx.strip;
  if (!s) return null;
  const side = (kind, stop) => {
    if (!stop) return h('span', { class: `adj-side ${kind} is-empty`, 'aria-hidden': 'true' });
    const label = kind === 'prev' ? '前一站' : '下一站';
    const time = stop.time ? h('span', { class: 'num' }, ` ${stop.time}`) : null;
    const lead = kind === 'prev'
      ? [icon('i-chevron-left'), label, time]
      : [label, time, icon('i-chevron-right')];
    return h('button', { class: `adj-side ${kind}`, type: 'button', 'aria-label': `${label}${stop.time ? ` ${stop.time}` : ''} ${stop.name}`, onclick: () => ctx.openStop?.(stop.placeId) },
      h('i', null, lead), h('b', null, stop.name));
  };
  const mid = h('div', { class: 'adj-mid' },
    h('b', null, s.time || '今天'),
    h('i', null, s.time ? `今天第 ${s.index + 1} 站` : `第 ${s.index + 1} 站`));
  return h('div', { class: 'adj', role: 'group', 'aria-label': `今天行程的前後站，這是第 ${s.index + 1} 站，共 ${s.total} 站` }, side('prev', s.prev), mid, side('next', s.next));
}

/** "由 X 新增" / "幫 X 帶": X may be Korean, then the whole phrase gets a Chinese line with X translated. */
function tagWithName(tr, before, name, after) {
  const zh = hasHangul(name) ? zhOf(name, tr) : null;
  return h('span', { class: 'tx' }, before, h('span', koreanAttrs(name), name), after, zh ? h('span', { class: 'zh' }, `${before}${zh}${after}`) : null);
}

const num = (n) => h('span', { class: 'num' }, String(n));

/** 「再 6 小時 50 分打烊」 as nodes: the numbers in the numeral face. */
function leftNodes(min) {
  const hrs = Math.floor(min / 60);
  const mins = min % 60;
  return ['再 ', hrs ? [num(hrs), ' 小時 '] : null, mins ? [num(mins), ' 分'] : null, '打烊'];
}

/** 「2 小時後開」 / 「45 分後開」 as nodes. */
const opensNodes = (min) => (min >= 60 ? [num(Math.round(min / 60)), ' 小時後開'] : [num(min), ' 分後開']);

/** The mock's price line: label ........ value. `big` false: a text value that may wrap (smaller). */
const priceLine = (label, value, { big = true } = {}) => h('div', { class: 'ml' },
  h('dt', null, label), h('i', { class: 'ld' }), h('dd', { class: big ? undefined : 'sm' }, value));

/**
 * The facts on the taped white paper: opening hours as price lines (「每日 ····· 11:00–21:00」) with 營業中 / 再 N 打烊 under them, then
 * the distance (only when the phone has given my position; straight-line metres and the walking minutes). null when there is
 * neither. Hours the Sheet has not confirmed show 待確認, never a time as fact (place-view.js hoursCard).
 */
function buildPaper(place, ctx) {
  const tr = ctx.translations;
  const kids = [h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' })];
  const hc = hoursCard(place, ctx.now ?? new Date());
  let any = false;
  if (hc) {
    any = true;
    if (hc.rows.length === 0 && hc.status?.tone === 'pending') kids.push(priceLine('營業時間', '待確認', { big: false })); // (checked hours always come with a value row, see hoursCard)
    hc.rows.forEach((r, i) => {
      if (r.value) kids.push(priceLine(r.label, r.value.length > 12 ? textWithZh(r.value, tr) : r.value, { big: r.value.length <= 12 }));
      else kids.push(priceLine(i === 0 ? '營業時間' : '', textWithZh(r.text, tr), { big: false }));
    });
    const st = hc.status;
    if (st?.tone === 'open') kids.push(h('div', { class: 'sub' }, h('span', { class: 'open' }, '營業中'), st.leftMin ? h('span', null, leftNodes(st.leftMin)) : null));
    else if (st?.tone === 'closed') kids.push(h('div', { class: 'sub' }, h('span', null, '已打烊'), st.opensInMin ? h('span', null, opensNodes(st.opensInMin)) : null));
    else if (st?.tone === 'pending' && hc.rows.length > 0) kids.push(h('div', { class: 'sub' }, badge('pending', st.badge)));
  }
  const here = ctx.here?.();
  if (here && hasCoords(place)) {
    const m = distanceMeters(here, { lat: toCoord(place.lat), lng: toCoord(place.lng) });
    if (Number.isFinite(m)) {
      any = true;
      const shown = m < 1000 ? [num(Math.max(10, Math.round(m / 10) * 10)), h('small', null, ' m')] : [num((m / 1000).toFixed(1)), h('small', null, ' km')];
      kids.push(priceLine('距離', shown));
      kids.push(h('div', { class: 'sub' }, h('span', null, '直線距離 ・ 步行約 ', num(walkMinutes(m)), ' 分')));
    }
  }
  return any ? h('dl', { class: 'facts', 'aria-label': '營業時間與距離' }, kids) : null;
}

/** 分類 · 誰想去 as ruled rows: the category's round mark, the five people (the ones who want to go filled), n/5. */
function buildRows(place, ctx) {
  const tr = ctx.translations;
  const cat = categoryOf(place.category);
  const rows = [];
  const catTags = [famDot(cat, 'fdot--sm'), cat.label];
  if (place.source === 'recommend') catTags.push(h('span', { class: 'tag tag--rec' }, '推薦'));
  if (place.source === 'app') catTags.push(h('span', { class: 'tag tag--added' }, tagWithName(tr, '由 ', clean(place.added_by) || '朋友', ' 新增')));
  rows.push(h('div', { class: 'row' }, h('dt', null, '分類'), h('dd', null, catTags)));
  const names = whoNames(place);
  rows.push(h('div', { class: 'row row--who' }, h('dt', null, '誰想去'),
    h('dd', { role: 'group', 'aria-label': '誰想去' },
      PEOPLE.map((p) => {
        const on = names.includes(p.name);
        const me = p.name === ctx.person;
        return h('span', { class: `ini${on ? ' is-on' : ''}`, 'aria-label': `${p.name}${me ? '（我）' : ''}${on ? ' 想去' : ' 沒有說想去'}` }, h('span', { 'aria-hidden': 'true' }, p.initial, me ? h('small', null, '我') : null));
      }),
      h('span', { class: 'who-n' }, `${names.length}/${PEOPLE.length}`))));
  return h('dl', { class: 'rows' }, rows);
}

function buildMine(place, ctx) {
  const mine = personalFor(place, ctx.person, ctx.purchases ?? []);
  if (mine.items.length === 0 && mine.recs.length === 0) return null;
  const kids = [];
  if (mine.items.length) {
    const own = mine.items.filter((i) => !i.forWhom);
    const others = mine.items.filter((i) => i.forWhom);
    kids.push(h('p', { class: 'mine-label' }, '你的購物清單'));
    const tr = ctx.translations;
    kids.push(limitedList([...own, ...others], (i) => h(
      'li', null,
      inlineWithZh(tr, [{ text: i.brand, strong: true }, { text: i.item, sep: ' ' }, { text: i.remark, sep: ' — ', cls: 'mine-note' }]),
      i.forWhom ? h('span', { class: 'tag tag--for' }, tagWithName(tr, '幫 ', i.forWhom, ' 帶')) : null,
    )));
  }
  if (mine.recs.length) {
    const tr = ctx.translations;
    kids.push(h('p', { class: 'mine-label' }, '推薦你試'));
    kids.push(limitedList(mine.recs, (r) => h('li', null, inlineWithZh(tr, [{ text: r.name, strong: true }, { text: r.why, sep: ' — ' }]))));
  }
  return section('mine', `給你的（${ctx.person}）`, kids);
}

/** A list that shows the first few rows and a "還有 N 項" button, so a long purchase list cannot push the navigation buttons off the card's first view. */
function limitedList(rows, renderRow, limit = 3) {
  const ul = h('ul', { class: 'mine-list' }, rows.slice(0, limit).map(renderRow));
  if (rows.length > limit) {
    const more = h('button', { class: 'more-btn', type: 'button' }, `還有 ${rows.length - limit} 項`);
    more.addEventListener('click', () => {
      more.parentElement.remove();
      ul.append(...rows.slice(limit).map(renderRow));
      relayout();
    });
    ul.append(h('li', { class: 'more' }, more));
  }
  return ul;
}

// iOS: try the Naver app via its URL scheme; if this page is still visible 1.5 s later the app did not open -> web.
// One check at a time for the whole page (repeated taps do not stack timers); see fallback-guard.js.
const iosGuard = createFallbackGuard({
  ms: IOS_FALLBACK_MS,
  isHidden: () => document.hidden,
  watchHide(onHide) {
    const onVis = () => { if (document.hidden) onHide(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); };
  },
});
const iosFallback = (fallbackUrl, go) => iosGuard.arm(() => go(fallbackUrl));

const navigateTo = (ctx) => ctx.navigate ?? ((url) => { window.location.href = url; });

/**
 * The Naver walking link of a place as an <a> with class `cls` and the given children: the same target, platform handling (the iOS
 * app scheme with a web fallback, the Android intent) and no-coordinates fallback everywhere it is used (the card, the hotel card,
 * the 今日菜單's next stop).
 */
export function naverLink(place, ctx, cls, ...children) {
  const platform = ctx?.platform ?? detectPlatform({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  const naver = naverTarget(place, platform);
  const attrs = { class: cls, href: naver.href };
  if (naver.kind === 'web') { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
  if (naver.kind === 'app') attrs.onclick = () => iosFallback(naver.fallback, navigateTo(ctx ?? {}));
  return h('a', attrs, ...children);
}

/** The Naver / Google capsules with their hint (also used by the hotel card): same links, platform handling and no-coordinates fallback. */
export function buildNav(place, ctx = {}) {
  const naverBtn = naverLink(place, ctx, 'navbtn naver', 'Naver 步行', h('span', { class: 'chip-ink' }, icon('i-arrow')));
  const googleBtn = h('a', { class: 'navbtn google', href: googleUrl(place), target: '_blank', rel: 'noopener noreferrer' }, 'Google 大眾運輸');
  return h('div', { class: 'nav-block' },
    h('div', { class: 'go' }, naverBtn, googleBtn),
    h('p', { class: 'nav-hint' }, HINT),
    hasCoords(place) ? null : h('p', { class: 'nav-hint nav-hint--warn' }, '這家的位置還沒確認，兩顆按鈕都改用店名搜尋。'));
}

function buildSplit(place, ctx) {
  const defaultDesc = clean(place.name_zh) || clean(place.name_kr) || clean(place.name_en);
  const amount = h('input', { id: 'split-amount', class: 'field', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', placeholder: '例如 30000', 'aria-describedby': 'split-error' });
  const desc = h('input', { id: 'split-desc', class: 'field', type: 'text', autocomplete: 'off', maxlength: '80', value: defaultDesc });
  const error = h('p', { id: 'split-error', class: 'field-error', role: 'alert' });
  const form = h('form', { class: 'split-form', novalidate: true },
    h('label', { class: 'field-label', for: 'split-amount' }, '金額（韓元，整數）'), amount,
    h('label', { class: 'field-label', for: 'split-desc' }, '說明'), desc,
    error,
    h('button', { class: 'btn btn--primary', type: 'submit' }, icon('i-receipt'), '記一筆'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = parseAmount(amount.value);
    if (n === null) {
      error.textContent = '請輸入整數金額（韓元），例如 30000';
      amount.setAttribute('aria-invalid', 'true');
      amount.focus();
      return;
    }
    error.textContent = '';
    amount.removeAttribute('aria-invalid');
    navigateTo(ctx)(lightsplitShareUrl(n, clean(desc.value) || defaultDesc || '消費'));
  });
  const groupUrl = safeHttpsUrl(ctx.config?.lightsplit_group_url);
  return section('split', '記一筆（LightSplit）',
    form,
    h('p', { class: 'nav-hint' }, '會開 LINE，選分帳群組後按送出。'),
    groupUrl ? h('a', { class: 'btn btn--ghost', href: groupUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('i-users'), '開分帳群組') : null);
}

function buildDetails(place, ctx) {
  const tr = ctx.translations;
  const rows = [];
  const row = (label, ...kids) => h('div', { class: 'row row--top' }, h('dt', null, label), h('dd', { class: 'row-wrap' }, kids));
  const area = clean(place.area);
  if (area) rows.push(row('區域', textWithZh(area, tr)));
  const sv = signatureView(place);
  if (sv) rows.push(row('招牌', sv.pending ? badge('pending', '待確認') : null, sv.text ? textWithZh(sv.text, tr) : null));
  const addr = clean(place.address_kr);
  if (addr) rows.push(row('地址', textWithZh(addr, tr, place.address_zh)));
  else if (clean(place.address_zh)) rows.push(row('地址', h('span', { class: 'tx' }, clean(place.address_zh))));
  const phone = clean(place.phone);
  if (phone) {
    const tel = phone.replace(/[^\d+]/g, '');
    rows.push(row('電話', tel ? h('a', { class: 'link', href: `tel:${tel}` }, icon('i-phone'), phone) : phone));
  }
  const note = clean(place.note);
  if (note) rows.push(row('備註', textWithZh(note, tr)));
  return rows.length ? h('dl', { class: 'rows details' }, rows) : null;
}

function buildCard(place, ctx) {
  const head = buildHeader(place, ctx);
  const nav = buildNav(place, ctx);
  const content = h('div', { class: 'sheet-content' },
    head,
    buildStrip(place, ctx),
    buildPaper(place, ctx),
    buildRows(place, ctx),
    buildMine(place, ctx),
    nav,
    h('div', { class: 'nav-end' }),
    buildSplit(place, ctx),
    buildDetails(place, ctx));
  return { content, head, nav, end: content.querySelector('.nav-end') };
}

// ---- sheet mechanics --------------------------------------------------------------------------------------

function ensureSheet() {
  if (els) return els;
  const grab = h('button', { class: 'sheet-grab sheet-drag', type: 'button', 'aria-expanded': 'false', 'aria-label': '展開或收合店家資訊' }); // invisible: the curved edge is the handle
  const scroll = h('div', { class: 'sheet-scroll' });
  const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-label': '店家資訊', tabindex: '-1', hidden: true }, sheetEdge(), grab, scroll);
  document.body.append(sheet);
  els = { sheet, grab, scroll, content: null, head: null, nav: null, end: null };

  scroll.addEventListener('scroll', updateStuck, { passive: true });
  sheet.addEventListener('pointerdown', onDown); // move / up are listened for on window while a drag is in progress (a mouse leaves the sheet)
  grab.addEventListener('click', () => {
    if (performance.now() < suppressClickUntil) return;
    snapTo(state.mode === 'full' ? 'peek' : 'full');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open) closeCard(); });
  window.addEventListener('resize', () => { if (state.open) layout(); });
  document.fonts?.ready.then(() => { if (state.open) layout(); });
  return els;
}

let settleTimer = 0;

/**
 * The sheet is `px` tall and anchored to the bottom edge; its content is anchored to its top, so it rides up with the edge.
 * `animate`: the drawer slides there with a transform (css/app.css .sheet transitions `transform`, never `height`): growing, the new
 * height is set at once and the drawer starts translated down by the difference and slides to 0; shrinking, it slides down by the
 * difference first and takes the room back when it has arrived. While a finger drags it (`is-dragging`) the height follows it directly.
 */
function setVis(px, { animate = false } = {}) {
  const { sheet } = els;
  const before = state.vis;
  const height = `${Math.round(px)}px`;
  state.vis = px;
  root().style.setProperty('--sheet-h', `${Math.round(px)}px`);
  root().classList.toggle('sheet-tall', px > window.innerHeight * 0.5);
  root().classList.toggle('sheet-open', px > 0);
  clearTimeout(settleTimer);
  const jump = (extra) => { // no transition for this change
    sheet.style.transition = 'none';
    extra();
    void sheet.offsetHeight;
    sheet.style.transition = '';
  };
  if (!animate || px === before) {
    jump(() => { sheet.style.height = height; sheet.style.transform = ''; });
  } else if (px > before) {
    jump(() => { sheet.style.height = height; sheet.style.transform = `translateY(${px - before}px)`; });
    sheet.style.transform = ''; // the transition slides it up to where it belongs
  } else {
    sheet.style.transform = `translateY(${before - px}px)`; // slides down; the height follows once it has arrived
    settleTimer = setTimeout(() => jump(() => { sheet.style.height = height; sheet.style.transform = ''; }), SNAP_MS);
  }
  updateStuck();
}

/** How much of the drawer's bottom edge the tab bar covers (it stays on screen over the card). */
function coveredByTabbar() {
  const bar = document.getElementById('tabbar');
  return bar ? Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top)) : 0;
}

/** While the navigation buttons would fall below the part of the card the tab bar leaves visible they stay pinned above it (CSS sticky). */
function updateStuck() {
  if (!els?.end || !els.nav) return;
  els.nav.classList.toggle('is-stuck', els.end.offsetTop - els.scroll.scrollTop > els.scroll.clientHeight - coveredByTabbar() - TAB_GAP + 1);
}

/** Measure the content. peek = everything down to the navigation buttons (capped); full = everything (capped). */
function layout() {
  const { sheet, scroll, content, end, grab } = els;
  const vh = window.innerHeight;
  const chrome = scroll.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
  state.fullH = Math.round(Math.min(chrome + content.offsetHeight, vh * MAX_SHEET));
  const toNav = chrome + end.offsetTop + coveredByTabbar() + TAB_GAP; // `end` sits right after the navigation block; the tab bar and a small gap go under it
  state.peekH = Math.round(clamp(toNav, Math.min(220, state.fullH), Math.min(vh * MAX_PEEK, state.fullH)));
  grab.setAttribute('aria-expanded', String(state.mode === 'full'));
  setVis(state.open ? (state.mode === 'full' ? state.fullH : state.peekH) : 0);
}

const relayout = () => { if (state.open) layout(); };

function snapTo(mode) {
  state.mode = mode;
  els.grab.setAttribute('aria-expanded', String(mode === 'full'));
  setVis(mode === 'full' ? state.fullH : state.peekH, { animate: true });
}

function onDown(e) {
  if (!state.open || !e.target.closest('.sheet-drag')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  drag = { id: e.pointerId, y0: e.clientY, vis0: state.vis, moved: false, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.abs(dy) < 6) return;
    drag.moved = true;
    els.sheet.classList.add('is-dragging');
    root().classList.add('sheet-dragging');
  }
  setVis(clamp(drag.vis0 - dy, 0, state.fullH));
  const dt = e.timeStamp - drag.lastT;
  if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt; // px/ms, positive = moving down
  drag.lastY = e.clientY;
  drag.lastT = e.timeStamp;
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  if (!d.moved) return; // a plain tap: the buttons inside handle it themselves
  els.sheet.classList.remove('is-dragging');
  root().classList.remove('sheet-dragging');
  suppressClickUntil = performance.now() + 350;
  const projected = state.vis - d.v * 160; // where the flick would land
  const snaps = [['close', 0], ['peek', state.peekH], ['full', state.fullH]];
  const [target] = snaps.reduce((best, s) => (Math.abs(s[1] - projected) < Math.abs(best[1] - projected) ? s : best));
  if (target === 'close') closeCard(); else snapTo(target);
}

// ---- public API -------------------------------------------------------------------------------------------

export const cardPlaceId = () => (state.open ? state.place?.id ?? null : null);
export const cardVisibleHeight = () => (state.open ? state.vis : 0);

/** `keepState` (a redraw with fresh data, e.g. after a poll): an already open card stays peeking / expanded and keeps its scroll position. */
export function openCard(place, ctx = {}, { keepState = false } = {}) {
  ensureSheet();
  const { sheet, scroll } = els;
  const wasOpen = state.open;
  const keep = keepState && wasOpen;
  const prevMode = state.mode;
  const prevScroll = scroll.scrollTop;
  clearTimeout(state.closeTimer);
  if (!wasOpen) {
    state.prevFocus = document.activeElement;
    releaseBack = holdBack(() => closeCard()); // the Back button closes the card instead of leaving the app
  }

  state.place = place;
  state.ctx = { ...ctx };
  const built = buildCard(place, state.ctx);
  els.content = built.content;
  els.head = built.head;
  els.nav = built.nav;
  els.end = built.end;
  scroll.replaceChildren(built.content);
  scroll.scrollTop = 0;

  state.mode = keep ? prevMode : 'peek';
  sheet.hidden = false;
  if (!wasOpen) sheet.classList.add('no-anim');
  state.open = true;
  layout(); // sizes the sheet to its content
  if (keep) scroll.scrollTop = prevScroll;
  if (!wasOpen) {
    setVis(0);
    void sheet.offsetHeight; // commit the zero height before sliding up to the open one
    sheet.classList.remove('no-anim');
    setVis(state.peekH, { animate: true });
  }
  sheet.classList.add('is-open');
  if (!keep) sheet.focus({ preventScroll: true });
}

export function closeCard() {
  if (!state.open) return;
  const { sheet } = els;
  const ctx = state.ctx;
  state.open = false;
  releaseBack?.();
  releaseBack = null;
  sheet.classList.remove('is-open');
  setVis(0, { animate: true });
  state.closeTimer = setTimeout(() => { if (!state.open) sheet.hidden = true; }, SNAP_MS + 30);
  const prev = state.prevFocus;
  state.prevFocus = null;
  if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
  state.place = null;
  state.ctx = null;
  try { ctx?.onClose?.(); } catch (e) { console.error(e); }
}
