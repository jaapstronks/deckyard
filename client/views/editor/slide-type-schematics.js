// Schematic glyph resolution for the slide-type picker's "Schematic" view mode.
// A descriptor is a JSON-safe spec understood by renderSlideSchematic() — see
// client/lib/slide-authoring/slide-schematic.js for the grammar.
//
// This file no longer *holds* the glyphs. Every core type declares its own in
// `shared/slide-types/types/<name>/authoring.js`, and the two maps below are
// derived from the aggregator in shared/slide-types/authoring.js. That is the
// point of the A7.1 seam work: a glyph is a fact about a slide type, so adding
// or retiring a type touches the type's own directory and nothing here. The old
// hand-maintained map carried the comment "Keep this aligned with
// SLIDE_TYPE_DESC / SLIDE_TYPE_PRESETS" — a human asked to do a derivation's
// job. See docs/reference/slide-type-directory.md.
//
// Resolution precedence (see schematicFor) is unchanged:
//   1. a preset-specific override (key `"<type>:<presetId>"`)
//   2. the slide-type definition's own `schematic` field (lets custom/fork
//      types ship an icon without owning a directory here)
//   3. the base entry for the type
//   4. null -> the picker falls back to a generic text-only diagram
//
// Every insertable type still needs a glyph, and a retired one must not keep
// its own: tests/slide-type-companion-coverage.test.js enforces both directions
// against the derived map below.

import { SLIDE_TYPE_AUTHORING } from '../../../shared/slide-types/authoring.js';

/**
 * Base glyph per slide type, derived from each type's `authoring.js`.
 * Kept as an exported map because the picker and the companion-coverage test
 * both read it by type name.
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_SCHEMATIC = Object.fromEntries(
  Object.entries(SLIDE_TYPE_AUTHORING)
    .filter(([, authoring]) => authoring?.schematic)
    .map(([type, authoring]) => [type, authoring.schematic])
);

/**
 * Per-preset overrides, keyed "<type>:<presetId>" — flattened from each type's
 * `presetSchematics`. Presets absent here fall back to the base type's glyph.
 * @type {Record<string, Object>}
 */
const SLIDE_TYPE_PRESET_SCHEMATIC = Object.fromEntries(
  Object.entries(SLIDE_TYPE_AUTHORING).flatMap(([type, authoring]) =>
    Object.entries(authoring?.presetSchematics || {}).map(([presetId, spec]) => [
      `${type}:${presetId}`,
      spec,
    ])
  )
);

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
