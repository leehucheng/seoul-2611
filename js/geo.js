// Straight-line distance and a walking-time estimate. Pure, no I/O.

const EARTH_RADIUS_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in meters between two {lat, lng} points. */
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Walking minutes for a straight-line distance: streets add ~30% detour, pace is 75 m/min; rounded up. */
export const walkMinutes = (meters) => Math.ceil((meters * 1.3) / 75);
