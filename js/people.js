// The five people. A person is a name and an initial; the look of "me" (an ink circle with the initial) and of everyone else (an
// outlined initial) is the same for all five (app.css), so no per-person colour lives here.

const person = (name, initial) => Object.freeze({ name, initial });

export const PEOPLE = [
  person('Alper', 'A'),
  person('Lee', 'L'),
  person('Kai', 'K'),
  person('Jack', 'J'),
  person('Benson', 'B'),
];

export const initialOf = (name) => PEOPLE.find((p) => p.name === name)?.initial;
export const nameOf = (initial) => PEOPLE.find((p) => p.initial === initial)?.name;
/** The person for a full name or an initial; null for anything else. */
export const personOf = (nameOrInitial) => PEOPLE.find((p) => p.name === nameOrInitial || p.initial === nameOrInitial) ?? null;
