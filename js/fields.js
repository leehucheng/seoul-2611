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

// Column order of the Google Sheet tab `App_Shopping` (the 代購清單): one row per item, every row owned by one person. Every column is
// plain text. `owner` is the name the app calls the person by (app.me); qty is a whole number 1-99; price_krw / actual_krw / actual_twd
// are whole numbers >= 0 or empty; bought / hidden are 'TRUE' or ''. Append-only like PLACE_FIELDS (gas/Code.template.gs has the same list).
export const SHOP_FIELDS = [
  'id',
  'owner',
  'name_zh',
  'name_ko',
  'brand',
  'spec',
  'qty',
  'for_whom',
  'price_krw',
  'price_source',
  'price_date',
  'price_note',
  'official_url',
  'image_url',
  'where',
  'note',
  'bought',
  'actual_krw',
  'actual_twd',
  'hidden',
  'added_by',
  'updated_at',
];
