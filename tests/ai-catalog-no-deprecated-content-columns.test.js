/**
 * Regression: the AI slide catalog must not offer the deprecated
 * `content-columns-slide`.
 *
 * The type is `deprecated: true` and not insertable (it renders existing decks
 * and remains a convert target, but the AI must never author a new one). It used
 * to keep a full catalog entry + a "use content-columns-slide" recommendation in
 * image-slide's notFor, so the live Phase-2 refine/iterate prompt
 * (`buildPhase2CatalogPrompt`) handed the model the type with schema + examples —
 * the same leak that card-stack / split-partner / freeform were already spared.
 *
 * Run with: node --test tests/ai-catalog-no-deprecated-content-columns.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPhase1SlideTypes,
  getPhase2SlideTypes,
  buildPhase2CatalogPrompt,
} from '../server/utils/ai/slide-catalog/builders.js';
import { SLIDE_TYPE_CATALOG } from '../server/utils/ai/slide-catalog/definitions.js';

test('content-columns-slide has no AI catalog entry', () => {
  assert.equal(
    SLIDE_TYPE_CATALOG['content-columns-slide'],
    undefined,
    'deprecated type must not carry a catalog entry'
  );
});

test('the Phase-1 and Phase-2 offered type lists exclude content-columns-slide', () => {
  assert.ok(
    !getPhase1SlideTypes().includes('content-columns-slide'),
    'not offered in Phase 1'
  );
  assert.ok(
    !getPhase2SlideTypes().includes('content-columns-slide'),
    'not offered in Phase 2'
  );
});

test('the assembled Phase-2 catalog prompt never mentions content-columns-slide', () => {
  const prompt = buildPhase2CatalogPrompt({});
  assert.ok(
    !prompt.includes('content-columns-slide'),
    'the deprecated type name must not appear anywhere in the offered catalog prompt'
  );
});
