// Place categories (pastel-consumer style: one hue + saturation per category, see colors.js).
//   color  the solid pin colour. Icons are drawn white on it, so every one keeps >= 3:1 contrast against #FFFFFF
//          (checked in tests/links-match.test.mjs and tests/style-colors.test.mjs).
//   tint   the pale tile / tag background; ink: the dark text and icon colour of the same hue on it (>= 4.5:1)
//   icon   an SVG <symbol> id in index.html
import { hslToHex, inkOf, tintOf } from './colors.js';

const category = (id, label, icon, hue, sat, lightness) => Object.freeze({
  id, label, icon, hue, sat, color: hslToHex(hue, sat, lightness), tint: tintOf(hue, sat), ink: inkOf(hue, sat),
});

export const CATEGORIES = [
  category('bbq', '烤肉', 'i-flame', 358, 78, 44),
  category('korean', '韓食/麵食', 'i-bowl', 58, 86, 31),
  category('seafood', '海鮮/醬蟹', 'i-fish', 198, 76, 36),
  category('dessert', '甜點', 'i-cake', 296, 52, 46),
  category('cafe', '咖啡廳', 'i-coffee', 28, 36, 38),
  category('bar', '酒吧/夜店', 'i-glass', 262, 56, 50),
  category('fashion', '衣服', 'i-shirt', 228, 72, 48),
  category('beauty', '美妝/香水', 'i-perfume', 330, 68, 48),
  category('art', '展覽/美術館', 'i-frame', 158, 60, 32),
  category('sight', '景點/銀杏', 'i-leaf', 104, 50, 32),
  category('night', '夜景/日落', 'i-moon', 30, 92, 44),
  category('hotel', '住宿', 'i-bed', 210, 14, 38),
];
