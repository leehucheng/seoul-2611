const MIN_SUBSTRING_LEN = 4; // shorter names are too ambiguous to find inside free text
const MIN_BRAND_LEN = 3;

export const normalizeName = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

// All normalized, non-empty names of a place: name_zh / name_kr / name_en plus each `|`-separated alias.
function namesOf(place) {
  const raw = [place.name_zh, place.name_kr, place.name_en, ...String(place.aliases ?? '').split('|')];
  return raw.map(normalizeName).filter(Boolean);
}

// Exact normalized match first (any place), then a name of >= 4 chars contained in the text.
export function matchPlace(text, places) {
  const t = normalizeName(text);
  if (!t) return null;
  const withNames = places.map((place) => ({ id: place.id, names: namesOf(place) }));
  const exact = withNames.find((p) => p.names.includes(t));
  if (exact) return exact.id;
  const sub = withNames.find((p) => p.names.some((n) => n.length >= MIN_SUBSTRING_LEN && t.includes(n)));
  return sub ? sub.id : null;
}

// Plan items that have no pin on the map and are not in the ignore list (compared normalized).
export function unmappedNames(names, places, ignore = []) {
  const skip = new Set(ignore.map(normalizeName));
  return names.filter((name) => !skip.has(normalizeName(name)) && matchPlace(name, places) === null);
}

// Purchases whose brand (>= 3 normalized chars) appears in the place's name or an alias.
export function itemsForPlace(place, purchases) {
  const names = namesOf(place);
  return purchases.filter((pu) => {
    const brand = normalizeName(pu.brand);
    return brand.length >= MIN_BRAND_LEN && names.some((n) => n.includes(brand));
  });
}
