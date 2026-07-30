/**
 * The picker's authoring companions that are not the `group` axis — its glyph,
 * its sample content, its tile description and its search aliases — each
 * resolved by the same seam rule as `group`.
 *
 * ## Why these lookups moved out of the editor
 *
 * `schematicFor()` and `getSampleContent()` have always checked the definition
 * before the per-type map, precisely so a fork type could ship a glyph or a
 * sample without owning a directory here. That branch was dead where it
 * mattered: the editor does not hold the registry, it holds the response of
 * `GET /api/slide-types`, and that route served neither key. A fork type could
 * declare `sampleContent` and no browser consumer would ever see it. The
 * description and aliases moved here for the same reason: the picker reads them
 * off the `/api/slide-types` response, so a fork type's copy only reaches it if
 * the route carries the resolved value (see server/routes/api/slide-types.js).
 *
 * Fixing the route means the server resolves the same three companions the
 * editor does, and a lookup that two sides perform is a lookup that belongs to
 * neither. So it lives here, next to `./authoring-groups.js`, and the editor
 * surfaces keep the parts that are genuinely theirs (merging `defaults`, the
 * preset-tile plumbing, the theme's `sampleEmbedUrl` override).
 *
 * ## The rule, in one line each
 *
 * 1. The definition as it exists at runtime is asked first.
 * 2. `SLIDE_TYPE_AUTHORING` — a build artifact over the *core* type directories
 *    — is core's answer, never the population.
 * 3. A miss is "fall back", never an error: the picker has a generic tile for a
 *    type with no glyph and an empty sample for one with no example.
 *
 * @see docs/reference/slide-type-groups.md — the seam rule, written out.
 * @see docs/reference/slide-type-directory.md — what else a type's directory owns.
 */

import { SLIDE_TYPE_AUTHORING } from './authoring.js';

/**
 * Base glyph per core slide type, derived from each type's `authoring.js`.
 * Exported as a map because the companion-coverage test reads it by name.
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_SCHEMATIC = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, authoring]) => authoring?.schematic)
      .map(([type, authoring]) => [type, authoring.schematic])
  )
);

/**
 * Per-preset overrides, keyed `"<type>:<presetId>"` — flattened from each
 * type's `presetSchematics`. A preset absent here falls back to the base glyph.
 * @type {Readonly<Record<string, Object>>}
 */
const SLIDE_TYPE_PRESET_SCHEMATIC = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING).flatMap(([type, authoring]) =>
      Object.entries(authoring?.presetSchematics || {}).map(([presetId, spec]) => [
        `${type}:${presetId}`,
        spec,
      ])
    )
  )
);

/**
 * Sample content per core slide type, derived from each type's `authoring.js`.
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_SAMPLE_CONTENT = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, authoring]) => authoring?.sample !== undefined)
      .map(([type, authoring]) => [type, authoring.sample])
  )
);

/**
 * The schematic spec for a type (optionally for one of its preset tiles).
 *
 * Precedence: a preset-specific override, then the definition's own
 * `schematic`, then core's base glyph, then `null` — the picker falls back to a
 * generic text-only diagram.
 *
 * @param {string} type - registry type name
 * @param {{schematic?: unknown}|null} [def] - the definition as it exists at runtime
 * @param {string|null} [presetId] - curated preset id, when the tile is a variant
 * @returns {Object|null}
 */
export function slideTypeSchematic(type, def = null, presetId = null) {
  const override = presetId ? SLIDE_TYPE_PRESET_SCHEMATIC[`${type}:${presetId}`] : null;
  if (override) return override;
  if (def?.schematic && typeof def.schematic === 'object') return def.schematic;
  return SLIDE_TYPE_SCHEMATIC[type] || null;
}

/**
 * The example content for a type, unmerged: what a good slide of this type
 * looks like, as opposed to `defaults`, which is what an empty one looks like.
 *
 * The definition's key is `sampleContent` (it is the fork-facing name, and what
 * `/api/slide-types` carries); core's is `sample` inside `authoring.js`.
 *
 * @param {string} type - registry type name
 * @param {{sampleContent?: unknown}|null} [def] - the definition as it exists at runtime
 * @returns {Object|undefined} undefined when neither side has an example
 */
export function slideTypeSample(type, def = null) {
  const declared = def?.sampleContent;
  if (declared && typeof declared === 'object') return declared;
  return SLIDE_TYPE_SAMPLE_CONTENT[type];
}

/**
 * Picker tile description per core slide type, derived from each type's
 * `authoring.js`. Exported as a map because the companion-coverage test reads
 * it by name. English here is the fallback; the editor layers the translation
 * (`editor.slideTypeDesc.<type>`) on top.
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_TYPE_DESCRIPTION = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, authoring]) => typeof authoring?.description === 'string')
      .map(([type, authoring]) => [type, authoring.description])
  )
);

/**
 * Picker search aliases per core slide type, derived from each type's
 * `authoring.js`. Exported as a map because the companion-coverage test reads
 * it by name. Extra search terms only (incl. Dutch); never displayed.
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_TYPE_ALIASES = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, authoring]) => typeof authoring?.aliases === 'string')
      .map(([type, authoring]) => [type, authoring.aliases])
  )
);

/**
 * A type's picker description: the definition's own `description` first, this
 * build's authoring aggregator second — the aggregator-seam rule (definition
 * as it exists at runtime wins, core's answer is the fallback). The picker
 * holds the `/api/slide-types` response, so a core type's `description` reaches
 * this function already resolved on the wire; a fork type's declaration reaches
 * it the same way.
 *
 * @param {string} type - registry type name
 * @param {{description?: unknown}|null} [def] - the definition as it exists at runtime
 * @returns {string} the description, or `''` when neither side has one
 */
export function slideTypeDescription(type, def = null) {
  const declared = def?.description;
  if (typeof declared === 'string') return declared;
  return SLIDE_TYPE_DESCRIPTION[type] || '';
}

/**
 * A type's picker search aliases, resolved by the same rule as
 * {@link slideTypeDescription}. Folded into the picker's search haystack only.
 *
 * @param {string} type - registry type name
 * @param {{aliases?: unknown}|null} [def] - the definition as it exists at runtime
 * @returns {string} the alias string, or `''` when neither side has one
 */
export function slideTypeAliases(type, def = null) {
  const declared = def?.aliases;
  if (typeof declared === 'string') return declared;
  return SLIDE_TYPE_ALIASES[type] || '';
}
