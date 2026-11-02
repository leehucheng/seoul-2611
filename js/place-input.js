// What the "add a place" box does with the text it was given.
// A link (or a whole share text that contains one) goes to the server's resolveLink; anything else
// is a name to search for. "A link" means http:// or https:// somewhere in the text; api.js's mock
// resolveLink uses the same test, so the mock and this classifier never disagree.
const LINK = /https?:\/\//i;

// -> {kind: 'empty'|'url'|'query', value}. value is the trimmed text; for 'url' it is the WHOLE text,
// because a share text carries the place name and address next to the link and the server uses them.
export function classifyPlaceInput(s) {
  const value = (s === null || s === undefined ? '' : String(s)).trim();
  if (value === '') return { kind: 'empty', value: '' };
  if (LINK.test(value)) return { kind: 'url', value };
  return { kind: 'query', value };
}
