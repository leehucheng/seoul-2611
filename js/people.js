export const PEOPLE = [
  { name: 'Alper', initial: 'A' },
  { name: 'Lee', initial: 'L' },
  { name: 'Kai', initial: 'K' },
  { name: 'Jack', initial: 'J' },
  { name: 'Benson', initial: 'B' },
];

export const initialOf = (name) => PEOPLE.find((p) => p.name === name)?.initial;
export const nameOf = (initial) => PEOPLE.find((p) => p.initial === initial)?.name;
