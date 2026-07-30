/**
 * The remaining authoring companions — the picker's copy, glyph and sample
 * content — resolved by the same seam rule as `group`.
 *
 * ## Why these lookups moved out of the editor
 *
 * `schematicFor()` and `getSampleContent()` have always checked the definition
 * before the per-type map, precisely so a fork type could ship a glyph or a
 * sample without owning a directory here. That branch was dead where it
 * mattered: the editor does not hold the registry, it holds the response of
 * `GET /api/slide-types`, and that route served neither key. A fork type could
 * declare `sampleContent` and no browser consumer would ever see it.
 *
 * Fixing the route means the server resolves the same companions the editor
 * does, and a lookup that two sides perform is a lookup that belongs to
 * neither. So it lives here, next to `./authoring-groups.js`, and the editor
 * surfaces keep the parts that are genuinely theirs (merging `defaults`, the
 * preset-tile plumbing, the theme's `sampleEmbedUrl` override).
 *
 * The picker's `description` and `aliases` joined them later and had the same
 * shape of problem for a different reason: their maps lived in the picker's own
 * `data.js`, so there was no definition-first branch to be dead — a fork type
 * simply had nowhere to put a description, and got its bare label. Both now
 * resolve here and both travel on the route.
 *
 * ## The rule, in one line each
 *
 * 1. The definition as it exists at runtime is asked first.
 * 2. `SLIDE_TYPE_AUTHORING` — a build artifact over the *core* type directories
 *    — is core's answer, never the population.
 * 3. A miss is "fall back", never an error: the picker has a generic tile for a
 *    type with no glyph, an empty sample for one with no example, and the bare
 *    label for one with no description.
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
 * Picker description per core slide type — the "what is this" line the tile
 * shows as its tooltip. Exported as a map because the companion-coverage test
 * reads it by name.
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_TYPE_DESC = Object.freeze(
  Object.fromEntries(
    Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, authoring]) => typeof authoring?.description === 'string')
      .map(([type, authoring]) => [type, authoring.description])
  )
);

/**
 * Search aliases per core slide type — extra terms (incl. Dutch) folded into
 * the picker's search haystack, never displayed.
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
 * The picker's one-line description of a type, untranslated.
 *
 * The English string is the fallback the caller hands to `t()`; the translated
 * copy lives under `editor.slideTypeDesc.<type>` in the i18n files, which is
 * why this returns a plain string and does no localisation of its own.
 *
 * @param {string} type - registry type name
 * @param {{description?: unknown}|null} [def] - the definition as it exists at runtime
 * @returns {string} '' when neither side has one — the tile shows its bare label
 */
export function slideTypeDescription(type, def = null) {
  const declared = def?.description;
  if (typeof declared === 'string' && declared.trim()) return declared;
  return SLIDE_TYPE_DESC[type] || '';
}

/**
 * The extra search terms for a type, as one space-separated string.
 *
 * Folded into the picker's search haystack alongside the label, the raw type
 * key and the description, so an unofficial or Dutch name still finds the tile.
 *
 * @param {string} type - registry type name
 * @param {{aliases?: unknown}|null} [def] - the definition as it exists at runtime
 * @returns {string} '' when neither side has any
 */
export function slideTypeAliases(type, def = null) {
  const declared = def?.aliases;
  if (typeof declared === 'string' && declared.trim()) return declared;
  return SLIDE_TYPE_ALIASES[type] || '';
}
