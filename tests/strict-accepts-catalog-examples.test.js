/**
 * B241 / D87: what `get_slide_types` hands an agent, `create_presentation_from_slides`
 * accepts.
 *
 * The catalog's `example` for a type is its own `defaults` — the shape the
 * definition itself calls a slide of this type. Strict validation refusing one
 * is not a strict rule doing its job; it is two descriptions of the same type
 * disagreeing, and the agent is the one told it is wrong.
 *
 * This is the test D87 pins: strict is **one derivation from `fields[]`**, so
 * the example and the check cannot drift. Before the change it failed on four
 * of thirty-three types (list, poll, countdown, embed), each for a different
 * reason — a hand-written Zod schema carrying a folded-away shape, a length
 * table that disagreed with `fields[].maxLength`.
 *
 * Run with: node --test tests/strict-accepts-catalog-examples.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAgentSlideTypes } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import {
  RawSlideValidationError,
  validateRefinedSlidesStrict,
} from '../server/utils/ai/validate-slides/strict.js';
import { toRuntimeSlideType } from '../server/utils/custom-slide-type-runtime.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/** The offer, in one language: `{ [typeName]: example }` for everything with one. */
function offeredExamples(lang) {
  const types = resolveAgentSlideTypes({ lang });
  return Object.entries(types).filter(([, entry]) => entry.example);
}

for (const lang of ['nl', 'en-GB']) {
  test(`every example get_slide_types offers in ${lang} passes strict validation`, () => {
    const refused = [];
    for (const [type, entry] of offeredExamples(lang)) {
      try {
        validateRefinedSlidesStrict([{ type, content: entry.example }]);
      } catch (err) {
        if (!(err instanceof RawSlideValidationError)) throw err;
        refused.push(`${type}: ${err.details.field} — ${err.message}`);
      }
    }
    assert.deepEqual(refused, []);
  });
}

test('every core type offers an example at all', () => {
  // A type with no example is a type an agent has to guess at. The four that
  // were refused above are only findable because there is something to check.
  const missing = offeredExamples('nl')
    .map(([type]) => type)
    .filter((t) => !t);
  assert.deepEqual(missing, []);

  const withoutExample = Object.entries(resolveAgentSlideTypes({ lang: 'nl' }))
    .filter(([, entry]) => !entry.example)
    .map(([type]) => type);
  assert.deepEqual(withoutExample, []);
});

test('a published DB type validates against its own stored fields', () => {
  const ct = {
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'case-study',
    label: 'Case study',
    fields: [
      {
        key: 'client',
        type: 'string',
        label: 'Client',
        required: true,
        maxLength: 60,
      },
      { key: 'summary', type: 'markdown', label: 'Summary', maxLength: 400 },
      {
        key: 'stage',
        type: 'enum',
        label: 'Stage',
        options: ['pilot', 'live'],
      },
      {
        key: 'wins',
        type: 'items',
        label: 'Wins',
        minItems: 1,
        maxItems: 3,
        itemFields: [
          {
            key: 'text',
            type: 'string',
            label: 'Text',
            required: true,
            maxLength: 40,
          },
        ],
      },
    ],
    defaults: {},
  };
  const slideTypes = {
    ...SLIDE_TYPES,
    'custom-case-study': toRuntimeSlideType(ct),
  };
  const ok = {
    client: 'Acme',
    summary: 'They shipped.',
    stage: 'live',
    wins: [{ text: 'Faster' }],
    a11yTitle: 'Acme case study',
  };

  assert.doesNotThrow(() =>
    validateRefinedSlidesStrict([{ type: 'custom-case-study', content: ok }], {
      slideTypes,
    }),
  );

  const cases = [
    [{ ...ok, client: '' }, 'client', 'a required field cannot be blank'],
    [{ ...ok, stage: 'sold' }, 'stage', 'an enum value must be offered'],
    [{ ...ok, wins: [] }, 'wins', 'minItems is enforced'],
    [
      { ...ok, wins: [{ text: 'x'.repeat(41) }] },
      'wins.0.text',
      'an itemFields maxLength is enforced',
    ],
    [
      { ...ok, mood: 'sunny' },
      'mood',
      'a key the type does not declare is refused',
    ],
  ];
  for (const [content, field, why] of cases) {
    assert.throws(
      () =>
        validateRefinedSlidesStrict([{ type: 'custom-case-study', content }], {
          slideTypes,
        }),
      (err) => {
        assert.ok(err instanceof RawSlideValidationError, why);
        assert.equal(err.details.field, field, why);
        return true;
      },
      why,
    );
  }
});
