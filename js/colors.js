// Colour helpers for the pastel-consumer style (pure, no DOM). A category or a person is one hue + one saturation:
//   solid  hsl(h s L)   the pin colour: a white icon on it must keep >= 3:1 (L is chosen per category in categories.js)
//   tint   hsl(h s 92%) the pale tile / tag background
//   ink    hsl(h s 24%) the dark text and icon colour of the same hue, drawn on the tint (>= 4.5:1, checked in tests)

/** hsl (hue 0-360, saturation and lightness 0-100) -> '#rrggbb' (lower case). */
export function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + (((h % 360) + 360) % 360) / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

export const TINT_LIGHTNESS = 92;
export const INK_LIGHTNESS = 24;

export const tintOf = (hue, sat) => hslToHex(hue, sat, TINT_LIGHTNESS);
export const inkOf = (hue, sat) => hslToHex(hue, sat, INK_LIGHTNESS);

/**
 * The one neutral grey pair (a place with an unknown category, a schedule item without a pin, the "closed" pill): a pale tint with
 * its dark ink, >= 4.5:1. app.css has the same two values as --closed-bg / --closed-ink; tests/style-colors.test.mjs checks they agree.
 */
export const NEUTRAL = Object.freeze({ tint: '#eef1f4', ink: '#3a3d40' });
