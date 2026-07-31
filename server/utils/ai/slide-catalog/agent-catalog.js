/**
 * The agent-facing slide-type contract.
 *
 * `get_slide_types` (MCP) used to iterate SLIDE_TYPE_CATALOG — the hand-written
 * editorial catalog — which made a registered type without a catalog entry
 * invisible to agents, and indistinguishable from a type that was withheld on
 * purpose. Coverage now comes from the runtime registry, with the editorial
 * catalog as an overlay on top of it. Every registered type lands in exactly
 * one of three states:
 *
 *   registered type ─┬─ deprecated / `ai: false`  → deliberately not offered
 *                    ├─ has a catalog entry       → full editorial copy
 *                    └─ neither                   → derived entry, documented:false
 *
 * There is no fourth state, and "forgot to write an entry" is now the third
 * one (visible but flagged) rather than silent absence.
 *
 * The three states differ only in *prose*. The content schema is the same
 * derivation in all of them — the type's own `fields[]`, via deriveAgentSchema()
 * — because a hand-written second copy is a copy that drifts, and did.
 *
 * Tier 2 — per-organization slide types defined in the database — is resolved
 * on top of that, keyed `custom-<slug>`, the same key `/api/slide-types` and
 * `buildPhase2CatalogPrompt` already use. That is what makes the no-code path
 * and the agent path meet: a type built in the builder UI reaches Claude.
 *
 * On top of that sits `usage` (shared/slide-types/usage.js): the organization's
 * own rules for filling a type, as opposed to the editorial copy that says which
 * type to pick. It is optional everywhere and omitted when empty, and it is the
 * only field here an organization writes about itself rather than about the
 * type.
 *
 * This module is pure: the caller supplies the org-resolved inputs
 * (`disabledSlideTypes`, `customSlideTypes`), exactly as
 * `buildPhase2CatalogPrompt` takes them, so there is no third convention and no
 * storage import in the catalog layer.
 */

import {
  SLIDE_TYPES,
  SLIDE_TYPE_IDS,
  GLOBAL_SLIDE_FIELD_KEYS,
} from '../../../../shared/slide-types/registry.js';
import { formatCanonicalId } from '../../../../shared/slide-types/type-id.js';
import { SLIDE_TYPE_CATALOG } from './definitions.js';
import { clampUsage } from '../../../../shared/slide-types/usage.js';

const GLOBAL_FIELDS = new Set(GLOBAL_SLIDE_FIELD_KEYS);

// Editor field types → the coarse schema vocabulary the agent contract uses.
// Anything unmapped degrades to 'string', which is the honest answer for a
// free-text field an agent has never seen before. `markdown` keeps its own name
// rather than collapsing to 'string': the hand-written schemas this derivation
// replaced made that distinction, and it tells an agent that inline emphasis
// and links will render instead of showing up as literal asterisks.
const FIELD_TYPE_TO_SCHEMA_TYPE = {
  string: 'string',
  markdown: 'markdown',
  code: 'string',
  csv: 'string',
  image: 'string',
  number: 'number',
  boolean: 'boolean',
  enum: 'enum',
  items: 'array',
  images: 'array',
};

/**
 * True when a slide-type definition is deliberately withheld from agents.
 *
 * Two markers, both explicit on the definition:
 *  - `deprecated: true` — already means "renderable, not authorable"; the
 *    editor's picker and the AI generator have honoured it for a while.
 *  - `ai: false` — "this type is not offered to agents", for live types with a
 *    reason other than deprecation (app-managed, an alias, a gated escape
 *    hatch). The same `ai` key carries the catalog entry on custom file-based
 *    types (`custom/slide-types/*.js`), so one field says either "here is my
 *    agent contract" or "I deliberately have none".
 *
 * @param {object} def - A slide-type definition from SLIDE_TYPES.
 * @returns {boolean}
 */
export function isAgentOptOut(def) {
  if (!def || typeof def !== 'object') return true;
  return def.deprecated === true || def.ai === false;
}

/**
 * True when a single field definition is outside the agent contract.
 *
 * Three markers, in order of how often they apply:
 *  - `deprecated: true` / `hidden: true` — the legacy numbered slots
 *    (`card3Title`, `logo7Image`, `row2Block1Body`) that mirror a structured
 *    array the agent already gets. `semantic-projection.js` reads `hidden` the
 *    same way, so this is the existing vocabulary rather than a new one.
 *  - `ai: false` — "this field is not offered to agents" for a live, editable
 *    field. Same key and same meaning as the type-level `ai: false` that
 *    isAgentOptOut() honours, one level down.
 *
 * The default is therefore *offered*: a field an author may fill is a field an
 * agent may fill, and withholding one is a decision somebody has to write down.
 * That is deliberate — the opposite default is what let the hand-written
 * schemas drift out of the registry unnoticed for as long as they did.
 *
 * @param {object} field - A field definition from a slide type's `fields[]`.
 * @returns {boolean}
 */
function isFieldOptOut(field) {
  return field?.deprecated === true || field?.hidden === true || field?.ai === false;
}

/**
 * Derive a content schema from a type's editor field definitions.
 *
 * This is the *only* source of the agent-facing `fields[]` shape. Catalog
 * entries carry the editorial layer (description, bestFor, notFor, examples)
 * and nothing about field types, limits or options: those live on the
 * definition, which is what the editor validates and the renderer reads. A
 * second hand-written copy could only ever be right by accident — and by the
 * time this derivation replaced it, two of the 31 entries were telling agents
 * to fill a field no renderer reads (`payoff-slide.tagline`,
 * `video-slide.videoUrl`).
 *
 * Global fields (background image, logo, a11y…) are left out — they travel in
 * the response's `globalOptions` instead, and repeating them on every type
 * would bury the fields that actually distinguish it. Opted-out fields
 * (see isFieldOptOut) are left out too.
 *
 * @param {Array<object>} fields
 * @returns {Object<string, object>}
 */
export function deriveAgentSchema(fields) {
  const schema = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = typeof field?.key === 'string' ? field.key : '';
    if (!key || GLOBAL_FIELDS.has(key)) continue;
    if (isFieldOptOut(field)) continue;

    const entry = { type: FIELD_TYPE_TO_SCHEMA_TYPE[field.type] || 'string' };
    if (field.required === true) entry.required = true;
    if (typeof field.maxLength === 'number') entry.maxLength = field.maxLength;
    if (typeof field.min === 'number') entry.min = field.min;
    if (typeof field.max === 'number') entry.max = field.max;
    if (typeof field.minItems === 'number') entry.minItems = field.minItems;
    if (typeof field.maxItems === 'number') entry.maxItems = field.maxItems;
    if (Array.isArray(field.options)) {
      // Options are either bare values or { value, label } pairs.
      entry.options = field.options.map((o) =>
        o && typeof o === 'object' ? o.value : o
      );
    }
    // The editor's own prose about the field. It answers exactly the question
    // an agent has ("what goes in here, and when"), so it carries over rather
    // than being rewritten a second time in the catalog.
    const help = typeof field.helpText === 'string' ? field.helpText.trim() : '';
    if (help) entry.description = help;
    if (Array.isArray(field.itemFields) && field.itemFields.length) {
      entry.itemSchema = deriveAgentSchema(field.itemFields);
    }
    schema[key] = entry;
  }
  return schema;
}

/**
 * Pick the example content object for a type in the requested language.
 * @param {object} def - Definition or Tier-2 record (both carry defaults*).
 * @param {string} lang
 * @returns {object|null}
 */
function exampleFor(def, lang) {
  return (
    def?.defaultsByLang?.[lang] || def?.defaultsByLang?.nl || def?.defaults || null
  );
}

/**
 * The coarse agent-facing category for a catalog entry.
 *
 * Entries declare `category: 'structural'|'content'` and, redundantly,
 * `resolveInPhase1` (the AI generator's outline/detail split). Prefer the
 * declared category and fall back to the phase flag; the two are held in sync by
 * a test, so the fallback is belt-and-braces rather than a second convention.
 *
 * @param {object|undefined} catalogEntry
 * @returns {'structural'|'content'}
 */
function agentCategory(catalogEntry) {
  if (catalogEntry?.category === 'structural') return 'structural';
  if (catalogEntry?.category === 'content') return 'content';
  return catalogEntry?.resolveInPhase1 ? 'structural' : 'content';
}

/**
 * The `usage` half of an agent entry, present only when there is a rule.
 *
 * Spread rather than assigned so absence stays absence: an empty `usage` on
 * every type would be pure weight in a response that already carries a schema
 * and an example for each one. Ordered after the schema at the call sites, so an
 * agent reads "this is the shape" before "this is your house rule".
 *
 * @param {unknown} value - Raw usage text from a catalog entry or DB record.
 * @returns {{ usage?: string }}
 */
function usageField(value) {
  const usage = clampUsage(value);
  return usage ? { usage } : {};
}

/**
 * Build the agent-facing entry for one registered (Tier-1) type.
 * @param {string} name
 * @param {object} def
 * @param {object|undefined} catalogEntry
 * @param {string} lang
 * @returns {object}
 */
function tier1Entry(name, def, catalogEntry, lang) {
  const documented = Boolean(catalogEntry);
  const label = typeof def?.label === 'string' ? def.label : name;

  return {
    typeId: SLIDE_TYPE_IDS[name] || formatCanonicalId({ name }),
    label,
    // The catalog entry states the category directly; `resolveInPhase1` carries
    // the same split for entries written before the field existed. An
    // undocumented type has neither signal and can only be filed as 'content',
    // which would drop a structural one out of a category:'structural' filter —
    // so "no core type reaches agents undocumented" is a gate, not a nicety
    // (tests/slide-type-companion-coverage.test.js).
    category: agentCategory(catalogEntry),
    description: documented
      ? (catalogEntry.description || '').trim()
      : `${label}. No editorial guidance has been written for this type yet; ` +
        'the schema below is derived from its field definitions.',
    bestFor: catalogEntry?.bestFor || [],
    notFor: catalogEntry?.notFor || [],
    // Always derived — a catalog entry has no say in the shape, only in the
    // prose about it. See deriveAgentSchema().
    schema: deriveAgentSchema(def?.fields),
    example: exampleFor(def, lang),
    // false = registered and usable, but nobody has written the editorial copy.
    // Surfacing the gap beats hiding the type.
    documented,
    ...usageField(catalogEntry?.usage),
  };
}

/**
 * Build the agent-facing entry for one Tier-2 (per-organization) type.
 * @param {object} ct - Record from listPublishedCustomSlideTypes().
 * @param {string} lang
 * @returns {object}
 */
function tier2Entry(ct, lang) {
  const label = ct.label || ct.slug;
  const base = ct.baseType ? ` Based on ${ct.baseType}.` : '';
  return {
    typeId: `custom/${ct.slug}`,
    label,
    category: 'content',
    description:
      `${label} — a slide type defined by this organization.${base} ` +
      'The schema below is derived from its field definitions.',
    bestFor: [],
    notFor: [],
    schema: deriveAgentSchema(ct.fields),
    example: exampleFor(ct, lang),
    // `documented` tracks editorial copy on the description/bestFor axis, which
    // Tier 2 has no columns for. A type with `usage` is better described, but
    // not documented in that sense - overloading the flag would make it mean two
    // things and stop being a usable signal for either.
    documented: false,
    isCustom: true,
    ...usageField(ct.usage),
  };
}

/**
 * Resolve the slide types one organization's agents may use.
 *
 * @param {Object} [options]
 * @param {string} [options.lang='nl'] - Language for the example content.
 * @param {'structural'|'content'|'all'} [options.category='all'] - Filter.
 * @param {string[]} [options.disabledSlideTypes] - Org-level disabled types;
 *   the editor and the AI generator honour these, so agents must too.
 * @param {Array<object>} [options.customSlideTypes] - Published Tier-2 types
 *   for the organization (from loadCustomSlideTypes).
 * @returns {Object<string, object>} Entries keyed by slide-type name.
 */
export function resolveAgentSlideTypes({
  lang = 'nl',
  category = 'all',
  disabledSlideTypes = [],
  customSlideTypes = [],
} = {}) {
  const disabled = new Set(
    Array.isArray(disabledSlideTypes) ? disabledSlideTypes : []
  );
  const types = {};

  const keep = (entry) =>
    category === 'all' || entry.category === category;

  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    if (isAgentOptOut(def)) continue;
    if (disabled.has(name)) continue;
    const entry = tier1Entry(name, def, SLIDE_TYPE_CATALOG[name], lang);
    if (keep(entry)) types[name] = entry;
  }

  for (const ct of Array.isArray(customSlideTypes) ? customSlideTypes : []) {
    if (!ct?.slug) continue;
    const key = `custom-${ct.slug}`;
    if (disabled.has(key)) continue;
    const entry = tier2Entry(ct, lang);
    if (keep(entry)) types[key] = entry;
  }

  return types;
}
