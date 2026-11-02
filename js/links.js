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

// Opens LINE's share sheet pre-filled with a Lightsplit command (amount in whole KRW).
export function lightsplitShareUrl(amount, desc) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive integer, got ${amount}`);
  }
  return 'https://line.me/R/share?text=' + encodeURIComponent(`@Lightsplit ${amount} KRW ${desc}`);
}
