// Place categories: twelve ids, six colour families (colors.js FAMILIES). A pin is the family colour with the category's icon drawn
// in the family's `on` colour (>= 3:1, checked in tests/style-colors.test.mjs and tests/links-match.test.mjs); the icon tells the
// exact category inside a family.
//   label  the full name (card, add form)       short  the filter capsule's word
//   icon   an SVG <symbol> id in index.html     family eat | sweet | shop | culture | night | stay
import { FAMILIES } from './colors.js';

const category = (id, label, short, icon, familyId) => Object.freeze({
  id, label, short, icon, family: familyId, color: FAMILIES[familyId].color, on: FAMILIES[familyId].on,
});

export const CATEGORIES = [
  category('bbq', '烤肉', '烤肉', 'i-flame', 'eat'),
  category('korean', '韓食/麵食', '韓食', 'i-bowl', 'eat'),
  category('seafood', '海鮮/醬蟹', '海鮮', 'i-fish', 'eat'),
  category('dessert', '甜點', '甜點', 'i-cake', 'sweet'),
  category('cafe', '咖啡廳', '咖啡', 'i-coffee', 'sweet'),
  category('bar', '酒吧/夜店', '酒吧', 'i-glass', 'night'),
  category('fashion', '衣服', '衣服', 'i-shirt', 'shop'),
  category('beauty', '美妝/香水', '美妝', 'i-perfume', 'shop'),
  category('art', '展覽/美術館', '展覽', 'i-frame', 'culture'),
  category('sight', '景點/銀杏', '景點', 'i-leaf', 'culture'),
  category('night', '夜景/日落', '夜景', 'i-moon', 'night'),
  category('hotel', '住宿', '住宿', 'i-bed', 'stay'),
];
