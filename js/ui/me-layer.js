// "Me" on the map: a blue dot with a white ring, a soft circle for the GPS accuracy, and, when the way I face is known, a fading wedge
// (docs/design/g2b/dir-g2b.html). Nothing else on the map is blue. The heading comes from js/heading.js: the way I move while I walk,
// the phone's compass while I stand; when neither is known there is no wedge (a wrong one is worse than none).
// The wedge turns with the compass at most once per animation frame (the compass sends ~60 events a second).
//
//   const me = createMeLayer(map)
//   me.show(coords)            // a position fix (coords of a GeolocationPosition) -> {lat, lng} | null (no usable position: nothing changes)
//   me.startCompass({ask})     // begin listening; `ask` = this runs inside a tap, so iOS may show its permission prompt
//                              -> 'granted' | 'denied' | 'unsupported' | 'prompt' (iOS, not asked yet: waits for the locate button)
//   me.setViewShown(on)        // false while a full-height view covers the map: the compass listeners come off (and back when shown again)
//   me.last()                  // {lat, lng} of the last fix, or null
import { TOKENS } from '../colors.js';
import {
  angleDiff, headingChanged, headingFromCoords, headingFromEvent, pickHeading, requestCompassPermission, smoothHeading,
} from '../heading.js';

const ME_HTML = '<div class="me-dot no-heading" role="img" aria-label="我的位置">'
  + '<svg class="me-cone" viewBox="-1 -1 2 2" aria-hidden="true" focusable="false"><path d="M0 0 L-.5 -.866 A1 1 0 0 1 .5 -.866 Z" fill="url(#me-cone-g)"/></svg>'
  + '<i></i></div>';
const TURN_STEP = 0.35; // share of the remaining turn done per frame
const SETTLED_DEG = 0.5; // smoothHeading arrives exactly, so this means "arrived"

export function createMeLayer(map, { win = window } = {}) {
  let marker = null;
  let circle = null;
  let last = null;
  let travel = null; // direction of travel from the last fix, while moving
  let compass = null; // the phone's compass
  let shown = null; // the angle on the screen
  let raf = 0;
  let listening = false; // are the orientation listeners on right now
  let compassAllowed = false; // the compass answered the permission (always, off iOS) in startCompass()
  let viewShown = true;
  const pageShown = () => !win.document?.hidden;

  const dotEl = () => marker?.getElement()?.querySelector('.me-dot') ?? null;

  function paint() {
    raf = 0;
    const el = dotEl();
    if (!el) return;
    const target = pickHeading({ travel, compass });
    if (target === null) { el.classList.add('no-heading'); shown = null; return; }
    shown = smoothHeading(shown, target, TURN_STEP);
    el.style.setProperty('--hd', `${shown}deg`);
    el.classList.remove('no-heading');
    if (Math.abs(angleDiff(shown, target)) > SETTLED_DEG) raf = win.requestAnimationFrame(paint); // keep turning until it has arrived
  }
  const schedule = () => { if (!raf) raf = win.requestAnimationFrame(paint); };

  function show(coords) {
    const lat = Number(coords?.latitude);
    const lng = Number(coords?.longitude);
    if (coords?.latitude === null || coords?.longitude === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    last = { lat, lng };
    const accuracy = Number(coords.accuracy);
    if (!marker) {
      marker = L.marker([lat, lng], {
        interactive: false, keyboard: false, zIndexOffset: 3000,
        icon: L.divIcon({ className: 'me-icon', html: ME_HTML, iconSize: [0, 0], iconAnchor: [0, 0] }),
      }).addTo(map);
      circle = L.circle([lat, lng], {
        radius: 0, interactive: false, color: TOKENS.me, weight: 1, opacity: 0.34, fillColor: TOKENS.me, fillOpacity: 0.13,
      }).addTo(map);
    }
    marker.setLatLng([lat, lng]);
    circle.setLatLng([lat, lng]);
    circle.setRadius(Number.isFinite(accuracy) && accuracy > 0 && accuracy < 500 ? accuracy : 0);
    travel = headingFromCoords(coords);
    schedule();
    sync(); // the first fix is the first dot: the compass may start now
    return { lat, lng };
  }

  function onOrientation(e) {
    const h = headingFromEvent(e);
    if (h === null) return; // a relative reading, or an uncalibrated compass
    if (!headingChanged(compass, h)) return; // a shaking hand: under 2 degrees is not worth a repaint
    compass = h;
    schedule();
  }

  // The compass is listened to only while it can be seen: the person allowed it, there is a dot, the map view is shown and the page is
  // visible. A sensor that sends ~60 events a second for a whole trip day is a battery bill for a wedge nobody is looking at.
  const sync = () => {
    const on = compassAllowed && viewShown && pageShown() && marker !== null;
    if (on === listening) return;
    try {
      const op = on ? 'addEventListener' : 'removeEventListener';
      win[op]('deviceorientationabsolute', onOrientation, true); // Android Chrome: alpha counts from north
      win[op]('deviceorientation', onOrientation, true); // iOS: webkitCompassHeading
      listening = on;
    } catch { /* no event target: no compass */ }
  };
  try { win.document.addEventListener('visibilitychange', sync); } catch { /* no document events: the view switch still stops it */ }

  /** Android needs no permission; on iOS `ask` must be true and the call must come straight from a tap. */
  function startCompass({ ask = false } = {}) {
    const Ctor = win.DeviceOrientationEvent;
    const needsPrompt = typeof Ctor?.requestPermission === 'function';
    if (needsPrompt && !ask) return Promise.resolve('prompt'); // not from a tap: iOS would refuse; wait for the locate button
    const answer = requestCompassPermission(Ctor); // called now, synchronously: still inside the tap
    return answer.then((state) => {
      if (state === 'granted') { compassAllowed = true; sync(); }
      return state;
    });
  }

  /** The map view is shown (true) or covered by a full-height view such as 今天 (false). */
  function setViewShown(on) {
    viewShown = Boolean(on);
    sync();
  }

  return { show, startCompass, setViewShown, last: () => last, heading: () => pickHeading({ travel, compass }), listening: () => listening };
}
