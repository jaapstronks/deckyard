import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  FIELD_TYPES,
  FIELD_TYPE_NAMES,
  isKnownFieldType,
  validateFieldValue,
} from '../shared/slide-types/field-types.js';

/**
 * Move 1a of the datamodel-purity track: the field-type vocabulary is declared
 * once in shared/slide-types/field-types.js. These tests are the drift guard
 * that keeps validation, the editor and the docs from silently diverging again.
 */

test('every field.type across all slide-type definitions is a declared type', () => {
  const offenders = [];
  for (const [typeName, def] of Object.entries(SLIDE_TYPES)) {
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    for (const field of fields) {
      if (!isKnownFieldType(field?.type)) {
        offenders.push(
          `${typeName}.${field?.key} → ${JSON.stringify(field?.type)}`,
        );
      }
      // itemFields describe the shape of each object in an `items` field.
      const itemFields = Array.isArray(field?.itemFields)
        ? field.itemFields
        : [];
      for (const f of itemFields) {
        if (!isKnownFieldType(f?.type)) {
          offenders.push(
            `${typeName}.${field?.key}[].${f?.key} → ${JSON.stringify(f?.type)}`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Unknown field.type(s) found. Add them to FIELD_TYPES in ` +
      `shared/slide-types/field-types.js or fix the definition:\n${offenders.join('\n')}`,
  );
});

test('isKnownFieldType rejects anything not in the vocabulary', () => {
  assert.equal(isKnownFieldType('bogus'), false);
  assert.equal(isKnownFieldType(''), false);
  assert.equal(isKnownFieldType(null), false);
  assert.equal(isKnownFieldType(undefined), false);
  assert.equal(isKnownFieldType(42), false);
  for (const name of FIELD_TYPE_NAMES)
    assert.equal(isKnownFieldType(name), true);
});

test('the developer docs document exactly the declared vocabulary', () => {
  const md = readFileSync(
    new URL('../docs/developer/slide-types.md', import.meta.url),
    'utf8',
  );
  // Only look inside the "Field Types Reference" section.
  const start = md.indexOf('## Field Types Reference');
  assert.ok(start !== -1, 'docs must have a "Field Types Reference" section');
  const rest = md.slice(start + 1);
  const nextH2 = rest.indexOf('\n## ');
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2);

  // A field-type row starts with a single backticked lowercase token cell.
  const documented = new Set();
  for (const m of section.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)) {
    documented.add(m[1]);
  }
  assert.deepEqual(
    [...documented].sort(),
    FIELD_TYPE_NAMES,
    'docs/developer/slide-types.md field-type tables must match FIELD_TYPES',
  );
});

test('every declared type carries a validator and doc metadata', () => {
  for (const [name, spec] of Object.entries(FIELD_TYPES)) {
    assert.equal(typeof spec.validate, 'function', `${name} needs validate()`);
    assert.equal(
      typeof spec.description,
      'string',
      `${name} needs description`,
    );
    assert.equal(typeof spec.docExtra, 'string', `${name} needs docExtra`);
    assert.equal(typeof spec.valueKind, 'string', `${name} needs valueKind`);
  }
});

test('number values are now validated (was a silent gap)', () => {
  assert.deepEqual(validateFieldValue(123, { type: 'number', key: 'x' }), []);
  assert.deepEqual(validateFieldValue('50', { type: 'number', key: 'x' }), []);
  assert.deepEqual(validateFieldValue(null, { type: 'number', key: 'x' }), []);
  assert.deepEqual(validateFieldValue('abc', { type: 'number', key: 'x' }), [
    'Slide.content.x must be a number',
  ]);
  assert.deepEqual(
    validateFieldValue('', { type: 'number', key: 'x', required: true }),
    ['Slide.content.x is required'],
  );
});

test('color values are now validated (was a silent gap)', () => {
  assert.deepEqual(
    validateFieldValue('accent', { type: 'color', key: 'c' }),
    [],
  );
  assert.deepEqual(validateFieldValue('', { type: 'color', key: 'c' }), []);
  assert.deepEqual(validateFieldValue(123, { type: 'color', key: 'c' }), [
    'Slide.content.c must be a string',
  ]);
});

test('enum validation is preserved, including the background theme-variant escape', () => {
  const field = { type: 'enum', key: 'e', options: ['a', 'b'] };
  assert.deepEqual(validateFieldValue('b', field), []);
  assert.deepEqual(validateFieldValue('', field), []); // cleared = follow default
  assert.deepEqual(validateFieldValue('c', field), [
    'Slide.content.e must be one of: a, b',
  ]);
  // The `background` field also accepts theme-defined variant slugs.
  assert.deepEqual(
    validateFieldValue('lime', {
      type: 'enum',
      key: 'background',
      options: [],
    }),
    [],
  );
});

test('text validation (required, type, maxLength) is preserved', () => {
  assert.deepEqual(
    validateFieldValue('', { type: 'string', key: 't', required: true }),
    ['Slide.content.t is required'],
  );
  assert.deepEqual(validateFieldValue(5, { type: 'string', key: 't' }), [
    'Slide.content.t must be a string',
  ]);
  assert.deepEqual(
    validateFieldValue('abcd', { type: 'string', key: 't', maxLength: 3 }),
    ['Slide.content.t exceeds max length (3)'],
  );
});

test('unknown field types are lenient at runtime (guarded by the drift test instead)', () => {
  assert.deepEqual(
    validateFieldValue('anything', { type: 'bogus', key: 'z' }),
    [],
  );
});

test('a `url` accepts web links and slide jumps and refuses a bare domain, at any depth (D131)', () => {
  const field = { key: 'link', type: 'url' };
  for (const ok of [
    'https://example.com',
    'mailto:a@example.com',
    '/p/1',
    '#3',
    '#slide:abc-123',
  ]) {
    assert.deepEqual(validateFieldValue(ok, field), [], ok);
  }
  for (const bad of ['example.com', 'javascript:alert(1)', '#0', '#slide:']) {
    assert.equal(validateFieldValue(bad, field).length, 1, bad);
  }
  const items = {
    key: 'actions',
    type: 'items',
    itemFields: [
      { key: 'label', type: 'string' },
      { key: 'url', type: 'url' },
      { key: 'mail', type: 'email' },
    ],
  };
  assert.deepEqual(
    validateFieldValue(
      [
        { label: 'Go', url: 'https://example.com', mail: 'a@example.com' },
        { label: 'Bare', url: 'example.com', mail: 'nobody' },
      ],
      items,
    ),
    [
      'Slide.content.actions[1].url must be an http(s), mailto, or root-relative URL, or a slide jump (#slide:<id>, #N)',
      'Slide.content.actions[1].mail must be an email address',
    ],
  );
});

test('an `email` must look like an address', () => {
  const field = { key: 'contactEmail', type: 'email', maxLength: 40 };
  assert.deepEqual(validateFieldValue('', field), []);
  assert.deepEqual(validateFieldValue(' robin@example.com ', field), []);
  assert.deepEqual(validateFieldValue('robin@example', field), [
    'Slide.content.contactEmail must be an email address',
  ]);
  assert.deepEqual(validateFieldValue(42, field), [
    'Slide.content.contactEmail must be a string',
  ]);
});
