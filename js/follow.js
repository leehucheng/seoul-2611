// Follow-me (跟著我): while it is on, every new position of mine pans the map so I stay in view, at the zoom the person chose.
// Pure state: no DOM, no Leaflet. The map (ui/map.js) sends events, the locate button and the 「跟著我」 capsule show the state.
//
//   press  the locate button was tapped: not following -> follow (and centre on me); following -> stop
//   drag   the person moved the map with a finger: stop (they want to look elsewhere)
//   away   the app moved the map somewhere else (a pin was opened, 下一站, fit all): stop
//   lost   there is no position (denied, too slow): stop
//   fix    a new position arrived: nothing changes (the map reads the state to decide whether to pan)

export const LOCATE_WAIT_MS = 8000; // location already allowed (or refused): a fix that has not come by then is not coming
export const LOCATE_PROMPT_WAIT_MS = 60_000; // the phone may still be asking the person (location, and on iOS the motion sensors as well)

/** How long the first position is waited for, given the Permissions API state of 'geolocation' ('granted' | 'denied' | 'prompt' | anything else). */
export const locateWaitMs = (permissionState) => (permissionState === 'granted' || permissionState === 'denied' ? LOCATE_WAIT_MS : LOCATE_PROMPT_WAIT_MS);

export const FOLLOW_OFF = Object.freeze({ following: false });
const FOLLOW_ON = Object.freeze({ following: true });

/** followReducer(state, event) -> state. `event` is one of the words above, or {type}. Returns the same object when nothing changes. */
export function followReducer(state, event) {
  const cur = state && state.following === true ? state : FOLLOW_OFF;
  const type = typeof event === 'string' ? event : event?.type;
  switch (type) {
    case 'press': return cur.following ? FOLLOW_OFF : FOLLOW_ON;
    case 'drag':
    case 'away':
    case 'lost': return cur.following ? FOLLOW_OFF : cur;
    default: return cur;
  }
}
