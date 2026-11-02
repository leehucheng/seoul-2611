// Which way I face, for the heading cone on my blue dot. Null means "not known": then no cone is drawn (a wrong cone is worse than none).
//   moving      coords.heading of a position fix, when the speed is above ~0.5 m/s (standing still the GPS course is noise)
//   standing    the phone's compass: Android Chrome `deviceorientationabsolute` (alpha counts anticlockwise from north, so 360 - alpha),
//               iOS Safari `webkitCompassHeading` (already clockwise from north; asking for it needs a permission, requested inside a tap)
// Pure functions only (events and constructors come in as arguments), so they run in Node tests.

export const MOVING_MPS = 0.5;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** Degrees -> a whole number 0..359 (359.6 is north, not 360). */
const norm = (deg) => ((Math.round(deg) % 360) + 360) % 360;

/** headingFromEvent(e) -> 0..359 | null, from a DeviceOrientationEvent. */
export function headingFromEvent(e) {
  if (!e || typeof e !== 'object') return null;
  if (finite(e.webkitCompassHeading)) {
    if (finite(e.webkitCompassAccuracy) && e.webkitCompassAccuracy < 0) return null; // iOS: -1 = the compass is not calibrated
    return norm(e.webkitCompassHeading);
  }
  const absolute = e.absolute === true || e.type === 'deviceorientationabsolute'; // a relative alpha counts from wherever the phone started
  if (absolute && finite(e.alpha)) return norm(360 - e.alpha);
  return null;
}

/** headingFromCoords(coords) -> 0..359 | null: the direction of travel, only while I am really moving. */
export function headingFromCoords(coords) {
  if (!coords || !finite(coords.heading) || !finite(coords.speed) || coords.speed <= MOVING_MPS) return null;
  return norm(coords.heading);
}

/** The heading to draw: the way I move beats the compass; the compass fills in while I stand; else null. */
export function pickHeading({ travel = null, compass = null } = {}) {
  if (finite(travel)) return travel;
  if (finite(compass)) return compass;
  return null;
}

/** Shortest signed turn from `from` to `to`, -180..180 (350 -> 10 is +20). */
export function angleDiff(from, to) {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d; // straight behind: +180, not -180
}

/** Is `next` worth showing after `prev`? The first heading always; then only a turn of `minDeg` degrees or more (a hand shakes a degree or two). */
export function headingChanged(prev, next, minDeg = 2) {
  if (!finite(next)) return false;
  if (!finite(prev)) return true;
  return Math.abs(angleDiff(prev, next)) >= minDeg;
}

/** One smoothing step toward `next` (0 < k <= 1), the short way round north. The first heading, and a lost one, pass as they are. */
export function smoothHeading(prev, next, k = 0.35) {
  if (!finite(next)) return finite(prev) ? prev : null;
  if (!finite(prev)) return norm(next);
  const turn = angleDiff(prev, next);
  if (Math.abs(turn) <= 1) return norm(next); // the last degree is taken in one step: rounding must never stall it a degree short
  const step = turn * k;
  return norm(prev + (Math.abs(step) < 1 ? Math.sign(turn) : step)); // always at least a degree, so it arrives
}

/**
 * iOS 13+ shows a permission prompt for the compass, and only from inside a tap. `DeviceOrientationEventCtor` is the global
 * DeviceOrientationEvent: with no `requestPermission` (Android, desktop) nothing needs asking. -> 'granted' | 'denied' | 'unsupported'. Never throws.
 */
export async function requestCompassPermission(DeviceOrientationEventCtor) {
  if (!DeviceOrientationEventCtor) return 'unsupported';
  if (typeof DeviceOrientationEventCtor.requestPermission !== 'function') return 'granted';
  try {
    return (await DeviceOrientationEventCtor.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
