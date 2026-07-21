/**
 * JSON Schema generation for the deck format.
 *
 * Move 1c of the datamodel-purity track. The real schema used to be "39 JS
 * files plus a runtime reflection endpoint": the OpenAPI spec typed a slide's
 * `content` as an opaque `object`, so an outside integrator met a model that
 * declined to describe itself. This module derives a real, versioned JSON
 * Schema straight from the single `fields[]` registry (via the declared
 * field-type vocabulary), so validation, the docs and the published contract
 * all trace back to one source. The committed artifact is regenerated and
 * diffed in CI, so the schema can never silently drift from the code.
 *
 * The generated deck schema is self-contained: every slide type's content
 * schema lives under `$defs`, and a discriminated `slide` (`if type === X then
 * content matches X`) wires them together with local `#/$defs/...` refs.
 */

import { FIELD_TYPES, enumOptionValues } from './field-types.js';
import { CURRENT_SCHEMA_VERSION } from './schema-version.js';

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Canonical publish base for `$id`s. Adjust if the format gets its own host. */
export const SCHEMA_BASE_URI = 'https://deckyard.app/schema';

/** `$defs` key for a slide type's content schema. */
function contentDefKey(typeName) {
  return `content_${String(typeName).replace(/[^a-zA-Z0-9_]/g, '_')}`;
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
      type: { type: 'string', enum: names },
      parentId: { type: ['string', 'null'], format: 'uuid' },
      content: { type: 'object' },
      notes: { type: 'string' },
      visibility: { type: 'object' },
      duration: { type: 'number', minimum: 1, maximum: 300 },
    },
    required: ['id', 'type', 'content'],
    additionalProperties: true,
    // Discriminate content by slide type: if type === X, content matches X.
    allOf: names.map((name) => ({
      if: { properties: { type: { const: name } } },
      then: { properties: { content: { $ref: `#/$defs/${contentDefKey(name)}` } } },
    })),
  };

  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${SCHEMA_BASE_URI}/v${CURRENT_SCHEMA_VERSION}/deck.schema.json`,
    title: 'Deckyard deck',
    description:
      'A Deckyard presentation (the durable slidecreator.deck envelope). ' +
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
      lang: { type: 'string', enum: ['nl', 'en-GB'] },
      settings: { type: 'object' },
      slides: { type: 'array', items: { $ref: '#/$defs/slide' } },
    },
    required: ['id', 'title', 'slides'],
    additionalProperties: true,
    $defs: { slide, ...$defs },
  };
}
