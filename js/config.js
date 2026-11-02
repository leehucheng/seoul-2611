// Connection settings come from the URL hash the trip members were given: #a=<deploymentId>&k=<writeKey>.
// The hash is stored in localStorage so the app keeps working when reopened without it.
// `a=mock` means "use tests/fixtures/snapshot.json" (local dev server only).
export const CFG_KEY = 'seoul.cfg';

// The two values are taken as a PREFIX of what follows `a=` / `k=`: text glued on after the key ("（記得加到主畫面）", a closing
// bracket, a full stop) is not part of it. Both the address bar (readConfig) and the paste box (hashFromInput) use these, so
// they always agree. Nothing outside these characters can ever reach the URL template or the saved key.
// The cut is only made where glued text can start: a non-ASCII character, white space, an escape (%), or nothing but closing /
// sentence punctuation up to the end. A value that goes on with other ASCII ("bad/id", "ab-cd" or "ab.cd" for a key) is
// malformed, not glued, and is refused as a whole.
const ID_PREFIX = /^[A-Za-z0-9_-]+/; // Apps Script deployment id
const KEY_PREFIX = /^[A-Za-z0-9]+/; // write key (hex)
const GLUE_START = /^(?:[^\x00-\x7F]|[\s%]|[)\]}>.,;!'"]+$)/; // % : an escape of glue (a cut-off one is kept raw by parseHash)
function prefixOf(re, v) {
  const m = typeof v === 'string' ? re.exec(v) : null;
  if (!m) return null;
  const rest = v.slice(m[0].length);
  return rest === '' || GLUE_START.test(rest) ? m[0] : null;
}
const idOf = (v) => prefixOf(ID_PREFIX, v);
const keyOf = (v) => prefixOf(KEY_PREFIX, v);
const EMPTY = Object.freeze({ api: null, writeKey: null });

export function apiUrl(deploymentId) {
  return deploymentId === 'mock' ? 'mock' : `https://script.google.com/macros/s/${deploymentId}/exec`;
}

function parseHash(hash) {
  const out = Object.create(null);
  for (const part of String(hash ?? '').replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq);
    if (name in out) continue; // the first one wins
    const raw = part.slice(eq + 1);
    try { out[name] = decodeURIComponent(raw); } catch { out[name] = raw; } // a malformed escape (a cut-off link): the prefix of the raw text still works
  }
  return out;
}

function load(storage) {
  try {
    const v = JSON.parse(storage.getItem(CFG_KEY));
    if (v && typeof v === 'object') {
      return { api: typeof v.api === 'string' ? v.api : null, writeKey: typeof v.writeKey === 'string' ? v.writeKey : null };
    }
  } catch { /* missing, corrupt or inaccessible storage */ }
  return { ...EMPTY };
}

// ---- the paste box on the "no settings yet" screen (ui/setup.js) ---------------------------------------------------
// An iPhone's home-screen app opens `./` with no hash and with storage of its own, and Safari also forgets site data after
// a week unused: the person pastes the link they were given and it goes through the same readConfig as the address bar.

/**
 * What was pasted -> a clean "#a=<id>&k=<key>" (only the parts that were found), or null. Takes the whole link, a message with
 * the link in it, or only the part after the #. The id and the key are cut where text glued on after them starts
 * ("…&k=<key>（記得加到主畫面）", a closing bracket, a full stop), so it is not saved with the key. A "#" that is
 * not the link's own (a hashtag such as "#首爾" before the link) is skipped.
 */
export function hashFromInput(text) {
  const s = String(text ?? '').trim();
  let fragment = null;
  for (const m of s.matchAll(/#([^#\s]*)/g)) {
    if (/(^|&)[ak]=/.test(m[1])) { fragment = m[1]; break; } // the first # part that carries settings
  }
  if (fragment === null) fragment = /^\??([ak]=\S+)$/.exec(s)?.[1] ?? null; // "a=...&k=..." typed without the #
  if (fragment === null) return null;
  const h = parseHash(fragment);
  const a = idOf(h.a);
  const k = keyOf(h.k);
  if (a === null && k === null) return null;
  return `#${[a !== null ? `a=${a}` : '', k !== null ? `k=${k}` : ''].filter(Boolean).join('&')}`;
}

const NO_STORAGE = { getItem: () => null, setItem: () => {} };

/** Pasted text -> {api, writeKey} saved in `storage`, or null when it does not carry a usable deployment id and key. Nothing is stored on null. */
export function configFromInput(text, storage) {
  const hash = hashFromInput(text);
  if (hash === null) return null;
  const probe = readConfig(hash, NO_STORAGE); // judged exactly as the address bar would be, without storing a half-valid result
  if (!probe.api || !probe.writeKey) return null;
  return readConfig(hash, storage);
}

// A hash carrying `a` and/or `k` overlays the stored config (and is stored); any other hash
// (empty, or an in-app route like #today) leaves the stored config untouched. A new `a` (another deployment) drops the stored
// key unless the same hash brings a new one: the old key opens nothing there.
export function readConfig(hash, storage) {
  const stored = load(storage);
  const h = parseHash(hash);
  const a = idOf(h.a);
  const k = keyOf(h.k);
  if (a === null && k === null) return stored;
  const api = a !== null ? apiUrl(a) : stored.api;
  const cfg = { api, writeKey: k !== null ? k : api === stored.api ? stored.writeKey : null };
  try { storage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* private mode / quota: still usable this session */ }
  return cfg;
}
