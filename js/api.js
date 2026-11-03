// Client for the Apps Script web app (GET ?action=all, POST addPlace / searchPlace / resolveLink) with an offline snapshot cache.
// `cfg` is what readConfig() returns: {api, writeKey}. `fetchFn`, `storage`, `now` and `doc` are
// injectable so everything here runs in Node tests; defaults are the browser globals.
import { placeAsTyped, quotedForServer } from './add-place-logic.js';

export const SNAP_KEY = 'seoul.snap';

const SNAPSHOT_TIMEOUT_MS = 20_000; // cold start of the Apps Script can take 5-10 s
const ADD_TIMEOUT_MS = 30_000; // longer: aborting a POST client-side does not undo it server-side
const SEARCH_TIMEOUT_MS = 25_000; // cold start 5-10 s + one geocoder call
const RESOLVE_TIMEOUT_MS = 35_000; // cold start + the server's own 15 s cap on following the link
const MAX_QUERY_LEN = 100; // same limit as the server's searchPlace
const MOCK_URL = new URL('../../tests/fixtures/snapshot.json', import.meta.url).href; // local dev server only

const defaultFetch = (...args) => globalThis.fetch(...args);
const defaultNow = () => new Date();
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; } // access itself can throw (blocked site data)
}

// fetch -> response text. A non-2xx status, a network error and a timeout all throw.
// The timeout also covers reading the body and works even if fetchFn ignores the abort signal.
async function fetchText(fetchFn, url, init, timeoutMs) {
  const ctl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctl.abort(); reject(new Error('timeout')); }, timeoutMs);
  });
  const work = (async () => {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.text();
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Apps Script can answer 200 with an HTML error page, so only a well-formed ok:true snapshot counts.
// A snapshot with placesError is still valid (places [] plus the reason).
function isSnapshot(s) {
  return Boolean(s) && typeof s === 'object' && s.ok === true && Array.isArray(s.places) && Boolean(s.tabs) && typeof s.tabs === 'object';
}

function readCache(storage) {
  try {
    const c = JSON.parse(storage.getItem(SNAP_KEY));
    if (c && typeof c.fetchedAt === 'string' && isSnapshot(c.snapshot)) return { snapshot: c.snapshot, fetchedAt: c.fetchedAt };
  } catch { /* missing, corrupt or inaccessible */ }
  return null;
}

function writeCache(storage, entry) {
  try { storage.setItem(SNAP_KEY, JSON.stringify(entry)); } catch { /* quota / private mode: cache is best-effort */ }
}

// -> {snapshot, fromCache, fetchedAt, placesKept?}. Any failure (network, timeout, HTTP error, non-JSON, ok:false)
// falls back to the last good snapshot with fromCache:true; with none cached it throws Error('no_data').
// A snapshot that carries placesError (the server could not read App_Places and sent places []) must not wipe the places a phone
// already has: when the cache has places they are kept in the snapshot (and in the cache), the rest of the new snapshot (tabs,
// config, translations) is used, and placesKept is true so the screen can say so. placesError stays on the snapshot.
export async function fetchSnapshot(cfg, { fetchFn = defaultFetch, storage = defaultStorage(), now = defaultNow, timeoutMs = SNAPSHOT_TIMEOUT_MS } = {}) {
  try {
    if (!cfg?.api) throw new Error('not_configured');
    const url = cfg.api === 'mock' ? MOCK_URL : `${cfg.api}?action=all`;
    let snapshot = JSON.parse(await fetchText(fetchFn, url, {}, timeoutMs));
    if (!isSnapshot(snapshot)) throw new Error('bad_snapshot');
    const fetchedAt = now().toISOString();
    let placesKept = false;
    if (snapshot.placesError) {
      const kept = readCache(storage)?.snapshot.places ?? [];
      if (kept.length > 0) {
        snapshot = { ...snapshot, places: kept };
        placesKept = true;
      }
    }
    writeCache(storage, { snapshot, fetchedAt });
    return placesKept ? { snapshot, fromCache: false, fetchedAt, placesKept } : { snapshot, fromCache: false, fetchedAt };
  } catch {
    const cached = readCache(storage);
    if (!cached) throw new Error('no_data');
    return { ...cached, fromCache: true };
  }
}

// POST one action to the web app -> the parsed ok:true response. Failures throw Error(code): the server's own
// code on ok:false, else network / bad_response. For `unresolved` the error also carries the parsed place
// name in `.name` ('' if the server sent none), which shadows Error's own name on purpose (the UI searches by it).
async function postAction(cfg, payload, fetchFn, timeoutMs) {
  let text;
  try {
    text = await fetchText(fetchFn, cfg.api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a "simple" request: no CORS preflight (Apps Script cannot answer one)
      body: JSON.stringify(payload),
    }, timeoutMs);
  } catch {
    throw new Error('network');
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('bad_response'); }
  if (!data || typeof data !== 'object') throw new Error('bad_response');
  if (data.ok !== true) {
    const err = new Error(typeof data.error === 'string' && data.error ? data.error : 'unknown');
    if (data.error === 'unresolved') err.name = typeof data.name === 'string' ? data.name : '';
    throw err;
  }
  return data;
}

// -> the stored Place. Throws Error(code) so the UI can show a message: the server's own code on
// ok:false (bad_key, bad_place, busy, ...), else not_configured / bad_key (no local key) /
// network / bad_response. With api=mock nothing is stored: the place comes back with a mock id.
// `place` is what the person typed. `features` is the last snapshot's `features`: a server that does not list 'quote-guard'
// gets an extra ' in front of every text starting with = or ' (payloadForServer, with `quoted: true` beside the place so that a
// server redeployed in the meantime does not add its own on top), and the place that comes back is shown as typed
// either way (placeAsTyped).
export async function addPlace(cfg, place, { fetchFn = defaultFetch, timeoutMs = ADD_TIMEOUT_MS, features } = {}) {
  if (!cfg?.api) throw new Error('not_configured');
  if (cfg.api === 'mock') return { ...place, id: `mock-${Date.now()}`, source: 'app', verified: 'no', updated_at: new Date().toISOString() }; // nothing is stored: the UI can be tried without a backend
  if (!cfg.writeKey) throw new Error('bad_key');
  const wire = quotedForServer(place, features);
  const body = { action: 'addPlace', key: cfg.writeKey, place: wire.place, ...(wire.quoted ? { quoted: true } : {}) };
  const data = await postAction(cfg, body, fetchFn, timeoutMs);
  if (!data.place || typeof data.place !== 'object') throw new Error('bad_response');
  return placeAsTyped(data.place, place);
}

// What api=mock answers, so the add-place UI can be built and tried without a backend.
const MOCK_RESULTS = [
  { name: '어니언 성수', address: '서울 성동구 아차산로9길 8', lat: 37.5447, lng: 127.0586 },
  { name: '대림창고', address: '서울 성동구 성수이로78', lat: 37.5429, lng: 127.0626 },
];

// Search by name -> [{name, address, lat, lng}] (<= 5, inside Korea; [] when nothing matches).
// Throws Error(code): bad_query (empty / over 100 chars, checked here too), not_configured, bad_key (no local key),
// the server's code on ok:false (bad_key, OVER_QUERY_LIMIT, search_failed, ...), network, bad_response.
export async function searchPlace(cfg, query, { fetchFn = defaultFetch, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  if (!cfg?.api) throw new Error('not_configured');
  const q = typeof query === 'string' ? query.trim() : '';
  if (q === '' || q.length > MAX_QUERY_LEN) throw new Error('bad_query');
  if (cfg.api === 'mock') return MOCK_RESULTS.map((r) => ({ ...r }));
  if (!cfg.writeKey) throw new Error('bad_key');
  const data = await postAction(cfg, { action: 'searchPlace', key: cfg.writeKey, query: q }, fetchFn, timeoutMs);
  if (!Array.isArray(data.results)) throw new Error('bad_response');
  return data.results;
}

// A pasted Google / Naver Map link, or a whole share text containing one -> {name, lat, lng, address, url}.
// Throws Error(code): no_url, bad_text (over 2000 chars), unsupported_link, unresolved (the error's .name is the place name the share text
// or URL gave, possibly '': search by it), plus the same codes as searchPlace.
export async function resolveLink(cfg, text, { fetchFn = defaultFetch, timeoutMs = RESOLVE_TIMEOUT_MS } = {}) {
  if (!cfg?.api) throw new Error('not_configured');
  const s = typeof text === 'string' ? text : '';
  if (cfg.api === 'mock') {
    const link = /https?:\/\/\S*/i.exec(s); // the same "is a link" test as classifyPlaceInput
    if (!link) throw new Error('no_url');
    return { name: '어니언 성수', address: '서울 성동구 아차산로9길 8', lat: 37.5447, lng: 127.0586, url: link[0] };
  }
  if (!cfg.writeKey) throw new Error('bad_key');
  const data = await postAction(cfg, { action: 'resolveLink', key: cfg.writeKey, text: s }, fetchFn, timeoutMs);
  if (!data.place || typeof data.place !== 'object') throw new Error('bad_response');
  return data.place;
}

// Pulls a snapshot every intervalMs while the page is visible, and once immediately when it becomes
// visible again. It does not pull at start (the caller's first fetchSnapshot did). onSnapshot gets
// the same {snapshot, fromCache, fetchedAt} as fetchSnapshot, cache fallbacks included; a pull that
// fails with nothing cached is dropped. A tick is skipped while a pull is still in flight. Returns stop().
export function startPolling(cfg, onSnapshot, { intervalMs = 45_000, fetchFn, storage, now, doc = globalThis.document } = {}) {
  let inFlight = false;
  let stopped = false;
  const visible = () => doc?.visibilityState === 'visible';

  async function pull() {
    if (stopped || inFlight || !visible()) return;
    inFlight = true;
    let result;
    try {
      result = await fetchSnapshot(cfg, { fetchFn, storage, now });
    } catch {
      return; // no_data: nothing new to show
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    try { onSnapshot(result); } catch (e) { console.error(e); }
  }

  const onVisibility = () => { if (visible()) pull(); };
  const timer = setInterval(pull, intervalMs);
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return function stop() {
    stopped = true;
    clearInterval(timer);
    doc?.removeEventListener?.('visibilitychange', onVisibility);
  };
}
