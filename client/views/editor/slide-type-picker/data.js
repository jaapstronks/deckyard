/**
 * Static data and tuning constants for the insert-slide type picker.
 *
 * Pure values only — no DOM, no storage, no closure state. The picker's
 * localStorage keys live in ./preferences.js (its sole storage concern); these
 * are the domain data (curated presets, the per-shelf order hint) and the
 * layout / tuning knobs the render and thumbnail modules read.
 *
 * The per-type description and search aliases no longer live here: each type
 * declares them in its own `shared/slide-types/types/<name>/authoring.js`, the
 * picker resolves them through `slideTypeDescription()` / `slideTypeAliases()`
 * (shared/slide-types/authoring-companions.js) off the `/api/slide-types`
 * response. See docs/reference/slide-type-directory.md.
 */

// The slide canvas is rendered at this width, then scaled down to fit each
// thumbnail tile. Scale is computed per tile from its measured width.
export const SLIDE_CANVAS_WIDTH = 1600;

// Thumbnail view modes: 'schematic' shows an abstract symbolic diagram of each
// slide type (compact, legible at any size); 'preview' shows the real slide
// rendered small (richer, but text gets tiny). Default schematic — it scans
// faster and reads clearly even in a dense grid.
export const VIEW_MODES = new Set(['schematic', 'preview']);

// Preview-background toggle candidates: the chosen surface is forced onto every
// thumbnail whose slide type actually supports it. Filtered per theme/type at
// render time; '' ("auto") means each type renders on its own sample surface.
export const SURFACE_CANDIDATES = ['lime', 'mist', 'dark'];

// Frequently-used strip tuning: cap it to one row and don't show it until
// there's real signal.
export const FREQUENT_MAX = 6;
export const FREQUENT_MIN_TOTAL = 3;

// The Media shelf is read in two rows (D343): what carries one image, and what
// shows a collection of them. Video and embed are single carriers, not variants
// of an image slide and not collections. The rows are a reading aid inside one
// shelf, headed by a small subheading; they are not shelves of their own and do
// not touch the `group` axis (shared/slide-types/authoring-groups.js), which the
// settings tab shares. A media type no row names (a fork type declaring
// `media`) lands in the row marked `rest`.
//
// `titleKey` / `title` pairs, as GROUP_TITLES in ./index.js, so the i18n
// extractor counts the keys.
export const MEDIA_ROWS = [
  {
    key: 'single',
    titleKey: 'editor.slideTypeRow.mediaSingle',
    title: 'One image',
    rest: true,
    types: [
      'image-text-slide',
      'image-set-slide',
      'image-slide',
      'video-slide',
      'embed-slide',
    ],
  },
  {
    key: 'collection',
    titleKey: 'editor.slideTypeRow.mediaCollection',
    title: 'Collection',
    types: ['gallery-slide', 'team-cards-slide', 'logo-wall-slide'],
  },
];

// Shelves split into headed rows, by group key. Only Media has them.
export const PICKER_SHELF_ROWS = { media: MEDIA_ROWS };

// Types whose tile always shows the live preview, whatever the schematic /
// preview switch says (D344). The three collections all draw as a grid in a
// schematic; only their content tells them apart, so the schematic would hide
// the one thing the author needs to choose between them.
export const ALWAYS_PREVIEW_TYPES = new Set(
  MEDIA_ROWS.find((row) => row.key === 'collection').types,
);

// Display order within each curated group — a *hint*, not the membership.
//
// Which group a type belongs to is declared by the type itself, in
// `shared/slide-types/types/<name>/authoring.js`, and read back through
// typesInGroup() (see shared/slide-types/authoring-groups.js). This table only
// says who comes first, because order is a curation decision about the insert
// flow rather than a fact about any one type: the most-reached-for tiles sit at
// the top of each shelf. A member this table does not name sorts after the ones
// it does, and a name here that no longer exists is ignored — so a stale hint
// costs a tile's position, never its visibility.
//
// The picker has no curated `other` shelf: a type declaring `group: 'other'`
// lands in the computed "Other" group at the bottom, alongside anything else
// uncurated. That is deliberate — "Other" is a real home for the long tail
// (payoff, end), not a gap.
//
// Layouts absorbs what the settings tab used to call "Process": process and
// timeline are structured layouts, not different enough to warrant a section of
// their own (which showed 2 tiles and a wall of whitespace).
//
// The theme's own `basicSlideTypes` are prepended to `basic` at render time, and
// custom types get their own computed group — neither belongs in this table.
export const PICKER_GROUP_ORDER = {
  basic: [
    'title-slide',
    'chapter-title-slide',
    'content-slide',
    'quote-slide',
    'list-slide',
  ],
  // Spelled by the shelf's rows below, so the order and the split cannot drift.
  media: MEDIA_ROWS.flatMap((row) => row.types),
  layouts: [
    'text-blocks-slide',
    'icon-card-grid-slide',
    'process-slide',
    'timeline-slide',
  ],
  data: [
    'table-slide',
    'chart-slide',
    'kpi-metrics-slide',
    'comparison-slide',
    'matrix-slide',
    'funnel-slide',
    'pyramid-slide',
    'cycle-slide',
  ],
  interaction: [
    'poll-slide',
    'likert-slide',
    'likert-slider-slide',
    'feedback-slide',
    'follow-invite-slide',
    'countdown-slide',
  ],
};

// The curated shelves the picker renders, in display order. `other` is absent
// on purpose (see above); `custom` is computed from the registry, not declared.
export const PICKER_GROUP_KEYS = [
  'basic',
  'media',
  'layouts',
  'data',
  'interaction',
];

// Curated layout variants surfaced as their own picker tiles (item 15). Each
// preset inserts the base slide type pre-configured with these content
// overrides, so the alternative layout is discoverable without a schema change.
// Usage counts and pins still track the *base* type (not the preset), so the
// "frequently used" / "pinned" signal isn't fragmented across variants; those
// strips render one base tile. Kept to a tight curated set so the grid doesn't
// explode. A type absent here renders as a single base tile, as before.
export const SLIDE_TYPE_PRESETS = {
  'image-text-slide': [
    {
      id: 'image-left',
      labelKey: 'editor.slideTypePreset.imageText.left',
      label: 'Image left',
      content: { imageSide: 'left' },
    },
    {
      id: 'image-right',
      labelKey: 'editor.slideTypePreset.imageText.right',
      label: 'Image right',
      content: { imageSide: 'right' },
    },
    {
      id: 'image-wide',
      labelKey: 'editor.slideTypePreset.imageText.wide',
      label: 'Image 63%',
      content: { imageWidth: 'wide' },
    },
    {
      id: 'image-corner',
      labelKey: 'editor.slideTypePreset.imageText.corner',
      label: 'Corner image',
      content: { layout: 'corner', imageSide: 'right' },
    },
  ],
  // image-set-slide has no presets on purpose (D100). Its three layouts differ
  // in where the images sit relative to the text, which is the same axis the
  // base tile's own schematic already shows; a preset row would repeat the
  // type rather than open a use case the picker cannot otherwise reach. The
  // layouts stay one click away in the editor's layout switcher.
  // content-slide has no picker presets on purpose: its two-column layout is a
  // CSS text-flow variant that only splits once the body is long enough, so it
  // reads as "one column" in an empty new slide and confused people who picked
  // it expecting two separate fields. That layout stays reachable in the editor
  // via the layout switcher (content-slide's layoutVariants), which is where the
  // "I explicitly want two columns" use case lives.
  // The five callout kinds are a `variant` enum on one type (so the ~40-type
  // list does not balloon), and presets are what keep them findable: an author
  // looking for "a warning slide" searches the picker, not a dropdown inside a
  // slide they have not inserted yet.
  'callout-slide': [
    {
      id: 'insight',
      labelKey: 'editor.slideTypePreset.callout.insight',
      label: 'Key insight',
      content: { variant: 'insight' },
    },
    {
      id: 'warning',
      labelKey: 'editor.slideTypePreset.callout.warning',
      label: 'Warning',
      content: { variant: 'warning' },
    },
    {
      id: 'definition',
      labelKey: 'editor.slideTypePreset.callout.definition',
      label: 'Definition',
      content: { variant: 'definition' },
    },
    {
      id: 'note',
      labelKey: 'editor.slideTypePreset.callout.note',
      label: 'Note',
      content: { variant: 'note' },
    },
    {
      id: 'tip',
      labelKey: 'editor.slideTypePreset.callout.tip',
      label: 'Tip',
      content: { variant: 'tip' },
    },
  ],
  'list-slide': [
    {
      id: 'bullets',
      labelKey: 'editor.slideTypePreset.list.bullets',
      label: 'Bullet list',
      content: { variant: 'bullets' },
    },
    {
      id: 'numbers',
      labelKey: 'editor.slideTypePreset.list.numbers',
      label: 'Numbered list',
      content: { variant: 'numbers' },
    },
  ],
};
