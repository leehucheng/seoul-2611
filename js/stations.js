// The subway stations the vector map names (app/map-style.json layer `station-label`), and the line badges drawn in front of the name.
// Pure (no DOM, no globals) so Node tests run it; ui/station-badges.js draws the badges.
//
// The OpenFreeMap tiles name a station POI in Korean (`name`: "성수", sometimes "성수역") and carry Chinese names that are Simplified, or
// missing. So the style does not read the tile's Chinese: it matches the Korean `name` against this table and writes the Traditional Chinese
// name from it, with the lines as badges. A station that is not in the table gets no label (its dot stays). The table is the one decided for
// the trip's stations; do not add stations or lines to it without deciding it again.
//
// STATIONS: {kr: 'the Korean name (the tile's `name`), without 역', zh: 'Traditional Chinese name', lines: ['2', '7', '水仁盆唐', ...]}
// tests/stations.test.mjs checks app/map-style.json against this table.

export const STATIONS = Object.freeze([
  { kr: '성수', zh: '聖水站', lines: ['2'] },
  { kr: '뚝섬', zh: '纛島站', lines: ['2'] },
  { kr: '서울숲', zh: '首爾林站', lines: ['水仁盆唐'] },
  { kr: '건대입구', zh: '建大入口站', lines: ['2', '7'] },
  { kr: '안국', zh: '安國站', lines: ['3'] },
  { kr: '경복궁', zh: '景福宮站', lines: ['3'] },
  { kr: '종로3가', zh: '鐘路3街站', lines: ['1', '3', '5'] },
  { kr: '광화문', zh: '光化門站', lines: ['5'] },
  { kr: '시청', zh: '市廳站', lines: ['1', '2'] },
  { kr: '을지로입구', zh: '乙支路入口站', lines: ['2'] },
  { kr: '명동', zh: '明洞站', lines: ['4'] },
  { kr: '회현', zh: '會賢站', lines: ['4'] },
  { kr: '서울역', zh: '首爾站', lines: ['1', '4', '機場鐵路', '京義中央'] },
  { kr: '홍대입구', zh: '弘大入口站', lines: ['2', '機場鐵路', '京義中央'] },
  { kr: '신촌', zh: '新村站', lines: ['2'] },
  { kr: '압구정', zh: '狎鷗亭站', lines: ['3'] },
  { kr: '압구정로데오', zh: '狎鷗亭羅德奧站', lines: ['水仁盆唐'] },
  { kr: '강남', zh: '江南站', lines: ['2', '新盆唐'] },
  { kr: '신논현', zh: '新論峴站', lines: ['9', '新盆唐'] },
  { kr: '한강진', zh: '漢江鎮站', lines: ['6'] },
  { kr: '이태원', zh: '梨泰院站', lines: ['6'] },
  { kr: '녹사평', zh: '綠莎坪站', lines: ['6'] },
  { kr: '삼각지', zh: '三角地站', lines: ['4', '6'] },
  { kr: '용산', zh: '龍山站', lines: ['1', '京義中央'] },
  { kr: '신용산', zh: '新龍山站', lines: ['4'] },
  { kr: '잠실', zh: '蠶室站', lines: ['2', '8'] },
  { kr: '혜화', zh: '惠化站', lines: ['4'] },
  { kr: '동대문', zh: '東大門站', lines: ['1', '4'] },
  { kr: '동대문역사문화공원', zh: '東大門歷史文化公園站', lines: ['2', '4', '5'] },
  { kr: '김포공항', zh: '金浦機場站', lines: ['5', '9', '機場鐵路'] },
]);

/** Both ways a tile may write a station's name: "성수" and "성수역" (for 서울역: "서울역" and "서울"). */
export const stationForms = (kr) => (kr.endsWith('역') ? [kr, kr.slice(0, -1)] : [kr, `${kr}역`]);

/** The real colours of the Seoul lines (numbered lines, and the named ones the table uses). */
export const LINE_COLORS = Object.freeze({
  1: '#0052A4', 2: '#00A84D', 3: '#EF7C1C', 4: '#00A5DE', 5: '#996CAC', 6: '#CD7C2F', 7: '#747F00', 8: '#E6186C', 9: '#BDB092',
  水仁盆唐: '#F5A200', 新盆唐: '#D4003B', 機場鐵路: '#0090D2', 京義中央: '#77C4A3',
});

const INK = '#2C2E2A';
const WHITE = '#FFFFFF';

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };

/** WCAG contrast ratio of two #RRGGBB colours (1 to 21). */
export const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** The colours of a line's badge: its own colour, with white text, or ink text where white would not stand out (contrast below 3:1: light colours). Unknown line: a neutral grey. */
export function badgeColors(line) {
  const bg = LINE_COLORS[line] ?? '#8A8579';
  return { bg, fg: contrast(bg, WHITE) >= 3 ? WHITE : INK };
}

/** The image id the style asks for to draw a station's badges: `stn:2,7` (ui/station-badges.js makes it when MapLibre asks). */
export const badgeId = (lines) => `stn:${lines.join(',')}`;

/** The lines in an image id made by badgeId(); null for any other id (or one that names a line this table does not know). */
export function linesOfBadgeId(id) {
  if (typeof id !== 'string' || !id.startsWith('stn:')) return null;
  const lines = id.slice(4).split(',');
  return lines.length > 0 && lines.every((l) => Object.hasOwn(LINE_COLORS, l)) ? lines : null;
}
