// lat/lng arrive from the Sheet as strings (or numbers when built in code); String() covers both.
const coord = (v) => String(v).trim();

export function googleDirUrl({ lat, lng }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(lat)},${coord(lng)}&travelmode=transit`;
}

// Naver Map: `app` (iOS custom scheme), `intent` (Android, falls back to `web`), `web` (search page).
export function naverLinks(place, appname) {
  const name = place.name_kr || place.name_zh || '';
  const dname = encodeURIComponent(name);
  const query = `dlat=${coord(place.lat)}&dlng=${coord(place.lng)}&dname=${dname}&appname=${encodeURIComponent(appname)}`;
  const web = `https://map.naver.com/p/search/${dname}`;
  return {
    app: `nmap://route/walk?${query}`,
    intent: `intent://route/walk?${query}#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=${encodeURIComponent(web)};end`,
    web,
  };
}

const text = (v) => String(v ?? '').trim();
const HANGUL_SYLLABLE = /[가-힣]/g;
const SHORT_NAME_SYLLABLES = 2; // a Korean name this short ("핑") finds too many shops alone, so the area's Korean name follows it

/**
 * What to search Naver Map for to land on a shop's own page: its Korean name; a name of SHORT_NAME_SYLLABLES Hangul syllables or fewer
 * gets the area's Korean name after it (`areaKr`, '' when the area has none). No Korean name: the Korean address, else the Chinese
 * name, else the English one.
 */
export function naverShopQuery(place, areaKr = '') {
  const kr = text(place?.name_kr);
  if (kr) {
    const area = text(areaKr);
    return (kr.match(HANGUL_SYLLABLE) ?? []).length <= SHORT_NAME_SYLLABLES && area ? `${kr} ${area}` : kr;
  }
  return text(place?.address_kr) || text(place?.name_zh) || text(place?.name_en);
}

// Naver Map's search for the shop (its own page: hours, photos, reviews, Naver's 길찾기 button): same three forms as naverLinks().
export function naverShopLinks(place, appname, areaKr = '') {
  const q = encodeURIComponent(naverShopQuery(place, areaKr));
  const web = `https://map.naver.com/p/search/${q}`;
  const query = `query=${q}&appname=${encodeURIComponent(appname)}`;
  return {
    app: `nmap://search?${query}`,
    intent: `intent://search?${query}#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=${encodeURIComponent(web)};end`,
    web,
  };
}

// Opens LINE's share sheet pre-filled with a Lightsplit command (amount in whole KRW).
export function lightsplitShareUrl(amount, desc) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive integer, got ${amount}`);
  }
  return 'https://line.me/R/share?text=' + encodeURIComponent(`@Lightsplit ${amount} KRW ${desc}`);
}
