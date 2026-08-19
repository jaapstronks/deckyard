/**
 * Inserting a slide seeds the deck language — the contract A6/A7.7 actually
 * turned on.
 *
 * The locale-tiering brief (docs/plans/briefs/locale-tiering.md) worried that
 * the *sample content* a picker tile previews would seed a new slide, and so
 * would need per-deck-language variants. It doesn't: the sample is preview-only
 * (picker thumbnails, the peek lightbox, settings curation). What a new slide is
 * actually seeded from is `makeNewSlide`, which already reads
 * `defaultsByLang[<deck lang>]` before falling back to `defaults`. So a slide
 * inserted into a Dutch deck comes out Dutch, and into an English deck English —
 * no new per-type obligation required. The sample-vs-inserted distinction is
 * written out in docs/reference/slide-type-companions.md § "Sample content is
 * preview-only" and in the getSampleContent JSDoc
 * (client/views/editor/slide-type-sample-content.js).
 *
 * This test pins that behaviour so a refactor of `makeNewSlide` (or a type that
 * quietly drops one language from `defaultsByLang`) fails here instead of
 * silently seeding English into Dutch decks.
 *
 * Run with: node --test tests/insert-seeds-deck-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { makeNewSlide } from '../client/views/editor/editor-utils.js';

/** Core types that ship a Dutch *and* an English default. */
const BILINGUAL_TYPES = Object.entries(SLIDE_TYPES)
  .filter(
    ([, def]) =>
      def?.defaultsByLang &&
      typeof def.defaultsByLang === 'object' &&
      def.defaultsByLang.nl &&
      def.defaultsByLang['en-GB'],
  )
  .map(([name]) => name);

test('the registry actually carries per-language defaults', () => {
  // A vacuous pass — no bilingual types — would make every assertion below
  // green while proving nothing.
  assert.ok(
    BILINGUAL_TYPES.length > 10,
    `expected many types with defaultsByLang, got ${BILINGUAL_TYPES.length}`,
  );
});

/**
 * `makeNewSlide` injects a fresh `pollId` for poll-slide (a runtime id, not
 * content), so drop it before comparing against the static defaults.
 * @param {object} content
 * @returns {object}
 */
function withoutRuntimeIds(content) {
  const { pollId, ...rest } = content;
  return rest;
}

test('a new slide is seeded from the deck-language defaults', () => {
  for (const type of BILINGUAL_TYPES) {
    const def = SLIDE_TYPES[type];
    const nl = makeNewSlide(type, SLIDE_TYPES, { lang: 'nl' });
    const en = makeNewSlide(type, SLIDE_TYPES, { lang: 'en-GB' });
    assert.deepEqual(
      withoutRuntimeIds(nl.content),
      withoutRuntimeIds(def.defaultsByLang.nl),
      `${type}: a slide inserted into a Dutch deck must seed defaultsByLang.nl`,
    );
    assert.deepEqual(
      withoutRuntimeIds(en.content),
      withoutRuntimeIds(def.defaultsByLang['en-GB']),
      `${type}: a slide inserted into an English deck must seed defaultsByLang['en-GB']`,
    );
  }
});

test('at least one type genuinely differs between the two languages', () => {
  // Guards against a translation that is accidentally identical (which would let
  // the deep-equals above pass even if the language switch were a no-op).
  const differs = BILINGUAL_TYPES.some((type) => {
    const def = SLIDE_TYPES[type];
    return (
      JSON.stringify(def.defaultsByLang.nl) !==
      JSON.stringify(def.defaultsByLang['en-GB'])
    );
  });
  assert.ok(
    differs,
    'expected the Dutch and English defaults to differ for some type',
  );
});

test('an unknown or missing deck language falls back to the English defaults', () => {
  // makeNewSlide only honours 'nl' / 'en-GB'; anything else (or nothing) takes
  // the plain `defaults`. This is the graceful path for a Tier-2 deck language.
  const type = BILINGUAL_TYPES[0];
  const def = SLIDE_TYPES[type];
  const unknown = makeNewSlide(type, SLIDE_TYPES, { lang: 'de' });
  const none = makeNewSlide(type, SLIDE_TYPES, {});
  assert.deepEqual(
    withoutRuntimeIds(unknown.content),
    withoutRuntimeIds(def.defaults),
  );
  assert.deepEqual(
    withoutRuntimeIds(none.content),
    withoutRuntimeIds(def.defaults),
  );
});
