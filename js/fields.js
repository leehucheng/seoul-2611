// Column order of the Google Sheet tab `App_Places`.
// `who` / `aliases` are `|`-separated strings; `hours_json` / `personal_json` are JSON strings.
// New columns are only ever appended at the end: an older sheet's header is then a prefix of this list, which the
// backend still reads, and setup() adds the missing header cells.
export const PLACE_FIELDS = [
  'id',
  'name_zh',
  'name_kr',
  'name_en',
  'category',
  'lat',
  'lng',
  'address_kr',
  'area',
  'phone',
  'hours_text',
  'hours_json',
  'signature',
  'who',
  'source',
  'added_by',
  'note',
  'verified',
  'aliases',
  'personal_json',
  'hidden',
  'updated_at',
  'address_zh', // Traditional Chinese of address_kr, made by the server (LanguageApp)
];
