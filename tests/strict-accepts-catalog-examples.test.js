/**
 * B241 / D87: what `get_slide_types` hands an agent, `create_presentation_from_slides`
 * accepts.
 *
 * The catalog's `example` for a type is its sample (D119, B245) — what the
 * definition itself calls a good slide of this type — or its `defaults` where
 * there is no sample the type accepts. Strict validation refusing one is not a
 * strict rule doing its job; it is two descriptions of the same type
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
import { contentSchemaFor } from '../server/utils/ai/schemas/content-schema.js';
import {
  CORE_SLIDE_TYPE_DEFS,
  SLIDE_TYPES,
} from '../shared/slide-types/registry.js';
import { slideTypeSample } from '../shared/slide-types/authoring-companions.js';
import { SLIDE_TYPE_AI_EXAMPLES } from '../server/utils/ai/slide-catalog/type-ai.js';

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

test('every core sample passes its own content schema, video-slide excepted (D107)', () => {
  // D119: the sample is what a good slide of this type looks like, so the type
  // must accept it. The one exception is deliberate and named: video-slide's
  // sample leaves `source` blank so a picker tile loads no live player (D107).
  const refused = Object.entries(CORE_SLIDE_TYPE_DEFS)
    .filter(([name, def]) => {
      const sample = slideTypeSample(name, def);
      return sample && !contentSchemaFor(def).safeParse(sample).success;
    })
    .map(([name]) => name);
  assert.deepEqual(refused, ['video-slide']);
});

test('every core aiExample passes its own content schema (B246)', () => {
  // D119: the prompt examples are variations an agent copies field for field,
  // so each one is a slide the type accepts. The pattern's name sits beside
  // the content (`{ variation, content }`); inside it, `_variation` was a key
  // no type declares, and twelve of twenty-one first examples carried it.
  const refused = [];
  for (const [name, examples] of Object.entries(SLIDE_TYPE_AI_EXAMPLES)) {
    const def = CORE_SLIDE_TYPE_DEFS[name];
    assert.ok(def, `${name}: aiExamples without a core type`);
    examples.forEach((ex, i) => {
      const parsed = contentSchemaFor(def).safeParse(ex.content);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        refused.push(`${name}[${i}] ${issue.path.join('.')}: ${issue.message}`);
      }
    });
  }
  assert.deepEqual(refused, []);
});

test('the example an agent gets is the sample; defaults only where there is none it can use', () => {
  const offered = resolveAgentSlideTypes({ lang: 'nl' });
  const fromDefaults = [];
  for (const [name, def] of Object.entries(CORE_SLIDE_TYPE_DEFS)) {
    if (!offered[name]) continue;
    const sample = slideTypeSample(name, def);
    if (offered[name].example === sample) continue;
    assert.deepEqual(
      offered[name].example,
      def.defaultsByLang?.nl || def.defaults,
      `${name}: not the sample, so its defaults`,
    );
    fromDefaults.push(name);
  }
  // No sample at all (embed-slide for the same reason as D107), or one the type
  // refuses (video-slide). A new entry here is a sample to write or to fix.
  assert.deepEqual(fromDefaults.sort(), [
    'embed-slide',
    'payoff-slide',
    'video-slide',
  ]);
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
      { key: 'score', type: 'number', label: 'Score', min: 0, max: 10 },
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
      { ...ok, score: 11 },
      'score',
      'a number max is enforced, in its own words',
    ],
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
        if (field === 'score') assert.equal(err.details.expected, 'max 10');
        return true;
      },
      why,
    );
  }
});

test('the derivation is cached per definition, and per theme object', () => {
  const def = SLIDE_TYPES['title-slide'];
  const theme = { slideBackgrounds: [] };
  assert.equal(
    contentSchemaFor(def),
    contentSchemaFor(def),
    'bare: one schema',
  );
  assert.equal(
    contentSchemaFor(def, { theme }),
    contentSchemaFor(def, { theme }),
    'themed: one schema per theme object',
  );
  assert.notEqual(
    contentSchemaFor(def),
    contentSchemaFor(def, { theme }),
    'the themed derivation is its own schema',
  );
});
