// 行李清單: the November packing checklist (ui/packing.js shows it). Static content, copied from the packing page the group read on
// 2026-11-03: 8 groups of items, the 11-day weather strip, the two city lines, the facts, the rules and the footer. Nothing here is
// fetched; the only per-phone state is which items are ticked (packing-ticks.js).
//
// Text that holds a link or a bold run is an array of parts: a plain string, {b: 'bold'} or {a: 'link text', href}.
// An item has a `tag`: 'm' (「11 月」: not on the July list, new this time) or 'r' (「規定有變」: the rule differs from the July list), or none.
import { TRIP_FIRST, TRIP_LAST } from './today-view.js';

export const PACKING_CHECKED = '2026-11-03'; // the day the weather and the rules were looked up
export const PACKING_TITLE = '首爾十一月行李';
export const PACKING_LEAD = '11/6 起冷空氣南下，11/7 最冷（低 −2°）。約 17:30 日落，午後空氣偏乾。';

/** The two item tags: the label on the item, and what it means (the key under the total). */
export const PACKING_TAGS = Object.freeze({
  m: Object.freeze({ label: '11 月', note: '7 月清單沒有、這次新加' }),
  r: Object.freeze({ label: '規定有變', note: '和 7 月清單寫的不一樣' }),
});

const item = (id, name, why, tag) => Object.freeze(tag ? { id, name, why, tag } : { id, name, why });
const group = (id, title, hint, items) => Object.freeze({ id, title, hint, items: Object.freeze(items) });

export const PACKING_GROUPS = Object.freeze([
  group('g-docs', '證件・錢・票', '出發前一晚再核對一次', [
    item('pk-passport', '護照', '效期夠、拍照存雲端'),
    item('pk-earrival', '電子入境卡（e-Arrival Card）', '入境前 3 天內線上填，先確認', 'r'),
    item('pk-ticket', '電子機票／登機證', '截圖存手機，離線可看'),
    item('pk-hotel', '訂房確認＋韓文地址', '計程車、問路都用得到'),
    item('pk-cash', '韓元現金（小額）', '小額零用，其餘刷卡'),
    item('pk-card', '海外可刷的信用卡', '出發前確認海外已開通'),
    item('pk-tmoney', 'T-money 交通卡', '落地便利店買，可儲值'),
  ]),
  group('g-power', '3C・電源', '韓國 220V／60Hz、圓孔插座', [
    item('pk-charger', '手機＋充電線＋充電器', '標示 100–240V 才能直插'),
    item('pk-adapter', '韓國轉接頭（Type C/F 圓孔）', '台灣扁腳插不進，多帶 1 個'),
    item('pk-powerbank', '行動電源', '手提、每人 ≤2 顆、機上不能用', 'r'),
    item('pk-110v', '吹風機、電棒等 110V 專用電器：不帶', '220V 會燒壞，用飯店的'),
    item('pk-data', '網路（eSIM 或分享器）', '落地就能叫車、查地圖'),
  ]),
  group('g-warm', '保暖衣物', '洋蔥式：內層薄、外層可脫', [
    item('pk-thermal', '發熱衣（貼身內層）', '11/7–10 低溫約 −2～2°', 'm'),
    item('pk-legging', '發熱褲或內搭褲', '低溫日穿，天暖可脫', 'm'),
    item('pk-mid', '針織衫或刷毛中層', '室內暖氣熱，要能脫', 'm'),
    item('pk-outer', '防風或羽絨外套', '11/6 陣風約 45–50km/h', 'm'),
    item('pk-socks', '保暖襪（多帶 1–2 雙）', '走路多，腳先冷', 'm'),
    item('pk-shoes', '舒適好走的鞋', '要防滑，早晨可能結冰', 'm'),
  ]),
  group('g-acc', '保暖配件・雨具', '最冷的是 11/7 前後', [
    item('pk-scarf', '圍巾', '擋風，脖子最有感', 'm'),
    item('pk-gloves', '手套（可觸控）', '傍晚體感近 0°', 'm'),
    item('pk-beanie', '毛帽或耳罩', '清晨低溫 0° 上下', 'm'),
    item('pk-warmer', '暖暖包', '11/7 前後備幾片', 'm'),
    item('pk-umbrella', '折疊傘', '11/5 上午有雨約 5 mm', 'm'),
  ]),
  group('g-dry', '乾燥保養', '午後濕度可低到約 27%（模式）', [
    item('pk-lip', '護唇膏', '冷風加乾燥，隨身放', 'm'),
    item('pk-hand', '護手霜', '冷風加乾燥，先護手', 'm'),
    item('pk-moist', '保濕乳液／面霜', '乾冷空氣，加強保濕'),
    item('pk-mask-face', '保濕面膜', '上飛機、回房間都能敷'),
    item('pk-drops', '人工淚液（戴隱形者）', '乾燥加暖氣，眼睛易乾', 'm'),
    item('pk-spf', '防曬乳', '晴天 UV 指數約 3–4（模式）'),
  ]),
  group('g-care', '個人・盥洗', '液體手提：每瓶 ≤100 ml', [
    item('pk-meds', '個人藥品（腸胃、止痛、感冒）', '日夜溫差大，易著涼'),
    item('pk-tooth', '牙刷牙膏', '飯店常不提供，自備'),
    item('pk-lens', '隱形眼鏡＋備用眼鏡', '乾燥日備好以防乾澀'),
    item('pk-skin', '保養品分裝（每瓶 ≤100 ml）', '手提液體的上限'),
    item('pk-mask', '口罩', '擋風保暖，也能遮素顏'),
    item('pk-tissue', '濕紙巾／面紙', '擦手、清潔都用得到'),
  ]),
  group('g-shop', '購物・行李空間', '冬衣占位，回程會更滿', [
    item('pk-space', '去程行李留空位', '冬衣占空間，戰利品更多'),
    item('pk-tote', '可折疊購物袋', '戰利品分裝、回程用'),
    item('pk-bag2', '輕便第二個包／可摺大袋', '放不下時救急', 'm'),
    item('pk-scale', '行李秤', '回程怕超重，先秤再收', 'm'),
    item('pk-compress', '壓縮收納袋', '冬衣體積大，壓縮省空間'),
    item('pk-bubble', '氣泡袋／防撞包材', '玻璃瓶、香水防破'),
    item('pk-liquid', '超過 100 ml 的液體：放託運', '免稅密封袋例外'),
  ]),
  group('g-opt', '選配・有行程才帶', '沒有就整組跳過', [
    item('pk-ticket2', '演唱會或活動票券＋證件', '票券截圖離線備份'),
    item('pk-stick', '應援棒＋備用電池', '鋰電池類要手提'),
    item('pk-clinic', '醫美術後：口罩、保濕、防曬', '依診所術後衛教準備'),
    item('pk-work', '遠端工作：筆電＋耳機', '筆電、耳機、充電器放一起'),
  ]),
]);

/** Every item id, in the order of the page; and how many there are (the N in 「N/46」). */
export const PACKING_IDS = Object.freeze(PACKING_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
export const PACKING_TOTAL = PACKING_IDS.length;

// ---- weather: 11/5-11/15 in Seoul ---------------------------------------------------------------------------------

// `cold`: the chip is tinted (the low is 0° or below); `range`: the day is given as a range; `avg`: not a forecast, the November average.
const day = (dom, weekday, hi, lo, cue, src, flags = {}) => Object.freeze({ date: `2026-11-${String(dom).padStart(2, '0')}`, md: `11/${dom}`, weekday, hi, lo, cue, src, ...flags });

export const PACKING_WEATHER = Object.freeze({
  title: '首爾天氣 11/5–11/15',
  days: Object.freeze([
    day(5, '四', '15°', '10°', '上午下雨 約 5 mm', 'KMA＋模式'),
    day(6, '五', '8–12°', '0–3°', '轉冷 陣風 45–50 km/h', '模式', { range: true }),
    day(7, '六', '7°', '−2°', '最冷 低於 0° 有風', 'KMA', { cold: true }),
    day(8, '日', '8°', '0°', '多雲 降雨 20%', 'KMA', { cold: true }),
    day(9, '一', '10°', '2°', '晴 降雨 10%', 'KMA'),
    day(10, '二', '12°', '1°', '晴 降雨 10%', 'KMA'),
    day(11, '三', '13°', '4°', '晴 降雨 10%', 'KMA'),
    day(12, '四', '14°', '4°', '晴 降雨 10%', 'KMA'),
    day(13, '五', '15°', '5°', '晴 降雨 10%', 'KMA'),
    day(14, '六', '12°', '4°', '11 月平均 非預報', '往年平均', { avg: true }),
    day(15, '日', '12°', '4°', '11 月平均 非預報', '往年平均', { avg: true }),
  ]),
  legend: [{ b: '圖例' }, '　KMA＝氣象署官方預報　模式＝數個預報模型彙整　虛線＝往年平均（不是預報）　底色＝低溫 0° 以下'],
  notes: Object.freeze([
    [
      { b: '資料查於 2026-11-03。' },
      '11/7–11/13 的首爾高低溫與降雨機率＝',
      { a: 'KMA 中期預報', href: 'https://www.weather.go.kr/w/weather/forecast/mid-term.do?stnId=109' },
      '（11/3 06:00 發布）。11/5 雨量＝',
      { a: 'KMA 短期預報', href: 'https://www.weather.go.kr/w/weather/forecast/short-term.do' },
      '（11/3 11:00 發布）。KMA 對 11/5–6 只給全國範圍、沒有首爾數字，這兩天的氣溫改取 ',
      { a: 'Met Office', href: 'https://weather.metoffice.gov.uk/forecast/wydjw5fb9' },
      '、',
      { a: 'yr.no', href: 'https://www.yr.no/en/forecast/daily-table/2-1835848/South%20Korea/Seoul/Seoul' },
      '、',
      { a: 'meteoblue', href: 'https://www.meteoblue.com/en/weather/week/seoul_south-korea_1835848' },
      '、',
      { a: 'Open-Meteo（ECMWF）', href: 'https://open-meteo.com/' },
      '四家的數字。11/5 取多數家接近的值（高約 15°、低約 10°；Met Office 的低溫 5° 是例外）；11/6 四家差得多，所以給範圍。',
    ],
    [
      '11/14–15 超出預報範圍，這兩格只是 11 月平均（高 11.9／低 3.5，KMA 1991–2020 平年，經 ',
      { a: 'Wikipedia', href: 'https://en.wikipedia.org/wiki/Seoul' },
      ' 轉載），不是預報。meteoblue 與 ECMWF 模式給這兩天約 16–17°／7–10°，比平均暖，信心低，不當預報用。預報會變，11/4 出發前再看一次 KMA。',
    ],
  ]),
});

/** The trip's two cities outside Seoul (about 11/10-11/14): the box under the weather strip. */
export const PACKING_CITIES = Object.freeze({
  title: '全州・光州',
  lines: Object.freeze([
    Object.freeze({ name: '全州', text: '11/10–13：低 2–5°／高 13–16°，晴，降雨 10%。' }),
    Object.freeze({ name: '光州', text: '11/10–13：低 4–6°／高 14–17°，晴，降雨 10%。' }),
  ]),
  note: 'KMA 中期預報（11/3 06:00 發布）；11/14 超出範圍，沒有數字。',
});

// ---- 11 月為什麼這樣帶 ---------------------------------------------------------------------------------------------

const fact = (head, body) => Object.freeze({ head, body: Object.freeze(body) });

export const PACKING_FACTS = Object.freeze({
  title: '11 月為什麼這樣帶',
  items: Object.freeze([
    fact('冷空氣 11/6–7 南下。', [
      'KMA：7 日早晨比 6 日低 5–10°，部分內陸日夜溫差 ≥10°；7–10 日比平年偏冷，11–13 日接近平年或略低（',
      { a: 'KMA 中期預報', href: 'https://www.weather.go.kr/w/weather/forecast/mid-term.do?stnId=109' },
      '，11/3）。',
    ]),
    fact('風。', [
      '模式預報 11/6 陣風約 45–50 km/h、11/7 約 35–45 km/h（Met Office、ECMWF）。模式算的體感：11/7 清晨約 −6°，11/6–8 傍晚約 −2～0°（',
      { a: 'Open-Meteo', href: 'https://open-meteo.com/' },
      '，11/3 15:39 查）。河邊這類空曠處風更大，體感會更低（這句是推論，沒有河邊的數據）。',
    ]),
    fact('乾。', ['模式預報 11/6、11/7、11/9 午後相對濕度約 27%，11/5 約 61%（Open-Meteo）。']),
    fact('霜與冰。', [
      '首爾 10/29 已觀測到今秋第一次霜，平年是 10/28（',
      { a: '報導引用氣象署', href: 'https://www.wikitree.co.kr/articles/1170130' },
      '）。11/7–11/10 預報低溫 −2～2°，清晨路面可能結霜結冰（推論），鞋底要防滑。第一次結冰的日期未查到來源。',
    ]),
    fact('日落早。', [
      '約 17:30（11/5）到 17:21（11/15）；日落後約半小時天色明顯暗下來（',
      { a: 'sunrise-sunset.org', href: 'https://sunrise-sunset.org/api' },
      ' 計算）。',
    ]),
    fact('室內暖。', [
      '韓國家庭冬季室內平均約 22–25°（研究，',
      { a: 'Herald 2025-12-03', href: 'https://www.heraldk.com/article/2025120304400050601' },
      '）；所以內層薄、外層好脫。11 月初暖氣開多大，未查到來源。',
    ]),
    fact('雨雪。', ['11/5 上午下雨約 5 mm（KMA 短期，11/3 11:00）；之後 KMA 預報降雨機率 10–20%，沒有降雪。']),
  ]),
});

// ---- 規定：已查／出發前再確認 --------------------------------------------------------------------------------------

// `state`: 'ok' (checked) or 'chk' (check again before leaving); `status` is the pill's text.
const rule = (title, state, status, paras, links = []) => Object.freeze({ title, state, status, paras: Object.freeze(paras), links: Object.freeze(links.map(([text, href]) => Object.freeze({ text, href }))) });

export const PACKING_RULES = Object.freeze({
  title: '規定：已查／出發前再確認',
  items: Object.freeze([
    rule('行動電源', 'ok', '台灣官方已確認', [
      ['民航局 2026-04-02 公告，4/8 起：每人最多 2 個、只能手提不能託運、機上不能使用也不能充電。容量：100 Wh 以下可帶，100–160 Wh 要航空公司同意（民航局 2023 舊公告，沒找到新版）。'],
      ['韓國籍航空另有要求（媒體 2026-01-26：不可放行李架、孔口貼絕緣膠帶，未讀到韓國官方原文）。', { b: '出發前再確認所搭航空公司。' }],
    ], [
      ['民航局公告', 'https://www.caa.gov.tw/NewsPublish-Content.aspx?a=381&nid=2547&lang=1'],
      ['今周刊 韓國航空', 'https://www.businesstoday.com.tw/article/category/183030/post/202601260029/%E5%8E%BB%E9%9F%93%E5%9C%8B%E6%B3%A8%E6%84%8F%EF%BC%815%E5%AE%B6%E9%9F%93%E5%9C%8B%E8%88%AA%E7%A9%BA%E6%A9%9F%E4%B8%8A%E7%A6%81%E7%94%A8%E8%A1%8C%E5%8B%95%E9%9B%BB%E6%BA%90%E3%80%81%E7%B5%95%E7%B7%A3%E8%86%A0%E5%B8%B6%E6%80%8E%E9%BA%BC%E8%B2%BC%EF%BC%9F%E9%80%99%E4%BA%9B%E5%85%A8%E4%B8%8D%E8%83%BD%E5%B8%B6%E3%80%8C%E9%80%A3EVA%E9%83%BD%E9%99%90%E5%88%B6%E3%80%8D%E8%A6%8F%E5%AE%9A%E4%B8%80%E6%AC%A1%E7%9C%8B'],
    ]),
    rule('K-ETA', 'ok', '期限已確認', [
      ['韓國法務部把暫時免申請延到 2026-12-31（外交部駐外館公告 2025-12-29），本次行程在期限內。台灣在名單內這點，是 EY 2026-01-05 的報導，不是官方公告原文。', { b: '出發前到官網再看一次。' }],
    ], [
      ['官方公告', 'https://overseas.mofa.go.kr/us-en/brd/m_4500/view.do?seq=761106'],
      ['EY 報導', 'https://globaltaxnews.ey.com/news/2026-0101-korea-extends-temporary-electronic-travel-authorization-exemption-until-31-december-2026'],
      ['K-ETA 官網', 'https://www.k-eta.go.kr'],
    ]),
    rule('電子入境卡', 'chk', '出發前再確認', [
      ['EY 2025-12-11 報導：2026-01-01 起外國人入境須線上申請，入境前 3 天內填，另有少數例外。官方網站的內文讀不到，沒能核對例外名單。'],
    ], [
      ['EY 報導', 'https://taxnews.ey.com/news/2025-2474'],
      ['官方網站', 'https://www.e-arrivalcard.go.kr'],
    ]),
    rule('插座與電壓', 'ok', '已查（非官方）', [
      ['韓國 220V／60Hz，插頭 Type C、F（圓孔）；台灣 110V／60Hz，Type A、B（維基整理的各國電力表，不是官方）。充電器標示 100–240V 才能直接插，只標 110V 的電器不要帶。'],
    ], [
      ['各國電力表', 'https://en.wikipedia.org/wiki/Mains_electricity_by_country'],
    ]),
    rule('手提液體', 'ok', '兩地機場官網已確認', [
      ['每瓶容器 ≤100 ml，全部裝進一個 1 公升透明夾鏈袋。仁川機場：免稅店買的液體放免稅密封袋，到最後一段航班前不拆，不受 100 ml 限制。'],
    ], [
      ['桃園機場', 'https://taoyuan-airport.com/main_ch/docdetail.aspx?docid=132&mc=&pid=12&uid=337'],
      ['仁川機場', 'https://www.airport.kr/ap_en/1434/subview.do'],
    ]),
    rule('託運行李重量', 'chk', '出發前再確認', [
      ['額度依航空公司與票種不同，沒有統一數字。看訂位資料，回程要多留購物的重量。'],
    ]),
  ]),
});

/** The footer: the first line is bold. */
export const PACKING_FOOTER = Object.freeze([
  '勾選只存在這支手機，不會同步給其他人。',
  '天氣與規定都查於 2026-11-03，之後可能更新。沒有來源的事沒寫成事實，標了「推論」或「再確認」。',
]);

// ---- the card on the 今天 page ---------------------------------------------------------------------------------------

/** The short line on the 今天 card, by the day the page shows: only the first and the last trip day have the card. */
export const PACKING_CARD_LINES = Object.freeze({
  [TRIP_FIRST]: '出發前一晚再核對一次',
  [TRIP_LAST]: '回程：行李秤、留空位、液體託運',
});

/** The line of the card for a day (YYYY-MM-DD), or null when the card does not show that day. */
export const packingCardLine = (iso) => (Object.hasOwn(PACKING_CARD_LINES, iso) ? PACKING_CARD_LINES[iso] : null);
