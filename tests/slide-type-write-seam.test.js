/**
 * The shared write-seam that validates and normalizes `slides[].type`.
 *
 * The format has one canonical spelling of a slide type — the reverse-DNS id
 * (`eu.deckyard.slide.title`). Every write path funnels through
 * `normalizeSlides`, which resolves each accepted spelling to the internal
 * registry key and rejects anything it cannot resolve with a 400. The legacy
 * spellings (bare key, `core/…`) are accepted as beta-window input
 * normalization, never persisted as-is. See docs/reference/versioning.md
 * § The beta stance and docs/plans/briefs/one-spelling.md.
 *
 * Run with: node --test tests/slide-type-write-seam.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSlides } from '../server/storage/presentations/slides.js';
import { getSlideTypeId } from '../shared/slide-types/registry.js';
import { validateRefinedSlidesStrict } from '../server/utils/ai/validate-slides/strict.js';

const CANONICAL_TITLE = getSlideTypeId('title-slide');

test('canonical reverse-DNS id normalizes to the registry key', () => {
  assert.equal(CANONICAL_TITLE, 'eu.deckyard.slide.title');
  const [slide] = normalizeSlides([{ type: CANONICAL_TITLE, content: { title: 'Hi' } }]);
  assert.equal(slide.type, 'title-slide', 'stored as the bare registry key');
});

test('the legacy qualified spelling normalizes to the registry key', () => {
  const [slide] = normalizeSlides([{ type: 'core/title-slide', content: { title: 'Hi' } }]);
  assert.equal(slide.type, 'title-slide');
});

test('the bare registry key passes through unchanged', () => {
  const [slide] = normalizeSlides([{ type: 'title-slide', content: { title: 'Hi' } }]);
  assert.equal(slide.type, 'title-slide');
});

test('a canonical poll id still gets its pollId filled in', () => {
  const canonicalPoll = getSlideTypeId('poll-slide');
  const [slide] = normalizeSlides([{ type: canonicalPoll, content: {} }]);
  assert.equal(slide.type, 'poll-slide');
  assert.equal(typeof slide.content.pollId, 'string');
  assert.ok(slide.content.pollId.length > 0, 'pollId assigned regardless of the input spelling');
});

test('an unresolvable type is a 400, naming the canonical form', () => {
  let thrown;
  try {
    normalizeSlides([{ type: 'text-slide', content: { title: 'Hi' } }]);
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'normalizeSlides throws on an unknown type');
  assert.equal(thrown.statusCode, 400);
  assert.match(thrown.message, /eu\.deckyard\.slide\.title/, 'error names a canonical id');
  assert.equal(thrown.details.slideIndex, 0);
  assert.equal(thrown.details.type, 'text-slide');
});

test('a missing type is a 400, not a silent pass-through', () => {
  assert.throws(() => normalizeSlides([{ content: { title: 'Hi' } }]), { statusCode: 400 });
});

test('MCP strict validation accepts a canonical id', () => {
  assert.doesNotThrow(() =>
    validateRefinedSlidesStrict([{ type: CANONICAL_TITLE, content: { title: 'Hi' } }])
  );
});

test('MCP strict validation still rejects an unknown type', () => {
  assert.throws(
    () => validateRefinedSlidesStrict([{ type: 'text-slide', content: { title: 'Hi' } }]),
    /unknown slide type "text-slide"/
  );
});

test("a legacy 'on-view' refresh mode folds to 'manual' at the write seam", () => {
  // B70 (2026-08-16): 'on-view' was removed from REFRESH_MODES — it never
  // triggered a refresh. Stored decks may still carry it; the write seam
  // folds it so nothing non-canonical is persisted on the next save.
  const [slide] = normalizeSlides([
    {
      type: 'title-slide',
      content: { title: 'Hi' },
      dataSource: {
        provider: 'csv-url',
        config: { url: 'https://example.com/data.csv' },
        bindings: [{ target: 'title', source: 'A1' }],
        refresh: { mode: 'on-view' },
        lastSync: '2026-01-01T00:00:00.000Z',
      },
    },
  ]);
  assert.equal(slide.dataSource.refresh.mode, 'manual');
  assert.equal(slide.dataSource.provider, 'csv-url', 'rest of the dataSource preserved');
  assert.equal(slide.dataSource.lastSync, '2026-01-01T00:00:00.000Z');
});

test('canonical refresh modes pass through the write seam unchanged', () => {
  for (const mode of ['frozen', 'manual']) {
    const [slide] = normalizeSlides([
      {
        type: 'title-slide',
        content: { title: 'Hi' },
        dataSource: {
          provider: 'csv-url',
          config: { url: 'https://example.com/data.csv' },
          bindings: [],
          refresh: { mode },
        },
      },
    ]);
    assert.equal(slide.dataSource.refresh.mode, mode);
  }
});
