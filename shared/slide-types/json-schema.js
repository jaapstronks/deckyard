/**
 * JSON Schema generation for the deck format.
 *
 * Move 1c of the datamodel-purity track. The real schema used to be "39 JS
 * files plus a runtime reflection endpoint": the OpenAPI spec typed a slide's
 * `content` as an opaque `object`, so an outside integrator met a model that
 * declined to describe itself. This module derives a real, versioned JSON
 * Schema straight from the single `fields[]` registry (via the declared
 * field-type vocabulary), so validation, the docs and the published contract
 * all trace back to one source. The schema is generated live from
 * `SLIDE_TYPES` on every request rather than committed as an artifact, so
 * there is no second copy that can drift; a test validates every core slide
 * type's real default content against its generated schema.
 *
 * The generated deck schema is self-contained: every slide type's content
 * schema lives under `$defs`, and a discriminated `slide` (`if type === X then
 * content matches X`) wires them together with local `#/$defs/...` refs.
 */

import { FIELD_TYPES, enumOptionValues } from './field-types.js';
import { CURRENT_SCHEMA_VERSION } from './schema-version.js';
import {
  CORE_NAMESPACE,
  TYPE_ID_PATTERN,
  canonicalTypeName,
  formatCanonicalId,
  formatTypeId,
} from './type-id.js';

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * A BCP 47 language tag, as the `langtag` production of RFC 5646 minus the
 * grandfathered forms: language, optional extended-language, script, region,
 * variants, singleton extensions and private use.
 *
 * The published schema used to carry `enum: ['nl', 'en-GB']` here. That is the
 * same origin story as the type set — Deckyard was abstracted out of a Dutch
 * organisation's fork — and a universal presentation format that admits only
 * Dutch and British English is not a universal presentation format.
 *
 * The distinction that keeps this from being a product change: the **app** may
 * stay limited to the languages its editor supports (`normalizeLang()` in
 * `shared/i18n-utils.js` and `SUPPORTED_LANGS` in the storage layer still take
 * `nl` and `en-GB` only, and nothing reads this schema to decide), but the
 * **format** has no business being.
 */
const BCP47_PATTERN =
  '^[a-zA-Z]{2,3}(-[a-zA-Z]{3}){0,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|[0-9]{3}))?' +
  '(-([a-zA-Z0-9]{5,8}|[0-9][a-zA-Z0-9]{3}))*' +
  '(-[a-wy-zA-WY-Z0-9](-[a-zA-Z0-9]{2,8})+)*' +
  '(-[xX](-[a-zA-Z0-9]{1,8})+)?$';

/**
 * Canonical publish base for `$id`s. The schemas are (to be) served statically
 * under this host by deckyard-website. The version in the path is
 * `CURRENT_SCHEMA_VERSION` (the content-schema version), not the envelope
 * `version` — see `schema-version.js`.
 */
export const SCHEMA_BASE_URI = 'https://deckyard.eu/schema';

/** `$defs` key for a slide type's content schema. */
function contentDefKey(typeName) {
  return `content_${String(typeName).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/**
 * Whether a field belongs in the *published* contract.
 *
 * A definition's `fields[]` is the editor's list, and it deliberately carries
 * shapes we no longer want anyone to build on: the legacy numbered mirrors of
 * an `items[]` array (`card1Name`…`card25Linkedin`), their counters, and the
 * hidden slots the dual-write still reads. Those keys keep *parsing* - the
 * schema stays lenient (`additionalProperties: true`), so stored decks that
 * carry them still validate - but publishing them under `properties` states
 * them as the contract, which is the opposite of what `deprecated`/`hidden`
 * mean.
 *
 * `ai: false` is deliberately **not** part of this test. That flag withholds a
 * field from agents for editorial reasons (`video-slide.watchUrl` points at a
 * landing page only a human knows exists); it is a live field an author fills,
 * so it stays in the contract. Compare `isFieldOptOut()` in
 * `server/utils/ai/slide-catalog/agent-catalog.js`, which is the agent-facing
 * predicate and does include `ai: false`.
 *
 * @param {any} field
 * @returns {boolean}
 */
function isPublishedField(field) {
  return field?.deprecated !== true && field?.hidden !== true;
}

/**
 * JSON Schema for a single field's value, derived from its declared type plus
 * field-level constraints. Kept lenient (no `additionalProperties: false`) so
 * legacy decks with extra keys still validate - the schema is a contract, not a
 * gate that rejects historical shapes.
 * @param {any} field
 * @returns {object}
 */
export function fieldToJsonSchema(field) {
  const kind = FIELD_TYPES[field?.type]?.valueKind || 'string';
  /** @type {any} */
  let schema;
  switch (kind) {
    case 'number': {
      // Numbers honour the repo-wide '' cleared-value convention (see the
      // validator), so a value is either a number or the empty string.
      const num = { type: 'number' };
      if (Number.isFinite(Number(field.min))) num.minimum = Number(field.min);
      if (Number.isFinite(Number(field.max))) num.maximum = Number(field.max);
      schema = { anyOf: [num, { const: '' }] };
      break;
    }
    case 'boolean':
      schema = { anyOf: [{ type: 'boolean' }, { const: '' }] };
      break;
    case 'stringArray':
      schema = { type: 'array', items: { type: 'string' } };
      if (Number.isFinite(Number(field.maxItems))) schema.maxItems = Number(field.maxItems);
      break;
    case 'objectArray':
      schema = itemsToJsonSchema(field);
      break;
    case 'string':
    default:
      schema = { type: 'string' };
      if (Number.isFinite(Number(field.maxLength))) schema.maxLength = Number(field.maxLength);
      break;
  }

  // Enums list their allowed values. The cleared-field '' convention is always
  // permitted. The `background` field additionally accepts theme-defined
  // variant slugs (open set), so it stays an unconstrained string.
  if (field?.type === 'enum' && field.key !== 'background') {
    const values = enumOptionValues(field);
    schema.enum = Array.from(new Set([...values, '']));
  }

  const title = field?.label;
  if (typeof title === 'string' && title) schema.title = title;
  const desc = field?.helpText;
  if (typeof desc === 'string' && desc) schema.description = desc;
  return schema;
}

/** Array-of-objects schema for an `items` field, from its `itemFields`. */
function itemsToJsonSchema(field) {
  const itemFields = Array.isArray(field?.itemFields) ? field.itemFields : [];
  const properties = {};
  const required = [];
  for (const f of itemFields) {
    if (!f || typeof f.key !== 'string') continue;
    if (!isPublishedField(f)) continue;
    properties[f.key] = fieldToJsonSchema(f);
    if (f.required) required.push(f.key);
  }
  /** @type {any} */
  const items = { type: 'object', properties, additionalProperties: true };
  if (required.length) items.required = required;
  /** @type {any} */
  const schema = { type: 'array', items };
  if (Number.isFinite(Number(field.minItems))) schema.minItems = Number(field.minItems);
  if (Number.isFinite(Number(field.maxItems))) schema.maxItems = Number(field.maxItems);
  return schema;
}

/**
 * JSON Schema for one slide type's `content` object.
 *
 * Only fields that pass `isPublishedField()` become `properties`: a
 * `deprecated`/`hidden` field is a legacy representation the editor still
 * reads, not something the published contract should promise.
 * @param {string} typeName
 * @param {any} def - the slide-type definition (with `fields[]`)
 * @param {{withMeta?: boolean}} [opts] - withMeta adds `$id`/`$schema` (for a
 *   standalone per-type document); omit for an embedded `$defs` entry.
 * @returns {object}
 */
export function slideTypeContentSchema(typeName, def, opts = {}) {
  const fields = Array.isArray(def?.fields) ? def.fields : [];
  const properties = {};
  const required = [];
  for (const field of fields) {
    if (!field || typeof field.key !== 'string') continue;
    if (!isPublishedField(field)) continue;
    properties[field.key] = fieldToJsonSchema(field);
    if (field.required) required.push(field.key);
  }
  /** @type {any} */
  const schema = {
    title: `${typeName} slide content`,
    type: 'object',
    properties,
    // Lenient: decks carry legacy keys (e.g. bgImage) and forward-compatible
    // extras. The schema documents the known shape without rejecting history.
    additionalProperties: true,
  };
  if (required.length) schema.required = required;
  if (opts.withMeta) {
    return {
      $schema: JSON_SCHEMA_DIALECT,
      $id: `${SCHEMA_BASE_URI}/v${CURRENT_SCHEMA_VERSION}/slide-types/${typeName}.schema.json`,
      ...schema,
    };
  }
  return schema;
}

/**
 * Every spelling of a registered type that must select the same content schema.
 *
 * A type has one identity and (for core) three spellings: the stored key
 * (`title-slide`), the qualified form (`core/title-slide`) and the canonical
 * reverse-DNS id (`eu.deckyard.slide.title`). All three are valid in
 * `slides[].type`, so all three have to hit the same `if` branch — otherwise
 * writing the canonical id silently costs a deck its content contract, which is
 * the opposite of what publishing a canonical name is for.
 *
 * Versioned refs (`title-slide@2`) are deliberately not enumerated: a version is
 * a compatibility hint about a definition we do not have, so demanding the
 * current shape of it would be a claim we cannot back.
 *
 * @param {string} name - the registry key
 * @param {any} def - its definition (read only for a declared `namespace`)
 * @returns {string[]}
 */
function typeSpellings(name, def) {
  const namespace =
    typeof def?.namespace === 'string' && def.namespace ? def.namespace : CORE_NAMESPACE;
  const id = { namespace, name, version: null };
  const spellings = [name, formatTypeId(id), formatCanonicalId(id)];
  if (namespace === CORE_NAMESPACE) spellings.push(canonicalTypeName(name));
  return Array.from(new Set(spellings));
}

/**
 * The full, self-contained deck JSON Schema for the given set of slide types.
 * Every type's content schema lives under `$defs`; a discriminated `slide`
 * selects the right one by `type`.
 * @param {Record<string, any>} slideTypes - name -> definition
 * @returns {object}
 */
export function deckJsonSchema(slideTypes) {
  const names = Object.keys(slideTypes).sort();
  const $defs = {};
  for (const name of names) {
    $defs[contentDefKey(name)] = slideTypeContentSchema(name, slideTypes[name]);
  }

  const slide = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      // Open by shape, not by list: a fork type, an org type or a third-party
      // type is a valid slide type, and enumerating this install's registry
      // keys made every such deck invalid against our own published schema.
      // The `allOf` below already does the right thing for a name it has never
      // seen — no `if` matches, so no `content` shape is demanded.
      type: {
        type: 'string',
        pattern: TYPE_ID_PATTERN,
        description:
          'Slide-type reference: the canonical reverse-DNS id ' +
          '(`eu.deckyard.slide.title`), or the equivalent `name`, ' +
          '`namespace/name` or `…@version` spelling. Known types are ' +
          'discriminated below in every spelling; an unknown type is valid and ' +
          'its content is unconstrained.',
      },
      parentId: { type: ['string', 'null'], format: 'uuid' },
      content: { type: 'object' },
      notes: { type: 'string' },
      visibility: { type: 'object' },
      duration: { type: 'number', minimum: 1, maximum: 300 },
    },
    required: ['id', 'type', 'content'],
    additionalProperties: true,
    // Discriminate content by slide type: if type names X (in any of its
    // spellings), content matches X.
    allOf: names.map((name) => ({
      if: { properties: { type: { enum: typeSpellings(name, slideTypes[name]) } } },
      then: { properties: { content: { $ref: `#/$defs/${contentDefKey(name)}` } } },
    })),
  };

  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${SCHEMA_BASE_URI}/v${CURRENT_SCHEMA_VERSION}/deck.schema.json`,
    title: 'Deckyard deck',
    description:
      'A Deckyard presentation (the durable deckyard.deck envelope). ' +
      'Generated from the slide-type field registry; do not edit by hand.',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      schemaVersion: { type: 'integer', minimum: 0 },
      title: { type: 'string' },
      description: { type: 'string', maxLength: 600 },
      created: { type: 'string' },
      modified: { type: 'string' },
      theme: { type: 'string' },
      lang: {
        type: 'string',
        pattern: BCP47_PATTERN,
        description:
          'BCP 47 language tag (e.g. `nl`, `en-GB`, `pt-BR`). The format ' +
          'places no restriction beyond well-formedness; which tags a given ' +
          'implementation authors in is its own choice.',
      },
      settings: { type: 'object' },
      slides: { type: 'array', items: { $ref: '#/$defs/slide' } },
    },
    required: ['id', 'title', 'slides'],
    additionalProperties: true,
    $defs: { slide, ...$defs },
  };
}
