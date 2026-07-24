import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import {
  fieldToJsonSchema,
  slideTypeContentSchema,
  deckJsonSchema,
} from '../shared/slide-types/json-schema.js';
import { validate } from './helpers/json-schema-validate.js';

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
// Extracted to tests/helpers/json-schema-validate.js so the deck-format spec
// test can reuse the exact same conformance check against the same schemas.

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
