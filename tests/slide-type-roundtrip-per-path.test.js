/**
 * The one-spelling round-trip, proven per write path.
 *
 * The format has ONE published spelling of `slides[].type`: the canonical
 * reverse-DNS id (`eu.deckyard.slide.title`). Every write path folds it down to
 * the bare registry key (`title-slide`) on the way in — through the shared
 * `normalizeSlides()` seam (#511) — and every read/export projects the key back
 * up to the canonical id — through `canonicalSlideType()` (#514). The round-trip
 * is stable by construction; this suite proves each path is actually wired to
 * both seams, so a future path that bypasses one is caught here.
 *
 * The six write paths of docs/plans/briefs/one-spelling.md:
 *   1. Internal REST PUT /api/presentations/:id                  — facade update  [here]
 *   2. Public API PUT /api/v1/presentations/:id (whole deck)      — handlePresentations [sibling]
 *   3. Public API POST/PUT /api/v1/.../slides (per slide)         — handleSlides   [sibling]
 *   4. MCP create_presentation_from_slides (strict)               — validate + facade [here]
 *   5. MCP fix-mode / add_slide / update_slide                    — validate + facade [here]
 *   6. Import (JSON/.deck/markdown) + export                      — deck.js (pure)  [here]
 *
 * This file drives the facade against the Postgres adapter on the in-memory
 * database double (tests/helpers/fake-db.js): the facade folds every full-body
 * write through `normalizeSlides()` at crud/write.js, so it exercises paths
 * 1/4/5 natively, plus the pure import/export pair (6). Paths 2/3 send partial
 * bodies through the public HTTP handlers, which rely on the adapter's
 * column-level merge; they live in tests/public-api-slide-type-validation.test.js,
 * which asserts both the key-is-stored half and the GET-emits-canonical half
 * there.
 *
 * Run with: node --test tests/slide-type-roundtrip-per-path.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { testScope } from './helpers/storage-scope.js';
import { presentationToDeck, deckToPresentationParts } from '../shared/slide-types/deck.js';
import { getSlideTypeId } from '../shared/slide-types/registry.js';
import { validateRefinedSlidesStrict } from '../server/utils/ai/validate-slides/strict.js';
import { validateAndFixRefinedSlides } from '../server/utils/ai/validate-slides/fix.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/lifecycle.js'
);
const { createPresentation, updatePresentation, getPresentation } = await import(
  '../server/storage/presentations/index.js'
);

/** The canonical reverse-DNS id a title slide is written as. */
const CANONICAL = getSlideTypeId('title-slide'); // 'eu.deckyard.slide.title'
const KEY = 'title-slide';
const OWNER = 'roundtrip@example.com';

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** A scope acting as OWNER. */
function scope() {
  return testScope(null, { actorEmail: OWNER });
}

/** Create a fresh deck and return the created object (carries title/theme/lang). */
async function freshDeck() {
  const created = await createPresentation(scope(), {
    title: 'Round-trip',
    theme: 'default',
    lang: 'nl',
    ownerEmail: OWNER,
  });
  assert.ok(created?.id, `createPresentation failed: ${JSON.stringify(created)}`);
  return created;
}

/** Write `slides` onto a fresh deck (full-body update) and return the stored deck. */
async function storeSlides(slides) {
  const created = await freshDeck();
  await updatePresentation(scope(), created.id, { ...created, slides }, { actorEmail: OWNER });
  return getPresentation(scope(), created.id);
}

// ── Path 1: internal REST / storage facade ─────────────────────────────────
test('facade update: canonical id in → registry key stored → canonical exported', async () => {
  const stored = await storeSlides([{ type: CANONICAL, content: { title: 'Hoi' } }]);
  assert.equal(stored.slides[0].type, KEY, 'storage folds the canonical id to the bare key');
  assert.equal(
    presentationToDeck(stored).slides[0].type,
    CANONICAL,
    'export projects the key back to the canonical id'
  );
});

// ── Path 4: MCP create_presentation_from_slides (strict) ───────────────────
test('MCP strict: validate accepts the canonical id, facade stores the key, export is canonical', async () => {
  const slides = [{ type: CANONICAL, content: { title: 'Hoi' } }];
  // The strict validator is the MCP-specific seam; it must accept the canonical id.
  assert.doesNotThrow(() => validateRefinedSlidesStrict(slides));

  const stored = await storeSlides(slides);
  assert.equal(stored.slides[0].type, KEY);
  assert.equal(presentationToDeck(stored).slides[0].type, CANONICAL);
});

// ── Path 5: MCP fix-mode / add_slide / update_slide ────────────────────────
test('MCP fix: validate-and-fix keeps the canonical id, facade stores the key, export is canonical', async () => {
  const fixed = validateAndFixRefinedSlides([{ type: CANONICAL, content: { title: 'Hoi' } }]);
  assert.equal(fixed.length, 1, 'the slide survives the fix pass');

  const stored = await storeSlides(fixed.map((s) => ({ type: s.type, content: s.content })));
  assert.equal(stored.slides[0].type, KEY);
  assert.equal(presentationToDeck(stored).slides[0].type, CANONICAL);
});

// ── Path 6: import + export (pure) ─────────────────────────────────────────
test('import: canonical id in → registry key parts → canonical exported', () => {
  const parts = deckToPresentationParts({ slides: [{ type: CANONICAL, content: { title: 'Hoi' } }] });
  assert.equal(parts.slides[0].type, KEY, 'import folds any spelling to the registry key');
  assert.equal(
    presentationToDeck(parts).slides[0].type,
    CANONICAL,
    'export projects it back to canonical'
  );
});
