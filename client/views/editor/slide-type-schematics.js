// Schematic descriptor per slide type (and per curated layout preset), consumed
// by the slide-type picker's "Schematic" view mode. A descriptor is a JSON-safe
// spec understood by renderSlideSchematic() — see client/lib/slide-schematic.js
// for the grammar.
//
// Resolution precedence (see schematicFor):
//   1. a preset-specific override (key `"<type>:<presetId>"`)
//   2. the slide-type definition's own `schematic` field (lets custom/fork
//      types ship an icon without touching this map)
//   3. the base entry for the type here
//   4. null -> the picker falls back to a generic text-only diagram
//
// Keep this aligned with SLIDE_TYPE_DESC / SLIDE_TYPE_PRESETS in
// slide-type-picker.js: every curated type should have a recognisable glyph.

export const SLIDE_TYPE_SCHEMATIC = {
  // basics
  'title-slide': { kind: 'title' },
  'chapter-title-slide': { kind: 'section' },
  'content-slide': { kind: 'oneCol' },
  'quote-slide': { kind: 'quote' },
  'lijstje-slide': { kind: 'bullets' },
  'payoff-slide': { kind: 'statement' },
  // media
  'image-text-slide': { split: 50 },
  'image-slide': { kind: 'image' },
  'gallery-slide': { kind: 'gallery', cells: 6 },
  'video-slide': { kind: 'video' },
  'embed-slide': { kind: 'embed' },
  'split-partner-title-slide': { kind: 'partners' },
  'team-cards-slide': { kind: 'cards', cells: 6, cols: 3, rows: 2 },
  'logo-wall-slide': { kind: 'logos', cells: 8 },
  // layouts
  'content-columns-slide': { textCols: 2 },
  'text-blocks-slide': { kind: 'blocks', cells: 4 },
  'icon-card-grid-slide': { kind: 'iconCards', cells: 6, cols: 3, rows: 2 },
  // data
  'table-slide': { kind: 'table' },
  'chart-slide': { kind: 'chart' },
  'kpi-metrics-slide': { kind: 'kpi', cells: 4 },
  'comparison-slide': { kind: 'comparison' },
  'matrix-slide': { kind: 'matrix' },
  // process / relationship
  'funnel-slide': { kind: 'funnel' },
  'pyramid-slide': { kind: 'pyramid' },
  'cycle-slide': { kind: 'cycle' },
  'process-slide': { kind: 'process' },
  'timeline-slide': { kind: 'timeline' },
  // interaction
  'poll-slide': { kind: 'poll' },
  'likert-slide': { kind: 'bars', rows: 5 },
  'likert-slider-slide': { kind: 'slider' },
  'feedback-slide': { kind: 'feedback' },
  'follow-invite-slide': { kind: 'qr' },
  'countdown-slide': { kind: 'countdown' },
  // other core types (land in the picker's "Other" group)
  'card-stack-slide': { kind: 'cards', cells: 4, cols: 2, rows: 2 },
  'list-slide': { kind: 'bullets' },
  'end-slide': { kind: 'statement' },
  'lead-capture-slide': { kind: 'feedback' },
  'custom-html-slide': { kind: 'code' },
};

// Per-preset overrides. Keyed "<type>:<presetId>" — presets absent here fall
// back to the base type's schematic.
const SLIDE_TYPE_PRESET_SCHEMATIC = {
  // content-slide has no picker presets (see slide-type-picker.js); its
  // two-column text-flow layout is reachable via the in-editor layout switcher.
  'lijstje-slide:bullets': { kind: 'bullets' },
  'lijstje-slide:numbers': { kind: 'numbers' },
  'image-text-slide:image-left': { split: 50 },
  'image-text-slide:image-right': { split: 50, mirror: true },
  'image-text-slide:image-wide': { split: 63 },
  'image-text-slide:image-corner': { corner: 45, mirror: true },
  'image-text-slide:image-row': { row: 'top' },
};

/**
 * Resolve the schematic spec for a picker tile.
 * @param {string} type - slide type key
 * @param {string|null} [presetId] - curated preset id, when the tile is a variant
 * @param {Object|null} [def] - the slide-type definition (for its own `schematic`)
 * @returns {Object|null} a schematic spec, or null to fall back to text-only
 */
export function schematicFor(type, presetId = null, def = null) {
  if (presetId && SLIDE_TYPE_PRESET_SCHEMATIC[`${type}:${presetId}`]) {
    return SLIDE_TYPE_PRESET_SCHEMATIC[`${type}:${presetId}`];
  }
  if (def && def.schematic && typeof def.schematic === 'object') return def.schematic;
  return SLIDE_TYPE_SCHEMATIC[type] || null;
}
