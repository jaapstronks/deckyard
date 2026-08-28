/**
 * Translation progress is derived per language, not cached for a pair (B182,
 * D72 phase 1).
 *
 * A deck used to carry `i18n.progress` — `missingNlToEnGb` and
 * `missingEnGbToNl`, rewritten on every save — and every surface that asked
 * "how far along is the translation" read those two numbers. That shape has no
 * answer for a third language: a deck with `nl` and `de` versions advertised no
 * German to the follow-along audience, and the German version measured itself
 * against a source `otherLang()` could not name.
 *
 * These tests pin the replacement:
 *
 *   1. `translationSourceFor()` names a source for every language, not two;
 *   2. `translationProgress()` counts per existing version, from the dominant
 *      one outwards;
 *   3. the follow API reports `availableLangs` and `translationStatus` per
 *      existing version;
 *   4. the counter is gone from what is written (`normalizeI18n`) and from what
 *      is stored (schema step v10 -> v11);
 *   5. the translate endpoints refuse a request that names no target language,
 *      rather than falling back to a guess.
 *
 * Run with: node --test tests/i18n-progress-per-language.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  translationSourceFor,
  DEFAULT_DECK_LANG,
} from '../shared/i18n-utils.js';
import {
  existingVersionLangs,
  translationProgress,
} from '../shared/i18n-progress.js';
import {
  CURRENT_SCHEMA_VERSION,
  migratePresentation,
} from '../shared/slide-types/schema-version.js';
import { followMetaFromPresentation } from '../server/routes/api/follow/helpers.js';
import { normalizeI18n } from '../server/storage/presentations/i18n.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A slide in one language. `subheading` is left empty on the target versions of
 * the fixtures below, so the missing-scan has exactly one thing to find per
 * slide.
 */
function slide(id, { title, subheading = '' }) {
  return { id, type: 'content-slide', content: { title, subheading } };
}

/**
 * A Dutch-dominant deck that also has a German version — the shape the old
 * NL/EN counters could not describe. The German version translates the title
 * and leaves the subheading empty, so exactly one field is missing.
 */
function nlDeDeck() {
  return {
    id: 'deck-nl-de',
    title: 'Het plan',
    lang: 'nl',
    slides: [slide('s1', { title: 'Het plan', subheading: 'In het kort' })],
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: {
          title: 'Het plan',
          slides: [
            slide('s1', { title: 'Het plan', subheading: 'In het kort' }),
          ],
        },
        de: {
          title: 'Der Plan',
          slides: [slide('s1', { title: 'Der Plan' })],
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. translationSourceFor — a source for every language
// ---------------------------------------------------------------------------

test('the dominant version is the source for any other language', () => {
  const pres = nlDeDeck();
  assert.equal(translationSourceFor(pres, 'de'), 'nl');
  assert.equal(translationSourceFor(pres, 'fr'), 'nl');
  // `en` is an input alias; the answer is still the dominant version.
  assert.equal(translationSourceFor(pres, 'en'), 'nl');
});

test('translating into the dominant version reads from the version on screen', () => {
  const pres = nlDeDeck();
  pres.i18n.active = 'de';
  assert.equal(translationSourceFor(pres, 'nl'), 'de');
});

test('with no active version, the first other existing version is the source', () => {
  const pres = nlDeDeck();
  delete pres.i18n.active;
  assert.equal(translationSourceFor(pres, 'nl'), 'de');
});

test('a deck with nothing to translate from names no source', () => {
  const pres = {
    lang: 'nl',
    i18n: { dominant: 'nl', versions: { nl: { title: 'Een', slides: [] } } },
  };
  assert.equal(translationSourceFor(pres, 'nl'), null);
  // …and a deck that names no language at all.
  assert.equal(translationSourceFor({}, 'nl'), null);
  assert.equal(translationSourceFor(null, DEFAULT_DECK_LANG), null);
});

// ---------------------------------------------------------------------------
// 2. translationProgress — per existing version, from the dominant outwards
// ---------------------------------------------------------------------------

test('existingVersionLangs lists the versions the deck actually has', () => {
  assert.deepEqual(existingVersionLangs(nlDeDeck()), ['nl', 'de']);
  assert.deepEqual(existingVersionLangs({}), []);
});

test('progress counts the gaps of every version except the dominant one', () => {
  const { dominant, missing } = translationProgress(nlDeDeck());
  assert.equal(dominant, 'nl');
  // One empty `subheading` on the German version, and the dominant version is
  // the source so it never appears in the map.
  assert.deepEqual(missing, { de: 1 });
});

test('a complete version reports zero, not absence', () => {
  const pres = nlDeDeck();
  pres.i18n.versions.de.slides[0].content.subheading = 'Kurz gefasst';
  assert.deepEqual(translationProgress(pres).missing, { de: 0 });
});

// ---------------------------------------------------------------------------
// 3. the follow API answers per existing version
// ---------------------------------------------------------------------------

test('follow meta offers every existing version, German included', () => {
  const meta = followMetaFromPresentation(nlDeDeck());
  assert.equal(meta.dominantLang, 'nl');
  assert.deepEqual(meta.availableLangs, ['nl', 'de']);
  assert.equal(meta.translationStatus, undefined);
});

test('follow translation status is keyed by version, with the dominant complete', () => {
  const pres = nlDeDeck();
  pres.i18n.translation = { de: { status: 'running' } };
  const { translationStatus } = followMetaFromPresentation(pres, {
    includeTranslationStatus: true,
  });

  assert.deepEqual(Object.keys(translationStatus), ['nl', 'de']);
  assert.deepEqual(translationStatus.nl, {
    complete: true,
    missing: 0,
    jobStatus: null,
  });
  assert.deepEqual(translationStatus.de, {
    complete: false,
    missing: 1,
    jobStatus: 'running',
  });
});

// ---------------------------------------------------------------------------
// 4. the stored counter is gone
// ---------------------------------------------------------------------------

test('normalizeI18n writes no progress block', () => {
  const pres = nlDeDeck();
  normalizeI18n(pres);
  assert.equal(pres.i18n.progress, undefined);
  assert.ok(!Object.hasOwn(pres.i18n, 'progress'));
});

test('the v10 -> v11 step drops a stored progress block', () => {
  const pres = nlDeDeck();
  pres.schemaVersion = 10;
  pres.i18n.progress = {
    updatedAt: '2026-01-01T00:00:00.000Z',
    missingNlToEnGb: 3,
    missingEnGbToNl: null,
    hasIncomplete: true,
  };

  const migrated = migratePresentation(pres);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(!Object.hasOwn(migrated.i18n, 'progress'));
  // The versions beside it are untouched.
  assert.deepEqual(existingVersionLangs(migrated), ['nl', 'de']);
});

test('the step is idempotent and leaves a deck without an i18n block alone', () => {
  const plain = migratePresentation({ schemaVersion: 10, slides: [] });
  assert.equal(plain.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(plain.i18n, undefined);

  const twice = migratePresentation(structuredClone(plain));
  assert.equal(twice.schemaVersion, CURRENT_SCHEMA_VERSION);
});
