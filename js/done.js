// 「已完成」: the stops of a day this phone has ticked off on the 今天 page. Only on this phone: localStorage
// `seoul.done.<YYYY-MM-DD>` = a JSON array of item keys, never sent to the server. Every read and write is guarded, so a blocked
// or full storage cannot break the page (a tick then lasts until the page closes).
export const DONE_PREFIX = 'seoul.done.';

const textOf = (item) => String(typeof item === 'string' ? item : item?.text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The keys of a day's items, in order: the item's text with blanks collapsed + `#` + how many identical lines came before it that
 * day (`51%?#0`, `51%?#1`), so two identical lines tick separately and an inserted line elsewhere does not move the others' ticks.
 */
export function doneKeys(items) {
  const seen = new Map();
  return (Array.isArray(items) ? items : []).map((item) => {
    const text = textOf(item);
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return `${text}#${n}`;
  });
}

/** The key of one item: the `key` it already carries (itemViews), else its text as the first of its kind (`text#0`). */
export const doneKey = (item) => (typeof item?.key === 'string' && item.key ? item.key : `${textOf(item)}#0`);

/** The keys ticked for one date, as a Set; empty when nothing is stored or the storage is missing, corrupt or blocked. */
export function loadDone(storage, dateISO) {
  try {
    const v = JSON.parse(storage.getItem(`${DONE_PREFIX}${dateISO}`));
    if (Array.isArray(v)) return new Set(v.filter((k) => typeof k === 'string' && k));
  } catch { /* missing, corrupt or inaccessible storage */ }
  return new Set();
}

/** Flip one key in `done` (a Set, mutated), persist best-effort, and return the new state (true = ticked). */
export function toggleDone(done, key, dateISO, storage) {
  const on = !done.has(key);
  if (on) done.add(key); else done.delete(key);
  try { storage.setItem(`${DONE_PREFIX}${dateISO}`, JSON.stringify([...done])); } catch { /* private mode / quota: it still works this session */ }
  return on;
}
