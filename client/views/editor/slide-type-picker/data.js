/**
 * Tuning constants and curation hints for the insert-slide type picker.
 *
 * Pure values only — no DOM, no storage, no closure state. The picker's
 * localStorage keys live in ./preferences.js (its sole storage concern); these
 * are the layout / tuning knobs the render and thumbnail modules read, plus the
 * two things that are curation decisions about *this surface* rather than facts
 * about any one type: the display order within each shelf, and which types get
 * extra preset tiles.
 *
 * Everything that is a fact about a type — its description, its search aliases,
 * its shelf, its glyph, its sample content — is declared by the type itself in
 * `shared/slide-types/types/<name>/authoring.js` and read back through
 * `shared/slide-types/authoring-companions.js`. See
 * docs/reference/slide-type-directory.md.
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
// (payoff, end, custom-html), not a gap.
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
  media: [
    'image-text-slide',
    'image-slide',
    'gallery-slide',
    'video-slide',
    'embed-slide',
    'team-cards-slide',
    'logo-wall-slide',
  ],
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
export const PICKER_GROUP_KEYS = ['basic', 'media', 'layouts', 'data', 'interaction'];

// Curated layout variants surfaced as their own picker tiles (item 15). Each
// preset inserts the base slide type pre-configured with these content
// overrides, so the alternative layout is discoverable without a schema change.
// Usage counts and pins still track the *base* type (not the preset), so the
// "frequently used" / "pinned" signal isn't fragmented across variants; those
// strips render one base tile. Kept to a tight curated set so the grid doesn't
// explode. A type absent here renders as a single base tile, as before.
export const SLIDE_TYPE_PRESETS = {
  'image-text-slide': [
    { id: 'image-left', labelKey: 'editor.slideTypePreset.imageText.left', label: 'Image left', content: { imageSide: 'left' } },
    { id: 'image-right', labelKey: 'editor.slideTypePreset.imageText.right', label: 'Image right', content: { imageSide: 'right' } },
    { id: 'image-wide', labelKey: 'editor.slideTypePreset.imageText.wide', label: 'Image 2/3', content: { imageWidth: 'wide' } },
    { id: 'image-corner', labelKey: 'editor.slideTypePreset.imageText.corner', label: 'Corner image', content: { layout: 'corner', imageSide: 'right' } },
    { id: 'image-row', labelKey: 'editor.slideTypePreset.imageText.row', label: 'Image row', content: { layout: 'row-top' } },
  ],
  // content-slide has no picker presets on purpose: its two-column layout is a
  // CSS text-flow variant that only splits once the body is long enough, so it
  // reads as "one column" in an empty new slide and confused people who picked
  // it expecting two separate fields. That layout stays reachable in the editor
  // via the layout switcher (content-slide's layoutVariants), which is where the
  // "I explicitly want two columns" use case lives now that content-columns-slide
  // is archived.
  'list-slide': [
    { id: 'bullets', labelKey: 'editor.slideTypePreset.list.bullets', label: 'Bullet list', content: { variant: 'bullets' } },
    { id: 'numbers', labelKey: 'editor.slideTypePreset.list.numbers', label: 'Numbered list', content: { variant: 'numbers' } },
  ],
};
