// What the map shows when the app opens (pure: no DOM, no Leaflet): one Seoul district, never the whole trip.
//
// The trip also has a pin in Gwangju and one in Jeonju, 270 km away: fitting every pin made the first view a country-sized map where
// all the Seoul pins were one blob and no district name could show. So the pins that count for a view of "everything" are the ones
// within SEOUL_RADIUS_M of Seoul City Hall, and the first view is one district of them. The pin that chooses it is today's next stop,
// else tonight's hotel (a place without coordinates is no pin):
//   it names a district (its area is not empty and not "Seoul")  -> that area
//   else the area whose lobe it lies in                          -> that area
//   else the nearest area centre within NEAR_AREA_M              -> that area
//   else                                                         -> the pin itself, zoom 16
//   it is farther than SEOUL_RADIUS_M from Seoul City Hall       -> the pin itself, zoom 15 (a Jeonju or Gwangju day)
// With no such pin (no stop left, no hotel for tonight): the area with the most pinned places. The chosen pin is always in the frame.
import { NOT_AREAS, areaLobes, lobeAt } from './area-lobes.js';
import { distanceMeters } from './geo.js';
import { hasCoords, isHidden, toCoord } from './place-view.js';

export const SEOUL_CITY_HALL = Object.freeze({ lat: 37.5663, lng: 126.9779 });
export const SEOUL_RADIUS_M = 40_000;
/** The first view's zoom stays between these: a district, not the whole city and not a single doorway. */
export const FIRST_ZOOM = Object.freeze({ min: 14, max: 16 });
/** A pin that names no district and lies in no lobe belongs to the nearest area whose centre is within this many metres. */
export const NEAR_AREA_M = 1500;
/** The zoom of a first view that is one pin: near Seoul (it is in no district), and far from Seoul (a day in another city). */
export const PIN_ZOOM = Object.freeze({ seoul: 16, far: 15 });

const areaOf = (place) => String(place?.area ?? '').trim();
const pointOf = (place) => ({ lat: toCoord(place.lat), lng: toCoord(place.lng) });
const latLng = (place) => [toCoord(place.lat), toCoord(place.lng)];

/** A place that is on the map: not hidden and with coordinates (anywhere). */
const isPinned = (place) => Boolean(place) && !isHidden(place) && hasCoords(place);

/** Whether a place has coordinates within SEOUL_RADIUS_M of Seoul City Hall. */
export const isNearSeoul = (place) => Boolean(place) && hasCoords(place) && distanceMeters(pointOf(place), SEOUL_CITY_HALL) <= SEOUL_RADIUS_M;

/** The pins that count for any "fit everything" view: not hidden, with coordinates, near Seoul. */
export const seoulPins = (places) => (Array.isArray(places) ? places : []).filter((p) => p && !isHidden(p) && isNearSeoul(p));

/** The area with the most pinned places near Seoul (a tie: the first by name); '' when no pin there has an area. */
function busiestArea(pins) {
  const counts = new Map();
  for (const p of pins) {
    const area = areaOf(p);
    if (!NOT_AREAS.has(area)) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  let best = '';
  for (const [area, n] of counts) {
    if (best === '' || n > counts.get(best) || (n === counts.get(best) && area < best)) best = area;
  }
  return best;
}

/** The district of a pin near Seoul that names none: the area whose lobe it lies in, else the nearest area centre within NEAR_AREA_M, else ''. */
function districtAround(pin, pins) {
  const inLobe = lobeAt(areaLobes(pins), latLng(pin));
  if (inLobe) return inLobe.area;
  const sums = new Map(); // area -> [lat sum, lng sum, count]
  for (const p of pins) {
    const area = areaOf(p);
    if (NOT_AREAS.has(area)) continue;
    const s = sums.get(area) ?? [0, 0, 0];
    sums.set(area, [s[0] + toCoord(p.lat), s[1] + toCoord(p.lng), s[2] + 1]);
  }
  let best = '';
  let bestM = Infinity;
  for (const [area, [la, ln, n]] of sums) {
    const m = distanceMeters(pointOf(pin), { lat: la / n, lng: ln / n });
    if (m <= NEAR_AREA_M && (m < bestM || (m === bestM && area < best))) { best = area; bestM = m; }
  }
  return best;
}

/**
 * What the first view shows: {area, include, zoom}.
 *   area     the district ('' for a view that is one pin, or when there is no district at all)
 *   include  the places that must be in the frame (the pin that chose the view; [] when none did)
 *   zoom     a number when the view is that one pin at that zoom (PIN_ZOOM), else null
 * `next`: the place of today's next stop, `hotel`: the place of tonight's hotel (either may be null): see the header for the order.
 */
export function chooseFirstView({ places, next = null, hotel = null } = {}) {
  const pin = [next, hotel].find(isPinned) ?? null;
  const pins = seoulPins(places);
  if (pin && !isNearSeoul(pin)) return { area: '', include: [pin], zoom: PIN_ZOOM.far };
  if (pin) {
    const own = areaOf(pin);
    const area = NOT_AREAS.has(own) ? districtAround(pin, pins) : own;
    return area === '' ? { area: '', include: [pin], zoom: PIN_ZOOM.seoul } : { area, include: [pin], zoom: null };
  }
  return { area: busiestArea(pins), include: [], zoom: null };
}

/**
 * The points a view has to show, [[lat, lng], ...]: with an `area`, its pins that lie in its lobe (a pin of the same area far from the
 * rest, such as a park a kilometre away, is outside the lobe and does not stretch the view into a map of dots), the point of the lobe
 * where the big district name is written (below the pins), so the name shows with them, and the `include` places that are near Seoul
 * (the pin that chose the view stays in frame even when it lies outside the lobe); the yellow coast itself may run past the screen's
 * edge, as in the design's far view. An area with no lobe (under 3 pins): all its pins. Without an area (or when it has no pin near
 * Seoul): every pin near Seoul. [] when there is none (the map then stays where it is).
 */
export function viewPoints(places, area = '', { include = [] } = {}) {
  const pins = seoulPins(places);
  if (area === '') return pins.map(latLng);
  const points = pins.filter((p) => areaOf(p) === area).map(latLng);
  if (points.length === 0) return viewPoints(places, '');
  const extra = include.filter((p) => isPinned(p) && isNearSeoul(p)).map(latLng);
  const lobe = areaLobes(pins).find((l) => l.area === area);
  if (!lobe) return [...points, ...extra];
  const core = points.filter((pt) => lobeAt([lobe], pt) !== null);
  return [...(core.length > 0 ? core : points), lobe.label, ...extra];
}

/**
 * How the map frames a chooseFirstView() result: {points, must, minZoom, maxZoom}. `points`: what to fit; `must`: the points that have
 * to stay on screen even when the zoom limit would cut them off; minZoom / maxZoom: the zoom limits (a view that is one pin: both its
 * zoom; a district: FIRST_ZOOM; no district at all: only a maximum of 16, a fit of every pin near Seoul).
 */
export function viewFrame(places, view = {}) {
  const { area = '', include = [], zoom = null } = view ?? {};
  const pinned = include.filter(isPinned).map(latLng);
  if (zoom !== null && pinned.length > 0) return { points: pinned, must: pinned, minZoom: zoom, maxZoom: zoom };
  const points = viewPoints(places, area, { include });
  if (area === '') return { points, must: [], minZoom: undefined, maxZoom: FIRST_ZOOM.max };
  return { points, must: include.filter((p) => isPinned(p) && isNearSeoul(p)).map(latLng), minZoom: FIRST_ZOOM.min, maxZoom: FIRST_ZOOM.max };
}
