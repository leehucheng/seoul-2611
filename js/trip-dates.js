// The trip's dates, apart from today-view.js so that the schedule model (schedule-edit.js) can use them without a cycle. today-view.js re-exports them.
export const TRIP_FIRST = '2026-11-05'; // the day switcher stays inside the trip
export const TRIP_LAST = '2026-11-15';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written 'YYYY-MM-DD' ('2026-02-30' is not one). */
export function isISODate(s) {
  const m = ISO.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** A real date inside the trip, 11/5 to 11/15. */
export const inTrip = (s) => isISODate(s) && s >= TRIP_FIRST && s <= TRIP_LAST;
