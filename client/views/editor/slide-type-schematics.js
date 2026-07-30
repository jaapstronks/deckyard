// Schematic glyph resolution for the slide-type picker's "Schematic" view mode.
// A descriptor is a JSON-safe spec understood by renderSlideSchematic() — see
// client/lib/slide-authoring/slide-schematic.js for the grammar.
//
// This file holds neither the glyphs nor the lookup any more. Every core type
// declares its own in `shared/slide-types/types/<name>/authoring.js`, and the
// resolution lives in the facet module beside the declarations
// (shared/slide-types/authoring-companions.js) because the server performs the
// same lookup when it serves /api/slide-types. What is left here is the editor's
// call shape: the picker asks by tile, so it passes a preset id.
//
// Resolution precedence (see slideTypeSchematic) is unchanged:
//   1. a preset-specific override (key `"<type>:<presetId>"`)
//   2. the slide-type definition's own `schematic` field (lets custom/fork
//      types ship an icon without owning a directory here) — reaching the
//      editor over /api/slide-types since the seam fix
//   3. the base entry for the type
//   4. null -> the picker falls back to a generic text-only diagram
//
// Every insertable type still needs a glyph, and a retired one must not keep
// its own: tests/slide-type-companion-coverage.test.js enforces both directions
// against SLIDE_TYPE_SCHEMATIC.

import {
  SLIDE_TYPE_SCHEMATIC,
  slideTypeSchematic,
} from '../../../shared/slide-types/authoring-companions.js';

/**
 * Base glyph per slide type, derived from each type's `authoring.js`.
 * Re-exported here because the picker and the companion-coverage test both read
 * it by type name.
 * @type {Readonly<Record<string, Object>>}
 */
export { SLIDE_TYPE_SCHEMATIC };

/**
 * Resolve the schematic spec for a picker tile.
 * @param {string} type - slide type key
 * @param {string|null} [presetId] - curated preset id, when the tile is a variant
 * @param {Object|null} [def] - the slide-type definition (for its own `schematic`)
 * @returns {Object|null} a schematic spec, or null to fall back to text-only
 */
export function schematicFor(type, presetId = null, def = null) {
  return slideTypeSchematic(type, def, presetId);
}
