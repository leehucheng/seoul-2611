// The 銀杏 filter (pure, no DOM): which places the Sheet's 銀杏 tab lists. Each row of the tab is matched to a place the way every
// other bit of Sheet text is matched to a pin (match.js matchPlace: the exact normalised name or alias first, then a name of at least
// four characters inside the text), by the row's wordings in order (the name as written, then the Korean name). A hidden place never
// counts; two rows pointing at one place give one id.
import { matchPlace } from './match.js';
import { ginkgoEntries } from './plan-names.js';
import { isHidden } from './place-view.js';

/** @returns {Set<string>} ids of the places on the 銀杏 tab */
export function ginkgoPlaceIds(tabs, places) {
  const ids = new Set();
  const visible = (Array.isArray(places) ? places : []).filter((p) => p && typeof p === 'object' && p.id && !isHidden(p));
  if (visible.length === 0) return ids;
  let entries = [];
  try { entries = ginkgoEntries(tabs?.['銀杏']); } catch { entries = []; }
  for (const entry of entries) {
    for (const wording of entry.aliases) {
      const id = matchPlace(wording, visible);
      if (id !== null) { ids.add(id); break; }
    }
  }
  return ids;
}
