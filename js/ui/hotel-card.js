// 飯店韓文卡: a full-screen card made to be shown to a taxi driver. The hotel's Korean name and Korean address are
// large, each with its smaller Chinese line under it (for the people holding the phone), then the phone (a tel: link)
// and the same Naver / Google buttons as the place card.
//
// initHotel(app) sets app.actions.hotel and app.openHotelCard(dateISO?): the hotel for the night that starts on that date
// (no date: tonight, app.currentNightDate()).
import { hotelCardView } from '../hotel-view.js';
import { categoryOf } from '../place-view.js';
import { formatMD, isISODate, loadTripData, stayLabel } from '../today-view.js';
import { buildToday } from '../today.js';
import { append, clear, famDot, h, icon } from './dom.js';
import { buildNav } from './card.js';
import { closeButton, createPanel } from './panel.js';

const signatureOf = (app) => JSON.stringify([
  app.me, app.snapshot?.tabs?.Hotel, app.translations,
  app.places.filter((p) => p.category === 'hotel').map((p) => [p.id, p.name_zh, p.name_kr, p.name_en, p.aliases, p.hidden, p.lat, p.lng, p.address_kr, p.address_zh, p.phone]),
]);

export function initHotel(app) {
  function openHotelCard(dateArg) {
    if (!app.snapshot) {
      app.showToast('資料還沒載入好，等一下再按一次');
      return null;
    }
    app.closeCard();

    const date = isISODate(dateArg) ? dateArg : app.currentNightDate(); // before 06:00 "tonight" is still the night that began yesterday
    const state = { sig: '' };
    const title = h('h2', { class: 'panel-title' });
    const head = h('header', { class: 'panel-head' }, null, title);
    const body = h('div', { class: 'panel-body hc-body' });
    const offs = [];
    const panel = createPanel({ cls: 'panel--hotel', label: '飯店', view: 'hotel', onClose: () => offs.forEach((off) => off()) });
    head.prepend(closeButton(panel));
    append(panel.dialog, [head, body]);

    function render() {
      const scroll = body.scrollTop;
      const trip = loadTripData(app.snapshot?.tabs);
      const stay = buildToday(trip, app.me, date).hotel;
      const v = hotelCardView({ stay, places: app.places, translations: app.translations });
      const tonight = date === app.currentNightDate();
      title.textContent = tonight ? '今晚住哪' : `${formatMD(date)} 晚住哪`;

      const parts = [];
      if (v.kind === 'none') {
        const unreadable = trip.hotels.length === 0; // the Hotel tab itself gave nothing: do not say "the Sheet has no hotel"
        parts.push(h('div', { class: 'hc-none' }, icon('i-bed'),
          h('p', { class: 'hc-none-text' }, unreadable ? '飯店表讀不到。確認有網路，或到表上看看分頁有沒有被改名。' : v.text)));
      } else {
        parts.push(h('p', { class: 'hc-label hc-label--tile' }, famDot(categoryOf('hotel'), 'fdot--sm'), `${tonight ? '今晚住' : '這晚住'}（${stayLabel(v.stay)}）`));
        parts.push(h('section', { class: 'hc-block hc-paper' },
          h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }),
          h('h3', { class: `hc-name${v.name.korean ? ' kr' : ''}`, lang: v.name.korean ? 'ko' : undefined }, v.name.text),
          v.name.zh ? h('p', { class: 'hc-zh' }, v.name.zh) : null,
          v.others.map((o) => h('p', { class: 'hc-other' }, o))));
        if (v.address) {
          parts.push(h('section', { class: 'hc-block hc-paper' },
            h('span', { class: 'tape tl' }), h('span', { class: 'tape tr' }),
            h('p', { class: 'hc-label' }, '地址（給司機看）'),
            h('p', { class: `hc-addr${v.address.korean ? ' kr' : ''}`, lang: v.address.korean ? 'ko' : undefined }, v.address.text),
            v.address.zh ? h('p', { class: 'hc-zh' }, v.address.zh) : null));
        } else if (v.kind === 'found') {
          parts.push(h('p', { class: 'hc-warn' }, '韓文地址還沒查到。先給司機看上面的飯店名稱，或用下面的導航。'));
        }
        if (v.phone) {
          parts.push(h('section', { class: 'hc-block' },
            h('p', { class: 'hc-label' }, '電話'),
            v.phone.tel
              ? h('a', { class: 'btn btn--ghost hc-tel', href: `tel:${v.phone.tel}` }, icon('i-phone'), v.phone.text)
              : h('p', { class: 'hc-phone-text' }, v.phone.text)));
        }
        if (v.kind === 'unmapped') parts.push(h('p', { class: 'hc-warn' }, '地圖上還沒有這間飯店的資料，所以沒有韓文地址和電話。'));
        parts.push(buildNav(v.navPlace));
      }
      clear(body);
      append(body, parts);
      body.scrollTop = scroll;
      state.sig = signatureOf(app);
    }

    render();
    offs.push(app.on('snapshot', () => { if (signatureOf(app) !== state.sig) render(); }));
    offs.push(app.on('me', render));
    return panel;
  }

  app.openHotelCard = openHotelCard;
  app.actions.hotel = (dateISO) => openHotelCard(typeof dateISO === 'string' ? dateISO : undefined);
}
