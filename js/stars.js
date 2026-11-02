// Starred places: only on this phone (localStorage `seoul.star` = JSON array of place ids), never synced.
export const STAR_KEY = 'seoul.star';

export function loadStars(storage) {
  try {
    const v = JSON.parse(storage.getItem(STAR_KEY));
    if (Array.isArray(v)) return new Set(v.filter((id) => typeof id === 'string' && id));
  } catch { /* missing, corrupt or inaccessible storage */ }
  return new Set();
}

/** Flip one id in `stars` (a Set, mutated), persist best-effort, return the new starred state. */
export function toggleStar(stars, id, storage) {
  const on = !stars.has(id);
  if (on) stars.add(id); else stars.delete(id);
  try { storage.setItem(STAR_KEY, JSON.stringify([...stars])); } catch { /* private mode / quota: still works this session */ }
  return on;
}
