/**
 * The slide-type companion matrix — the machine-readable inventory behind
 * tests/slide-type-companion-coverage.test.js.
 *
 * Registering a slide type gets you the editor form, the JSON schema, the
 * validation and the i18n key scaffolding for free: those are *derived* from the
 * definition. What is not derived is a set of hand-maintained **companions** —
 * the AI catalog entry, the picker's description/search terms/schematic, the
 * settings curation category. Every one of them degrades gracefully when it is
 * missing, which is exactly why the drift is silent: nothing breaks, the type
 * just gets quietly worse. `slide-type-schematics.js` even carries the comment
 * "Keep this aligned with SLIDE_TYPE_DESC / SLIDE_TYPE_PRESETS" — a human asked
 * to do a test's job.
 *
 * This module says, per companion: who owes it, whether it is present, and
 * which types are exempt and why. The test drives both directions off that, so
 * neither a new type nor a stale exemption can slip through.
 *
 * Human-facing version of the same inventory (including the *derived* column):
 * docs/reference/slide-type-companions.md.
 *
 * Scope: **core** types only. A fork-local type from `custom/slide-types/` can
 * ship its own `ai:{}` block and `schematic` field, but it cannot add a row to
 * core's tracked picker maps, so holding it to this matrix would fail the suite
 * on any fork install. Same line `git ls-files` draws in
 * tests/removed-slide-types.test.js.
 */

import {
  SLIDE_TYPES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../../shared/slide-types/registry.js';
import { SLIDE_TYPE_CATALOG } from '../../server/utils/ai/slide-catalog/definitions.js';
import { SLIDE_TYPE_EXAMPLES } from '../../server/utils/ai/slide-catalog/examples.js';
import { isAgentOptOut } from '../../server/utils/ai/slide-catalog/agent-catalog.js';
import { SLIDE_SCHEMAS } from '../../server/utils/ai/schemas/refined-slide.js';
import { STRUCTURE_VALIDATORS } from '../../server/utils/ai/validate-slide-structure.js';
import { slideStructure } from '../../shared/slide-types/structure.js';
import { MANUAL_EXAMPLES } from '../../server/utils/openai/slide-types-prompt.js';
import { SLIDE_TYPE_SCHEMATIC } from '../../client/views/editor/slide-type-schematics.js';
import { INLINE_DESCRIPTORS } from '../../client/views/editor/inline-edit/descriptors.js';
import { INSPECTOR_KEEPS } from '../../client/views/editor/editor-form/inspector-form.js';
import { SLIDE_TYPE_GROUP } from '../../shared/slide-types/authoring-groups.js';
import {
  SLIDE_TYPE_DESCRIPTION,
  SLIDE_TYPE_ALIASES,
} from '../../shared/slide-types/authoring-companions.js';

/** Registered type names, minus fork-local ones (see the scope note above). */
export const CORE_SLIDE_TYPE_NAMES = Object.keys(SLIDE_TYPES).filter(
  (name) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name)
);

/**
 * Types an author can still reach from the picker. `deprecated: true` is the
 * existing "renderable, not authorable" marker (see isInsertableSlideType);
 * a deprecated type owes no author-facing companion, and keeping one around is
 * rot the reverse direction catches.
 * @param {object} def
 * @returns {boolean}
 */
const isAuthorable = (def) => def?.deprecated !== true;

/**
 * Types whose *editing* surfaces still matter — which is all of them.
 *
 * The distinction is worth spelling out: an author-facing companion (picker,
 * curation, agent catalog) dies with deprecation, but an editing companion
 * outlives it. A deprecated type is gone from every insertion path while stored
 * decks keep slides of that type, and those slides still get opened in the
 * editor. `deprecated` exempts a type from being *offered*, never from being
 * *edited*.
 *
 * @returns {boolean}
 */
const isEditable = () => true;

/** Every type that declares a curation/picker group. */
const groupedTypes = () => Object.keys(SLIDE_TYPE_GROUP);

/**
 * Types whose primary content is a repeated-item collection — the only shape a
 * structural validator can meaningfully check beyond the flat field schema (see
 * the `structure-validation` companion). `singleton`, `dataset`, `tabular` and
 * `chrome` are validated field-by-field elsewhere and owe no structural case.
 * @param {object} def
 * @returns {boolean}
 */
const isCollectionShaped = (def) => {
  const s = slideStructure(def);
  return s === 'collection' || s === 'fixed-collection';
};

/**
 * @typedef {Object} Companion
 * @property {string} id - Stable slug, used in failure messages.
 * @property {string} label - Human name.
 * @property {string} where - Source of truth, repo-relative.
 * @property {string} degradesTo - What silently happens when it is missing.
 * @property {(name: string, def: object) => boolean} appliesTo - Who owes it.
 * @property {(name: string, def: object) => boolean} has - Is it present.
 * @property {() => string[]} keys - Declared keys, for the reverse direction.
 * @property {boolean} [optional] - Sparse by design: skip forward coverage.
 * @property {Object<string, string>} exempt - name → why it owes nothing.
 */

/**
 * Types that owe `companion` and do not have it (exemptions excluded).
 * Pure over the type map so the rule itself is testable — see the
 * "the gate bites" cases in the test file.
 *
 * @param {Companion} companion
 * @param {string[]} names
 * @param {Object<string, object>} types
 * @returns {string[]}
 */
export function missingFor(companion, names, types) {
  return names.filter(
    (name) =>
      companion.appliesTo(name, types[name]) &&
      !companion.has(name, types[name]) &&
      !Object.prototype.hasOwnProperty.call(companion.exempt, name)
  );
}

/**
 * Declared companion entries that name a type which is gone, deprecated, or
 * opted out of this companion (exemptions excluded).
 *
 * @param {Companion} companion
 * @param {Object<string, object>} types
 * @returns {string[]}
 */
export function staleFor(companion, types) {
  return companion.keys().filter((name) => {
    if (Object.prototype.hasOwnProperty.call(companion.exempt, name)) return false;
    const def = types[name];
    if (!def) return true; // an entry for a type that is not registered at all
    return !companion.appliesTo(name, def);
  });
}

/** @type {Companion[]} */
export const COMPANIONS = [
  {
    id: 'ai-catalog',
    label: 'AI / MCP catalog entry',
    where:
      'shared/slide-types/types/<name>/ai.js — surfaced as SLIDE_TYPE_CATALOG ' +
      'by server/utils/ai/slide-catalog/definitions.js',
    degradesTo:
      'a derived entry flagged documented:false — usable, but with no editorial ' +
      'guidance on when to pick the type, and category falls back to "content"',
    appliesTo: (name, def) => !isAgentOptOut(def),
    has: (name) => Boolean(SLIDE_TYPE_CATALOG[name]),
    keys: () => Object.keys(SLIDE_TYPE_CATALOG),
    exempt: {},
  },
  {
    id: 'ai-examples',
    label: 'AI prompt examples',
    where: 'server/utils/ai/slide-catalog/examples/ (SLIDE_TYPE_EXAMPLES)',
    degradesTo: 'the prompt describes the schema without showing filled-in content',
    // Sparse on purpose: examples exist for the types whose shape is hard to
    // infer from a schema alone. Forward coverage is a quality goal, not a gate.
    optional: true,
    appliesTo: (name, def) => !isAgentOptOut(def),
    has: (name) => Boolean(SLIDE_TYPE_EXAMPLES[name]),
    keys: () => Object.keys(SLIDE_TYPE_EXAMPLES),
    exempt: {},
  },
  {
    id: 'v1-manual-examples',
    label: 'v1 generator manual example',
    where: 'server/utils/openai/slide-types-prompt.js (MANUAL_EXAMPLES)',
    degradesTo: 'the v1 prompt falls back to the catalog example, then to defaults',
    // Sparse by design: an override exists only where a catalog example gets the
    // shape wrong. Only the reverse direction is a gate.
    optional: true,
    appliesTo: (name, def) => !isAgentOptOut(def),
    has: (name) => typeof MANUAL_EXAMPLES[name] === 'function',
    keys: () => Object.keys(MANUAL_EXAMPLES),
    exempt: {},
  },
  {
    id: 'picker-description',
    label: 'Picker description',
    where:
      'shared/slide-types/types/<name>/authoring.js (description) — surfaced as ' +
      'SLIDE_TYPE_DESCRIPTION by shared/slide-types/authoring-companions.js',
    degradesTo: 'the picker tile shows the bare label with no "what is this" tooltip',
    appliesTo: (name, def) => isAuthorable(def),
    // A fork type may declare its own `description` on the definition
    // (slideTypeDescription checks that first), so either source counts.
    has: (name, def) =>
      typeof SLIDE_TYPE_DESCRIPTION[name] === 'string' ||
      typeof def?.description === 'string',
    keys: () => Object.keys(SLIDE_TYPE_DESCRIPTION),
    exempt: {},
  },
  {
    id: 'picker-search-aliases',
    label: 'Picker search aliases',
    where:
      'shared/slide-types/types/<name>/authoring.js (aliases) — surfaced as ' +
      'SLIDE_TYPE_ALIASES by shared/slide-types/authoring-companions.js',
    degradesTo:
      'the type is only findable by its exact label — searching "tabel" or ' +
      '"smoelenboek" will not surface it',
    appliesTo: (name, def) => isAuthorable(def),
    // A fork type may declare its own `aliases` on the definition too.
    has: (name, def) =>
      typeof SLIDE_TYPE_ALIASES[name] === 'string' ||
      typeof def?.aliases === 'string',
    keys: () => Object.keys(SLIDE_TYPE_ALIASES),
    exempt: {},
  },
  {
    id: 'picker-schematic',
    label: 'Picker schematic glyph',
    where:
      'shared/slide-types/types/<name>/authoring.js (schematic) — surfaced as ' +
      'SLIDE_TYPE_SCHEMATIC by client/views/editor/slide-type-schematics.js',
    degradesTo: 'the picker tile falls back to a generic text-only diagram',
    appliesTo: (name, def) => isAuthorable(def),
    // A fork type may ship its own `schematic` on the definition (schematicFor
    // checks that first), so either source counts as covered.
    has: (name, def) =>
      Boolean(SLIDE_TYPE_SCHEMATIC[name]) ||
      Boolean(def?.schematic && typeof def.schematic === 'object'),
    keys: () => Object.keys(SLIDE_TYPE_SCHEMATIC),
    exempt: {},
  },
  {
    id: 'picker-group',
    label: 'curated group',
    where:
      'shared/slide-types/types/<name>/authoring.js (group) — surfaced as ' +
      'SLIDE_TYPE_GROUP by shared/slide-types/authoring-groups.js',
    degradesTo:
      'the picker drops the tile into its computed "Other" group and the ' +
      'settings curation list into its "Other" heading',
    appliesTo: (name, def) => isAuthorable(def),
    has: (name) => Boolean(SLIDE_TYPE_GROUP[name]),
    keys: groupedTypes,
    exempt: {},
  },
  {
    id: 'inline-edit-descriptor',
    label: 'inline-edit descriptor',
    where: 'client/views/editor/inline-edit/descriptors.js (INLINE_DESCRIPTORS)',
    degradesTo:
      'the slide has no on-canvas editing at all — every field is side-form only',
    // Editing outlives deprecation (see isEditable): stored decks still open.
    appliesTo: isEditable,
    // A fork type may declare `inline: {}` on its definition instead.
    has: (name, def) =>
      Boolean(INLINE_DESCRIPTORS[name]) ||
      Boolean(def?.inline && typeof def.inline === 'object'),
    keys: () => Object.keys(INLINE_DESCRIPTORS),
    exempt: {
      'follow-invite-slide':
        'app-managed slide (QR + join code); it carries no author-written text ' +
        'to edit on canvas, and the picker refuses to insert it',
      'custom-html-slide':
        'the content is raw HTML/CSS edited in a code field — an inline ghost ' +
        'over rendered output would fight the source of truth',
      'payoff-slide':
        'open gap, not a principle: a single statement line that could carry a ' +
        'descriptor. Recorded here so it is a known absence rather than a silent one',
    },
  },
  {
    id: 'inspector-keeps',
    label: 'inspector keep-list',
    where: 'client/views/editor/editor-form/inspector-form.js (INSPECTOR_KEEPS)',
    degradesTo:
      'the inspector shows every field the inline layer does not cover — the ' +
      'safe default, which is why only a stale entry is a problem',
    optional: true,
    appliesTo: isEditable,
    has: (name) => Array.isArray(INSPECTOR_KEEPS[name]),
    keys: () => Object.keys(INSPECTOR_KEEPS),
    exempt: {},
  },
  {
    id: 'refine-schema',
    label: 'refine content schema',
    where: 'server/utils/ai/schemas/refined-slide.js (SLIDE_SCHEMAS)',
    degradesTo:
      'validateSlideContent() hits the "Unknown slide type" branch and skips ' +
      'validation, so the refine phase never notices malformed content for the type',
    // Owed by every type an agent can emit. The refine phase only ever validates
    // agent output, so an agent-opt-out type (deprecated / ai:false) never
    // reaches this map and owes nothing — the same rule as the AI catalog. Even a
    // chrome type owes a (trivial) schema: it keeps the unknown-type warning
    // meaningful.
    appliesTo: (name, def) => !isAgentOptOut(def),
    has: (name) => Boolean(SLIDE_SCHEMAS[name]),
    keys: () => Object.keys(SLIDE_SCHEMAS),
    exempt: {},
  },
  {
    id: 'structure-validation',
    label: 'structural validator',
    where: 'server/utils/ai/validate-slide-structure.js (STRUCTURE_VALIDATORS)',
    degradesTo:
      'validateSlideContentStructure() returns no issues, so a collection with ' +
      'too few items or a missing item field is accepted unvalidated by refine',
    // Narrower than refine-schema: this validator earns its keep only on
    // repeated-item collections, where cardinality and per-item required fields
    // are invariants the flat field/Zod schema cannot express. Singleton,
    // dataset, tabular and chrome types are validated field-by-field there and
    // owe no structural case.
    appliesTo: (name, def) => !isAgentOptOut(def) && isCollectionShaped(def),
    has: (name) => Boolean(STRUCTURE_VALIDATORS[name]),
    keys: () => Object.keys(STRUCTURE_VALIDATORS),
    exempt: {},
  },
];
