// 行程 kept in the app: the rows of the Sheet tab App_Schedule (content and rules: schedule-edit.js). The screens are in ui/schedule-editor.js (edit mode
// on the 今天 page, the stop form, the place picker) and ui/day-picker.js (「加入行程」 on the place card); the arithmetic they share is schedule-ui.js.
//
// initSchedule(app, {api}) -> app.schedule = {api, rows(), version(date), sync(), forget(date), saveDay(payload), resetDay(payload), addPlace(place, date)}:
//     rows()               every row (tombstones included): the last snapshot's snapshot.schedule with what was saved from this phone laid over it.
//                          The day pages read it through loadTripData(tabs, app.schedule.rows()).
//     version(date)        the day's version now ('' when it is not app-owned): the `base` of the next save
//     sync()               take the rows (and the time) of app.snapshot now. main.js applySnapshot calls it before the pins and the first view are made,
//                          as app.places is set there; the 'snapshot' event does it too (a no-op then)
//     forget(date)         drop what this phone laid over that day: the day shows the snapshot's rows again, until a refetch (app.reload()) brings
//                          newer ones. saveDay / resetDay do it themselves when the backend says 'stale'
//     saveDay({date, base, stops, by}) / resetDay({date, base})
//                          the backend calls (api.js; `api` is replaced in a test), the answer laid over the rows at once, then app.emit('schedule');
//                          they resolve to the answer and throw what api.js throws (stale, bad_request, network, ...), changing nothing
//                          (but a 'stale' also forgets that day's overlay, so that the refetch the screen does next starts from the server's rows)
//     api                  the raw calls {saveDay, resetDay}: they do not touch the rows
//     addPlace(place, date)
//                          append the place as a stop to the end of that day and save the day at once (addPlaceToDay below)
//     Every change of the rows (a save, a reset, a forget, a snapshot that brings other rows) emits app.emit('schedule').
import { resetDay, saveDay } from '../api.js';
import { MAX_DAY_STOPS, createScheduleStore, insertStop } from '../schedule-edit.js';
import { placeStop, startingList } from '../schedule-ui.js';

/**
 * The card's 「加入行程」: `place` becomes the last stop of `date`, saved at once (no edit mode). A day that is not app-owned is copied first (copyDay,
 * base ''), so the Sheet's lines are all still there in the app's copy; an app-owned day gets the stop at the end of its own list (tombstones kept).
 * A `stale` answer (somebody saved the day meanwhile) fetches a fresh snapshot and tries once more by itself; a second failure throws what it threw.
 * -> the saveDay answer. Throws Error('unreadable') when the snapshot (or the Sheet's Schedule tab) is not in yet: a copy of the day would be empty, and
 * saving it would hide the Sheet's lines; Error('full') when the day already has MAX_DAY_STOPS rows; else what app.schedule.saveDay throws.
 */
export async function addPlaceToDay(app, place, date) {
  const attempt = () => {
    if (!app.snapshot) throw new Error('unreadable');
    const start = startingList(app.snapshot.tabs, app.schedule.rows(), date);
    if (!start.ok) throw new Error('unreadable');
    if (start.stops.length >= MAX_DAY_STOPS) throw new Error('full');
    return app.schedule.saveDay({ date, base: start.base, stops: insertStop(start.stops, undefined, placeStop(place, app.translations)), by: app.me ?? '' });
  };
  try {
    return await attempt();
  } catch (e) {
    if (e?.message !== 'stale') throw e;
  }
  await app.reload(); // saveDay forgot this phone's copy of the day: the fresh rows are the server's
  return attempt();
}

export function initSchedule(app, { api } = {}) {
  const store = createScheduleStore();
  store.setServer(app.snapshot?.schedule, app.snapshot?.serverTime);
  const schedule = {
    api: api ?? {
      saveDay: (payload) => saveDay(app.cfg, payload),
      resetDay: (payload) => resetDay(app.cfg, payload),
    },
    rows: () => store.rows(),
    version: (date) => store.version(date),
    sync() {
      const before = JSON.stringify(store.rows());
      store.setServer(app.snapshot?.schedule, app.snapshot?.serverTime);
      if (JSON.stringify(store.rows()) !== before) app.emit('schedule');
    },
    forget(date) {
      if (store.forget(date)) app.emit('schedule');
    },
    async saveDay(payload) {
      let answer;
      try {
        answer = await schedule.api.saveDay(payload);
      } catch (e) {
        if (e?.message === 'stale') schedule.forget(payload?.date);
        throw e;
      }
      store.applyDay(answer);
      app.emit('schedule');
      return answer;
    },
    async resetDay(payload) {
      let answer;
      try {
        answer = await schedule.api.resetDay(payload);
      } catch (e) {
        if (e?.message === 'stale') schedule.forget(payload?.date);
        throw e;
      }
      store.applyReset(answer?.date ?? payload.date);
      app.emit('schedule');
      return answer;
    },
    addPlace: (place, date) => addPlaceToDay(app, place, date),
  };
  app.schedule = schedule;
  app.on('snapshot', schedule.sync);
}
