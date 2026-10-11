/**
 * Phase 2 accepts a slide type exactly where the catalog offered it (B663).
 *
 * B660 made every agent-facing path offer from `getOfferedSlideTypes()`, but
 * the refine phase derived its own acceptance list from the catalog and so
 * let a type through that the offer withheld: a definition that opted out of
 * agent use (`ai: false`, `deprecated: true`) was refused in the prompt and
 * accepted in the reply. No core type opts out today, so this test opts one
 * out for its duration and expects phase 2 to fall back instead of keeping it.
 *
 * Run with: node --test tests/refine-accepts-only-offered.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refineSlideGroup } from '../server/utils/ai/refine-slides.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { getPhase2SlideTypes } from '../server/utils/ai/slide-catalog/index.js';

const OPTED_OUT = 'timeline-slide';

/** Refine one content slide whose reply asks for `type`. */
async function refineAs(t, type, options = {}) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    const reply = { slides: [{ originalIndex: 0, type, content: {} }] };
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
    const [slide] = await refineSlideGroup(
      {
        groupId: 'g',
        slides: [
          { index: 0, intent: 'content', hints: [], roughContent: 'Source.' },
        ],
      },
      { lang: 'en-GB', vendor: 'openai', slideTypes: SLIDE_TYPES, ...options },
    );
    return slide.type;
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API;
    else process.env.OPENAI_API = saved;
  }
}

test('the opted-out probe is a phase-2 type that is offered by default', () => {
  assert.ok(SLIDE_TYPES[OPTED_OUT], `${OPTED_OUT} is registered`);
  assert.ok(getPhase2SlideTypes().includes(OPTED_OUT));
});

test('phase 2 keeps an offered type', async (t) => {
  assert.equal(await refineAs(t, OPTED_OUT), OPTED_OUT);
});

test('phase 2 refuses a type whose definition opted out of agent use', async (t) => {
  const original = SLIDE_TYPES[OPTED_OUT];
  SLIDE_TYPES[OPTED_OUT] = { ...original, ai: false };
  try {
    assert.ok(!getPhase2SlideTypes().includes(OPTED_OUT), 'not offered');
    assert.notEqual(await refineAs(t, OPTED_OUT), OPTED_OUT, 'not accepted');
  } finally {
    SLIDE_TYPES[OPTED_OUT] = original;
  }
});

test('phase 2 refuses an org-disabled type', async (t) => {
  const type = await refineAs(t, OPTED_OUT, {
    disabledSlideTypes: [OPTED_OUT],
  });
  assert.notEqual(type, OPTED_OUT);
});
