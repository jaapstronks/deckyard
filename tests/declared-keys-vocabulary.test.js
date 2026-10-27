/**
 * One inclusion vocabulary for a type's content keys (B257 B5-rest, D359).
 *
 * Three audiences read a type's keys: the write surfaces and the import
 * (every declared key), the published JSON Schema (the fields that are not
 * `hidden`) and the agent catalogue (neither `hidden` nor `ai: false`). Each
 * used to carry its own inline predicate; they now come from
 * `shared/slide-types/declared-keys.js`. This pins the predicates and holds
 * every registered type's published surfaces to them, so a fourth spelling
 * cannot grow back unnoticed.
 *
 * Run with: node --test tests/declared-keys-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import {
  declaredContentKeys,
  isAgentField,
  isPublishedField,
  undeclaredContentKeys,
} from '../shared/slide-types/declared-keys.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from '../shared/slide-types/compose.js';
import { slideTypeContentSchema } from '../shared/slide-types/json-schema.js';
import { validateSlideFields } from '../shared/slide-types/presentation.js';
import { deriveAgentSchema } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { assertValidSlideFields } from '../server/services/slide-field-validation.js';

// ── the predicates ──────────────────────────────────────────────────────────

test('isPublishedField drops hidden fields only', () => {
  assert.equal(isPublishedField({ key: 'a' }), true);
  assert.equal(isPublishedField({ key: 'a', ai: false }), true);
  assert.equal(isPublishedField({ key: 'a', hidden: true }), false);
});

test('isAgentField drops hidden and ai:false fields', () => {
  assert.equal(isAgentField({ key: 'a' }), true);
  assert.equal(isAgentField({ key: 'a', ai: false }), false);
  assert.equal(isAgentField({ key: 'a', hidden: true }), false);
  assert.equal(isAgentField({ key: 'a', hidden: true, ai: false }), false);
});

test('undeclaredContentKeys names what the type does not declare', () => {
  const def = SLIDE_TYPES['title-slide'];
  assert.deepEqual(
    undeclaredContentKeys(def, {
      title: 'Hoi',
      byline: 'retired',
      slideBgImage: '',
      slideBgTextAuto: 'light',
      attribution: 'retired',
    }),
    ['byline', 'attribution'],
  );
  assert.deepEqual(undeclaredContentKeys(undefined, { anything: 1 }), []);
  assert.deepEqual(undeclaredContentKeys(def, null), []);
});

// ── every published surface reads its predicate ─────────────────────────────

for (const [name, def] of Object.entries(SLIDE_TYPES)) {
  test(`${name}: each surface names the keys its predicate selects`, () => {
    const fields = def.fields;
    const schema = slideTypeContentSchema(name, def);

    const published = fields.filter(isPublishedField).map((f) => f.key);
    const schemaFields = Object.keys(schema.properties).filter(
      (k) => k !== 'textStyles',
    );
    assert.deepEqual(schemaFields.sort(), [...published].sort());

    assert.deepEqual(
      schema.propertyNames.enum,
      [...declaredContentKeys(def)].sort(),
      'the schema refuses exactly what the writes refuse',
    );

    const offered = fields
      .filter(isAgentField)
      .map((f) => f.key)
      .filter((k) => !GLOBAL_SLIDE_FIELD_KEYS.includes(k));
    assert.deepEqual(
      Object.keys(deriveAgentSchema(fields)).sort(),
      [...offered].sort(),
    );
  });
}

// ── every write refuses an undeclared key ───────────────────────────────────

test('validateSlideFields refuses an undeclared key as unknown_field', () => {
  const slide = {
    id: 's1',
    type: 'payoff-slide',
    content: { tagline: 'Bedankt' },
  };
  assert.deepEqual(validateSlideFields(slide), [
    {
      field: 'tagline',
      code: 'unknown_field',
      errors: [
        'Unknown field "tagline": slide type payoff-slide does not declare it',
      ],
    },
  ]);
});

test('declared keys without a field pass: globals, derived, instance', () => {
  const slide = {
    id: 's1',
    type: 'title-slide',
    content: {
      title: 'Hoi',
      slideBgImage: '/img.jpg',
      slideBgAutoFor: '/img.jpg',
      slideBgTextAuto: 'light',
      slideBgNeedsScrim: false,
    },
  };
  assert.deepEqual(validateSlideFields(slide), []);
});

test('the refusal carries unknown_field and names the key', () => {
  assert.throws(
    () =>
      assertValidSlideFields(
        { id: 's1', type: 'matrix-slide', content: { heading: 'Oud' } },
        SLIDE_TYPES,
      ),
    (err) =>
      err.statusCode === 400 &&
      err.code === 'unknown_field' &&
      err.details.field === 'heading' &&
      err.details.slideId === 's1' &&
      !('code' in err.details),
  );
});

test('an invalid declared field keeps the invalid code', () => {
  assert.throws(
    () =>
      assertValidSlideFields(
        { id: 's1', type: 'title-slide', content: { title: 7 } },
        SLIDE_TYPES,
      ),
    (err) =>
      err.statusCode === 400 &&
      err.code === 'invalid' &&
      err.details.field === 'title',
  );
});
