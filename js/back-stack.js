// The phone's Back button (Android) and the iOS edge swipe close what is open on top of the map instead of leaving the app.
// Overlays (place card, add form, 今天 panel, hotel card, 還沒上地圖 list) call holdBack(close) when they open and the returned
// release() when they close by any route. While at least one is open the page has ONE extra history entry; Back pops it, closes the
// top overlay and, when another overlay is still open, puts the entry back so the next Back closes the next one. Closing with the
// × button (or anything else) takes the entry away again, after a tick: a close followed at once by an open (the 今天 panel handing
// over to a place card) never touches the history.
//
// createBackStack({pushState, back, schedule}) is the pure part (all three are injected, so it runs in Node tests);
// holdBack(close) is the browser binding (one shared stack on history / popstate, created on first use).

/**
 * -> {hold(close) -> release, onPopState(), size()}
 *   hold(close)   `close()` runs when Back is pressed and this overlay is the top one. It may return 'stay' (it used the Back press
 *                 for something smaller, such as leaving a pick-a-spot mode: the overlay stays open and keeps its place on top).
 *                 It need not call release(): after a Back close that does nothing.
 *   release()     the overlay was closed some other way; safe to call twice, or after Back closed it.
 *   onPopState()  call it from the window's popstate event.
 */
export function createBackStack({ pushState, back, schedule = (fn) => setTimeout(fn, 0) }) {
  const stack = [];
  let marker = false; // our extra history entry is the current one
  let expected = 0; // popstate events caused by our own back() that must be ignored

  function settle() {
    if (stack.length > 0 || !marker) return;
    marker = false;
    expected += 1;
    back();
  }

  function ensureMarker() {
    if (marker) return;
    pushState();
    marker = true;
  }

  function hold(close) {
    const entry = { close };
    stack.push(entry);
    ensureMarker();
    return function release() {
      const i = stack.indexOf(entry);
      if (i < 0) return;
      stack.splice(i, 1);
      if (stack.length === 0 && marker) schedule(settle);
    };
  }

  function onPopState() {
    if (expected > 0) { expected -= 1; return; }
    marker = false; // Back used up our entry
    const top = stack.pop();
    if (!top) return;
    let result;
    try { result = top.close(); } catch (e) { console.error(e); }
    if (result === 'stay') stack.push(top);
    if (stack.length > 0) ensureMarker(); // another overlay is open (or this one stayed): the next Back has an entry to use
  }

  return { hold, onPopState, size: () => stack.length };
}

let shared = null;

/** Register an open overlay -> release(), to call when it closes by any route. `close()` closes it when Back is pressed. */
export function holdBack(close) {
  if (!shared) {
    shared = createBackStack({ pushState: () => history.pushState({ seoulOverlay: true }, ''), back: () => history.back() });
    window.addEventListener('popstate', () => shared.onPopState());
  }
  return shared.hold(close);
}
