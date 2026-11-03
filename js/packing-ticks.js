// What is ticked on the 行李清單: only on this phone (localStorage `seoul.packing` = JSON array of item ids, the `seoul.star` convention
// of stars.js), never synced. Every read and write is guarded: with storage that is missing, corrupt, full or blocked the ticks live
// in memory for as long as the app is open, and `saved` says the last write did not reach the storage.
import { PACKING_IDS, PACKING_TOTAL } from './packing.js';

export const PACKING_KEY = 'seoul.packing';

/** The ids ticked in `storage`, as a Set; empty when nothing is stored or the storage is missing, corrupt or blocked. */
export function loadTicks(storage) {
  try {
    const v = JSON.parse(storage.getItem(PACKING_KEY));
    if (Array.isArray(v)) return new Set(v.filter((id) => typeof id === 'string' && id));
  } catch { /* missing, corrupt or inaccessible storage */ }
  return new Set();
}

/** Write `ticks` (a Set) best-effort; true when the storage took it. */
export function saveTicks(ticks, storage) {
  try {
    storage.setItem(PACKING_KEY, JSON.stringify([...ticks]));
    return true;
  } catch {
    return false; // private mode / quota: it still works this session
  }
}

/**
 * The ticks of this phone: createPacking({storage, onChange}) -> {total, saved, has(id), count(), toggle(id), reset()}.
 * `count()` only counts ids the checklist has (an id left in storage by an older list is not a tick). `onChange()` runs after a toggle or a reset.
 */
export function createPacking({ storage, onChange } = {}) {
  const ticks = loadTicks(storage);
  let saved = true;
  const changed = () => {
    saved = saveTicks(ticks, storage);
    try { onChange?.(); } catch (e) { console.error(e); }
  };
  return {
    total: PACKING_TOTAL,
    get saved() { return saved; },
    has: (id) => ticks.has(id),
    count: () => PACKING_IDS.filter((id) => ticks.has(id)).length,
    /** Flip one item; -> the new state (true = ticked). */
    toggle(id) {
      const on = !ticks.has(id);
      if (on) ticks.add(id); else ticks.delete(id);
      changed();
      return on;
    },
    /** Clear every tick. */
    reset() {
      ticks.clear();
      changed();
    },
  };
}
