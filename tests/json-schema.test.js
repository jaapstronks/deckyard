import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import { FIELD_TYPE_NAMES } from '../shared/slide-types/field-types.js';
import {
  fieldToJsonSchema,
  slideTypeContentSchema,
  deckJsonSchema,
} from '../shared/slide-types/json-schema.js';

/**
 * Move 1c: the deck JSON Schema is generated from the single field registry.
 * These tests prove the generator covers every declared field type, that the
 * generated deck schema is structurally sound, and - via a small test-only
 * validator - that the schemas actually accept real (default) slide content.
 */

/** Core (non-custom) types, for deterministic assertions across installs. */
const CORE_ENTRIES = Object.entries(SLIDE_TYPES).filter(
  ([name]) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name)
);

// --- generator unit tests -------------------------------------------------

test('fieldToJsonSchema maps every declared field type to a valid base', () => {
  // string-ish types -> type:'string'; images/items -> array.
  const asType = {
    string: 'string', markdown: 'string', csv: 'string', code: 'string',
    color: 'string', enum: 'string', image: 'string',
    images: 'array', items: 'array',
  };
  for (const [type, want] of Object.entries(asType)) {
    assert.equal(fieldToJsonSchema({ type, key: 'x' }).type, want, `${type}`);
  }
  // number/boolean allow the '' cleared value, so they are anyOf wrappers.
  assert.equal(fieldToJsonSchema({ type: 'number', key: 'n' }).anyOf[0].type, 'number');
  assert.equal(fieldToJsonSchema({ type: 'boolean', key: 'b' }).anyOf[0].type, 'boolean');
});

test('field-level constraints flow into the schema', () => {
  assert.equal(fieldToJsonSchema({ type: 'string', key: 't', maxLength: 40 }).maxLength, 40);
  const num = fieldToJsonSchema({ type: 'number', key: 'n', min: 0, max: 100 });
  assert.equal(num.anyOf[0].minimum, 0);
  assert.equal(num.anyOf[0].maximum, 100);
  const imgs = fieldToJsonSchema({ type: 'images', key: 'g', maxItems: 3 });
  assert.equal(imgs.maxItems, 3);
});

test('enum fields list their options plus the cleared-value convention', () => {
  const schema = fieldToJsonSchema({
    type: 'enum',
    key: 'fit',
    options: [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }],
  });
  assert.deepEqual(schema.enum, ['cover', 'contain', '']);
  // The background field stays an open string (theme variant slugs).
  const bg = fieldToJsonSchema({ type: 'enum', key: 'background', options: [] });
  assert.equal(bg.enum, undefined);
  assert.equal(bg.type, 'string');
});

test('items fields recurse into an object schema shaped by itemFields', () => {
  const schema = fieldToJsonSchema({
    type: 'items',
    key: 'rows',
    minItems: 1,
    maxItems: 5,
    itemFields: [
      { key: 'label', type: 'string', required: true, maxLength: 20 },
      { key: 'value', type: 'number' },
    ],
  });
  assert.equal(schema.type, 'array');
  assert.equal(schema.minItems, 1);
  assert.equal(schema.maxItems, 5);
  assert.equal(schema.items.type, 'object');
  assert.equal(schema.items.properties.label.type, 'string');
  assert.equal(schema.items.properties.label.maxLength, 20);
  assert.equal(schema.items.properties.value.anyOf[0].type, 'number');
  assert.deepEqual(schema.items.required, ['label']);
});

// --- deck schema structure ------------------------------------------------

test('the deck schema is self-contained and discriminates content by type', () => {
  const schema = deckJsonSchema(SLIDE_TYPES);
  assert.equal(schema.type, 'object');
  assert.ok(schema.$id.includes('/deck.schema.json'));
  assert.equal(schema.properties.slides.items.$ref, '#/$defs/slide');
  assert.ok(schema.$defs.slide, 'a slide def exists');

  const names = Object.keys(SLIDE_TYPES);
  // Every slide type has a content def and a discriminator branch.
  for (const name of names) {
    const defKey = `content_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    assert.ok(schema.$defs[defKey], `missing $defs for ${name}`);
  }
  const branches = schema.$defs.slide.allOf;
  assert.equal(branches.length, names.length);
  for (const branch of branches) {
    const constName = branch.if.properties.type.const;
    const ref = branch.then.properties.content.$ref;
    assert.ok(schema.$defs[ref.replace('#/$defs/', '')], `dangling ref ${ref}`);
    assert.ok(names.includes(constName));
  }
});

// --- a small, test-only JSON Schema validator -----------------------------
// Covers exactly the keywords the generator emits for a content object; enough
// to prove the generated schemas accept real slide content.

function typeOk(v, t) {
  if (Array.isArray(t)) return t.some((tt) => typeOk(v, tt));
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return v != null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
}

function validate(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return errors;
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => validate(sub, value, path, []).length === 0);
    if (!ok) errors.push(`${path}: no anyOf branch matched ${JSON.stringify(value)}`);
    return errors;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: ${JSON.stringify(value)} !== const ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.type && !typeOk(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${JSON.stringify(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string' && schema.maxLength != null && value.length > schema.maxLength) {
    errors.push(`${path}: exceeds maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: < minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: > maximum`);
  }
  if (typeOk(value, 'object') && schema.type === 'object') {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}.${req}: required`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (v == null) continue; // absent/null == unset (matches validateSlide leniency)
      if (props[k]) validate(props[k], v, `${path}.${k}`, errors);
    }
  }
  if (Array.isArray(value) && schema.type === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((it, i) => validate(schema.items, it, `${path}[${i}]`, errors));
  }
  return errors;
}

test('every core slide type default content validates against its generated schema', () => {
  const failures = [];
  for (const [name, def] of CORE_ENTRIES) {
    const schema = slideTypeContentSchema(name, def);
    const content =
      def.defaultsByLang?.['en-GB'] || def.defaultsByLang?.['nl'] || def.defaults || {};
    const errors = validate(schema, content, name, []);
    if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
  }
  assert.deepEqual(failures, [], `default content failed its schema:\n${failures.join('\n')}`);
});

test('per-type schema with meta carries a versioned $id', () => {
  const [name, def] = CORE_ENTRIES[0];
  const schema = slideTypeContentSchema(name, def, { withMeta: true });
  assert.ok(schema.$schema);
  assert.match(schema.$id, /\/v\d+\/slide-types\/.+\.schema\.json$/);
});
