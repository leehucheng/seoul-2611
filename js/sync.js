// Pure helpers for keeping what the phone shows consistent with the server (no DOM): a just-added place that a
// stale poll must not hide, and "did the open card's data change" so it is only redrawn when it did.

export const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Places the app saved a moment ago but a snapshot may not contain yet (a poll that was already in flight, a mock
 * backend, Apps Script lagging). `pending` is a Map id -> {place, at}. A snapshot that has the id takes over and
 * the entry is dropped; one that does not gets the place appended; an entry older than ttlMs is dropped.
 * -> {places, pending}; neither argument is changed.
 */
export function mergePending(snapshotPlaces, pending, now = Date.now(), ttlMs = PENDING_TTL_MS) {
  const base = Array.isArray(snapshotPlaces) ? snapshotPlaces : [];
  const have = new Set(base.map((p) => p?.id));
  const keep = new Map();
  const extra = [];
  for (const [id, entry] of pending ?? []) {
    if (have.has(id) || now - entry.at > ttlMs) continue;
    keep.set(id, entry);
    extra.push(entry.place);
  }
  return { places: extra.length ? [...base, ...extra] : base, pending: keep };
}

const NOT_TEXT_INPUT = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color']);

/** Is `el` something the user types into (so a redraw under their fingers would drop the caret / the keyboard)? */
export function isTextEntry(el) {
  if (!el) return false;
  const tag = String(el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TEXT_INPUT.has(String(el.type ?? 'text').toLowerCase());
  return Boolean(el.isContentEditable);
}

/**
 * Redraw of the open card with fresh data, held back while the user is typing in it (replacing the card's DOM
 * would take focus, caret and, on a phone, the keyboard away mid-word). `request(old)` redraws at once when
 * nobody is typing, else remembers that a redraw is due (and the first, still displayed, `old` value);
 * `flush()` (call it when focus leaves a field) runs the due redraw once typing has stopped; `cancel()` forgets it
 * (the card was closed or another one opened). -> {request, flush, cancel, pending}
 */
export function createRefreshGate({ isTyping, refresh }) {
  let due = false;
  let shown = null;
  const run = () => {
    const old = shown;
    due = false;
    shown = null;
    refresh(old);
  };
  return {
    request(old) {
      if (!due) shown = old; // what is still on screen is the oldest value, even if redraws were held back before
      due = true;
      if (isTyping()) return false;
      run();
      return true;
    },
    flush() {
      if (!due || isTyping()) return false;
      run();
      return true;
    },
    cancel() {
      due = false;
      shown = null;
    },
    pending: () => due,
  };
}

/**
 * The small status line under the top bar -> {text, iconId}, or null when there is nothing to say. First match wins:
 * loading, offline (the cached snapshot's time), places unreadable but the phone's last places are still shown (placesKept), places unreadable.
 */
export function statusLine({ loading = false, fromCache = false, time = '', placesError = false, placesKept = false } = {}) {
  if (loading) return { text: '載入店家資料中…', iconId: null };
  if (fromCache) return { text: `離線，資料時間 ${time || '--:--'}`, iconId: 'i-wifi-off' };
  if (placesError && placesKept) return { text: '店家資料暫時讀不到，顯示上次的', iconId: 'i-alert' };
  if (placesError) return { text: '店家清單暫時讀不到，地圖可能不完整', iconId: 'i-alert' };
  return null;
}

/** Everything the open card shows that can change between two polls; equal signatures mean "do not redraw". */
export function cardSignature(place, { purchases = [], config = {} } = {}) {
  return JSON.stringify([place ?? null, purchases, config?.lightsplit_group_url ?? '']);
}
