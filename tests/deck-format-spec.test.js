/**
 * Contract test for the published `slidecreator.deck` format (PR 8, move 5b).
 *
 * `tests/fixtures/example-deck.json` is the canonical example deck referenced by
 * `docs/reference/deck-format.md`. This test is the CI gate behind that spec:
 *
 *   1. the example conforms to the documented envelope;
 *   2. its `slideTypes` identity manifest matches what the registry recomputes
 *      (a hand-written manifest can't silently drift);
 *   3. it round-trips (import → export → import → export is content-stable);
 *   4. every slide's content validates against its generated per-type schema —
 *      the single source shared with the JSON-schema contract.
 *
 * If a second implementation targets the spec, this fixture is what it round-trips.
 *
 * Run with: node --test tests/deck-format-spec.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { presentationToDeck, deckToPresentationParts } from '../shared/slide-types/deck.js';
import { collectSlideTypeManifest, getSlideType } from '../shared/slide-types/registry.js';
import { tryParseTypeId } from '../shared/slide-types/type-id.js';
import { slideTypeContentSchema } from '../shared/slide-types/json-schema.js';
import { validate } from './helpers/json-schema-validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'example-deck.json');
const example = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/** Slide identity for round-trip comparison (deck slides carry no id). */
const contentShape = (deck) =>
  (deck.slides || []).map((s) => ({ type: s.type, content: s.content }));

test('the example conforms to the documented deck envelope', () => {
  assert.equal(example.format, 'slidecreator.deck', 'format sentinel');
  assert.equal(example.version, 1, 'format version');
  assert.equal(typeof example.title, 'string');
  assert.equal(typeof example.theme, 'string');
  assert.ok(example.slideTypes && typeof example.slideTypes === 'object');
  assert.ok(Array.isArray(example.slides) && example.slides.length > 0);
  for (const s of example.slides) {
    assert.equal(typeof s.type, 'string', 'slide.type is a string');
    assert.ok(s.content && typeof s.content === 'object', 'slide.content is an object');
    assert.equal(s.id, undefined, 'portable slides carry no id');
  }
});

test('the slideTypes manifest matches what the registry recomputes (no drift)', () => {
  const recomputed = collectSlideTypeManifest(example.slides);
  assert.deepEqual(
    example.slideTypes,
    recomputed,
    'hand-written slideTypes manifest is out of sync with the registry'
  );
});

test('the example round-trips: import → export → import → export is content-stable', () => {
  // One normalization pass fills defaults and regenerates ids; from there the
  // portable projection is a fixpoint.
  const parts1 = deckToPresentationParts(example);
  const deck2 = presentationToDeck(parts1);
  const parts2 = deckToPresentationParts(deck2);
  const deck3 = presentationToDeck(parts2);

  assert.deepEqual(contentShape(deck3), contentShape(deck2), 'round-trip is content-stable');
  // The envelope is reproduced verbatim by the exporter.
  assert.equal(deck2.format, 'slidecreator.deck');
  assert.equal(deck2.version, 1);
  assert.deepEqual(deck2.slideTypes, example.slideTypes);
});

test('every example slide validates against its generated per-type schema', () => {
  const normalized = presentationToDeck(deckToPresentationParts(example));
  const failures = [];
  for (const slide of normalized.slides) {
    const localName = tryParseTypeId(slide.type)?.name || slide.type;
    const def = getSlideType(slide.type);
    assert.ok(def, `example uses a known slide type: ${slide.type}`);
    const schema = slideTypeContentSchema(localName, def);
    const errors = validate(schema, slide.content, localName, []);
    if (errors.length) failures.push(`${localName}: ${errors.join('; ')}`);
  }
  assert.deepEqual(failures, [], `example content failed its schema:\n${failures.join('\n')}`);
});

test('local asset refs use the /uploads/ convention; external URLs stay external', () => {
  const json = JSON.stringify(example);
  // The documented example carries exactly one local asset ref.
  const localRefs = [...json.matchAll(/"\/uploads\/[^"]+"/g)].map((m) => m[0]);
  assert.ok(localRefs.length >= 1, 'example demonstrates a local /uploads/ asset ref');
  // No bundle refs leak into the portable (non-bundled) deck.
  assert.ok(!json.includes('assets/'), 'portable deck has no bundle refs');
});
