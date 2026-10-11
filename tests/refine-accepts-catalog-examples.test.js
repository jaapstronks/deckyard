/**
 * What `get_slide_types` offers as a good slide of a type, the refine phase
 * takes without a warning (B242).
 *
 * The refine phase logs every slide whose content does not fit its type. It
 * used to do that twice: through the content schema derived from `fields[]`
 * (D87) and through a hand-written table of per-type structural checks beside
 * it. The table restated cardinality and per-item fields, and where it did not
 * restate them it disagreed — `funnel-slide`, `cycle-slide` and
 * `process-slide` checked a key their types do not declare, so every valid
 * slide of those types logged a missing array. A warning on a slide the type
 * itself calls good is noise in the one log that should say when the model
 * went wrong, so this test drives each example through `refineSlideGroup` and
 * expects silence.
 *
 * Run with: node --test tests/refine-accepts-catalog-examples.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refineSlideGroup } from '../server/utils/ai/refine-slides.js';
import { resolveAgentSlideTypes } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { SLIDE_TYPE_CATALOG } from '../server/utils/ai/slide-type-catalog.js';

/** The types phase 2 may pick for a `content` slide, with the example offered for each. */
function contentExamples(lang) {
  const offered = resolveAgentSlideTypes({ lang });
  return Object.entries(SLIDE_TYPE_CATALOG)
    .filter(([, def]) => !def.resolveInPhase1)
    .map(([type]) => [type, offered[type]?.example])
    .filter(([, example]) => example);
}

for (const lang of ['nl', 'en-GB']) {
  test(`every content example refines without a warning in ${lang}`, async (t) => {
    const examples = contentExamples(lang);
    assert.ok(
      examples.length > 20,
      `expected the catalog, got ${examples.length}`,
    );

    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    t.mock.method(globalThis, 'fetch', async () => {
      const reply = {
        slides: examples.map(([type, content], i) => ({
          originalIndex: i,
          type,
          content: structuredClone(content),
        })),
      };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const saved = process.env.OPENAI_API;
    process.env.OPENAI_API = 'offline-test';
    try {
      const group = {
        groupId: 'g',
        slides: examples.map((_, i) => ({
          index: i,
          intent: 'content',
          hints: [],
          roughContent: 'Source.',
        })),
      };
      const slides = await refineSlideGroup(group, { lang, vendor: 'openai' });
      assert.deepEqual(
        slides.map((s) => s.type),
        examples.map(([type]) => type),
        'every example kept its type',
      );
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API;
      else process.env.OPENAI_API = saved;
    }

    assert.deepEqual(
      warnings.map((args) =>
        args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' '),
      ),
      [],
    );
  });
}
