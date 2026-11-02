// Colours of the ginkgo fold-out look (docs/design/g2b/dir-g2b.html). Pure, no DOM.
//   TOKENS    the fixed palette. app.css repeats these values under :root (CSS cannot import JS); tests/style-colors.test.mjs
//             keeps the two lists equal.
//   FAMILIES  a pin / tile is a solid family colour with its icon drawn in the family's `on` colour (>= 3:1, tested). The twelve
//             categories sit in these families (categories.js); the icon tells the exact category inside a family.
// There is no per-person colour: people are an ink circle (me) or an outlined initial.

export const TOKENS = Object.freeze({
  cream: '#F5F1E4',
  ink: '#2C2E2A',
  white: '#FFFFFF',
  paper: '#FFFEF8',
  ginkgo: '#F3C10A',
  ginkgoPale: '#FFEEA8',
  ginkgoDeep: '#C99400',
  coral: '#FF705D',
  pond: '#2BA0FF',
  leaf: '#3FAE5A',
  brown: '#5B4636',
  lilac: '#B79CF0',
  ink2: '#4F514C',
  ink3: '#686964',
  me: '#1A73E8',
});

const family = (id, label, color, on) => Object.freeze({ id, label, color, on });

export const FAMILIES = Object.freeze({
  eat: family('eat', '吃', TOKENS.coral, TOKENS.ink),
  sweet: family('sweet', '甜點咖啡', TOKENS.brown, TOKENS.cream),
  shop: family('shop', '逛街', TOKENS.pond, TOKENS.ink),
  culture: family('culture', '景點展覽', TOKENS.leaf, TOKENS.ink),
  night: family('night', '夜晚', TOKENS.lilac, TOKENS.ink),
  stay: family('stay', '住宿', TOKENS.ink, TOKENS.cream),
  other: family('other', '其他', TOKENS.ink3, TOKENS.cream), // a place whose category is not one of the twelve
});

/** WCAG relative luminance of '#RRGGBB'; NaN for anything else. */
export function luminance(hex) {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return NaN;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21) of two '#RRGGBB' colours, order does not matter; 0 when either is malformed (so it can never pass a check). */
export function contrastRatio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  if (Number.isNaN(la) || Number.isNaN(lb)) return 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
