// The five people. Each has one hue (>= 60 degrees from every other; here 72 apart) with a pale tint and a dark ink of that
// hue (see colors.js): the 誰想去 tags on the place card, the avatar, the who-am-I list.
import { inkOf, tintOf } from './colors.js';

const person = (name, initial, hue) => Object.freeze({ name, initial, hue, sat: 70, tint: tintOf(hue, 70), ink: inkOf(hue, 70) });

export const PEOPLE = [
  person('Alper', 'A', 142),
  person('Lee', 'L', 214),
  person('Kai', 'K', 70),
  person('Jack', 'J', 358),
  person('Benson', 'B', 286),
];

export const initialOf = (name) => PEOPLE.find((p) => p.name === name)?.initial;
export const nameOf = (initial) => PEOPLE.find((p) => p.initial === initial)?.name;
/** The person for a full name or an initial; null for anything else. */
export const personOf = (nameOrInitial) => PEOPLE.find((p) => p.name === nameOrInitial || p.initial === nameOrInitial) ?? null;
