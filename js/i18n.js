// Korean -> Traditional Chinese helpers. Every Korean string the UI shows gets a smaller Chinese line
// under it; the translations come from the snapshot (`snapshot.translations`, made server side).
const HANGUL = /[가-힣]/;

export const hasHangul = (s) => typeof s === 'string' && HANGUL.test(s);

const HAN = /\p{Script=Han}/u;

/** A Han (Chinese) character anywhere in the string: what tells a name the readers can read from one that is only Latin or Korean. */
export const hasHan = (s) => typeof s === 'string' && HAN.test(s);

/**
 * The stored Chinese translation of a Korean string, or null (not Korean, no translation yet, or the
 * "translation" is empty / identical). Never throws, so a missing translation can never block the UI.
 */
export function zhOf(s, translations) {
  if (!hasHangul(s) || !translations || typeof translations !== 'object') return null;
  for (const key of [s, s.trim()]) {
    if (Object.hasOwn(translations, key)) {
      const zh = translations[key];
      if (typeof zh === 'string' && zh.trim() !== '' && zh.trim() !== s.trim()) return zh.trim();
    }
  }
  return null;
}
