// View model for the "today" page. Pure: all inputs are parsed Sheet data, no I/O, no DOM.
import { initialOf } from './people.js';

const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }); // en-CA -> YYYY-MM-DD

/** The calendar date in Seoul right now (not the device's local date). */
export const todayISO = (now) => seoulDate.format(now);

/** Before this hour in Seoul a person is still on the night that began the evening before (the hotel they have not left yet). */
export const NIGHT_CUTOFF_HOURS = 6;

/**
 * The date of the night a person is in right now: the Seoul date of (now - 6 h). Between 00:00 and 06:00 it is still the day
 * before, so on a hotel-switch night the hotel (from <= date < to) is the one they have not checked out of. Schedule items and
 * the "today" label keep todayISO(); only the hotel lookup uses this.
 */
export const nightDateISO = (now) => seoulDate.format(new Date(now.getTime() - NIGHT_CUTOFF_HOURS * 3600000));

const nextDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * @param {{days: object[], flights: object[], hotels: object[]}} data  parseSchedule / parseFlights / parseHotels().hotels
 * @param {string} person   full name, e.g. 'Lee' (flights list full names; hotels list initials)
 * @param {string} dateISO  'YYYY-MM-DD'
 * @param {{hotelDate?: string}} [opts]  the date the hotel is looked up for (the night); the day, status, flight and items use dateISO
 */
export function buildToday({ days, flights, hotels }, person, dateISO, { hotelDate = dateISO } = {}) {
  const mine = flights.filter((f) => f.date && f.people.includes(person));

  // ISO dates sort lexically. A missing out/back flight means that side is open-ended.
  const firstOut = mine.filter((f) => f.dir === 'out').map((f) => f.date).sort()[0];
  const lastBack = mine.filter((f) => f.dir === 'back').map((f) => f.date).sort().at(-1);
  let status = 'in';
  if (firstOut && dateISO < firstOut) status = 'before';
  else if (lastBack && dateISO > lastBack) status = 'after';

  const tomorrow = nextDay(dateISO);
  let flight = null;
  const pick = mine.find((f) => f.date === dateISO) ?? mine.find((f) => f.date === tomorrow);
  if (pick) {
    flight = {
      flight: pick.flight, from: pick.from, to: pick.to, dep: pick.dep, date: pick.date,
      when: pick.date === dateISO ? 'today' : 'tomorrow',
    };
  }

  const initial = initialOf(person);
  const stay = hotels.find((h) => h.from <= hotelDate && hotelDate < h.to && h.shared.includes(initial));
  const hotel = stay ? { name: stay.name, from: stay.from, to: stay.to } : null;

  const items = days.find((d) => d.date === dateISO)?.items ?? [];

  return { date: dateISO, status, items, flight, hotel };
}
