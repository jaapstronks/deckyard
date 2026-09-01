/**
 * `i18n.dominant` is the language the deck is written in, and it stays put
 * while another version is being edited (D74).
 *
 * Three client seams used to assign `dominant = active` — the editor bootstrap,
 * every save, and the language switch — under a pre-D72 rule that there was
 * "one language mode for both edit and present". The consequence was that the
 * source moved to whatever you last opened: create an empty `en-GB` version and
 * it is instantly labelled "source" while the fully written Dutch original is
 * reported as missing every text it has. Every translation count was measured
 * from a moving zero point.
 *
 * `active` still carries the one language mode — it is the version that is
 * edited *and* presented, and the presenter reads it before `dominant`. What is
 * pinned here is only the split: opening or saving a version moves `active`
 * alone, while the readers that must show the deck's original — the top-level
 * `title`/`slides` behind the list preview and the viewer default, the follow
 * API's `dominantLang`, and the menu's own status column — keep answering with
 * the source.
 *
 * Run with: node --test tests/i18n-dominant-is-stable-source.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initPresentationI18n } from '../client/views/editor/bootstrap.js';
import { createSaveManager } from '../client/views/editor/save-manager.js';
import { normalizeI18n } from '../server/storage/presentations/i18n.js';
import { projectPresentationForLang } from '../server/utils/i18n.js';
import { followMetaFromPresentation } from '../server/routes/api/follow/helpers.js';
import { translationProgress } from '../shared/i18n-progress.js';
import { normalizeLang } from '../shared/i18n-utils.js';

const noopToast = { info: () => {}, error: () => {}, success: () => {} };

// A real type: `normalizeI18n` runs the write seam's slide validation, which
// rejects an invented type id.
const SLIDE_TYPES = {
  'title-slide': { fields: [{ key: 'title', type: 'string' }] },
};

const slide = (id, title) => ({
  id,
  type: 'title-slide',
  content: { title },
  notes: '',
});

/**
 * A deck written in Dutch with a German translation, opened in German — the
 * shape the editor is in one click after a language switch. Top-level
 * `title`/`slides` hold the version being edited, as the server projects them
 * for `?lang=de`.
 */
function makeDeckOpenedInGerman() {
  return {
    id: 'p1',
    title: 'Dek',
    revision: 1,
    slides: [slide('a', 'A de')],
    i18n: {
      active: 'de',
      dominant: 'nl',
      versions: {
        nl: { title: 'Dek', slides: [slide('a', 'A nl')] },
        de: { title: 'Dek', slides: [slide('a', 'A de')] },
      },
    },
  };
}

test('the editor bootstrap leaves an existing dominant alone', () => {
  const pres = makeDeckOpenedInGerman();
  initPresentationI18n({ pres, initialLang: 'de' });

  assert.equal(pres.i18n.active, 'de');
  assert.equal(pres.i18n.dominant, 'nl', 'the source is still Dutch');
  assert.equal(
    pres.i18n.versions.nl.slides[0].content.title,
    'A nl',
    'and the Dutch version was not overwritten with the German buffers',
  );
});

test('the bootstrap still names a source when the deck names none', () => {
  const pres = {
    id: 'p2',
    title: 'Deck',
    slides: [slide('a', 'A')],
    i18n: { versions: {} },
  };
  initPresentationI18n({ pres, initialLang: 'fr' });

  assert.equal(pres.i18n.active, 'fr');
  assert.equal(pres.i18n.dominant, 'fr');
});

test('a dominant naming no version falls back to the active one', () => {
  // Rather than backfilling `versions.nl` from the German buffers: that would
  // leave two versions sharing one slides array, and every edit to the active
  // version would silently rewrite the source too.
  const pres = {
    id: 'p3',
    title: 'Dek',
    slides: [slide('a', 'A de')],
    i18n: { active: 'de', dominant: 'nl', versions: {} },
  };
  initPresentationI18n({ pres, initialLang: 'de' });

  assert.equal(pres.i18n.dominant, 'de');
  assert.deepEqual(Object.keys(pres.i18n.versions), ['de']);
});

test('saving in a second language does not move the source', async () => {
  const pres = makeDeckOpenedInGerman();
  const sent = [];
  const mgr = createSaveManager({
    api: async (_path, opts) => {
      const body = JSON.parse(opts.body);
      sent.push(body);
      return {
        ...body,
        revision: Number(opts.headers['If-Match']) + 1,
        modified: 'x',
      };
    },
    toast: noopToast,
    pres,
    id: pres.id,
    SLIDE_TYPES,
    normalizeLang,
    getSelectedSlideId: () => 'a',
  });

  pres.slides[0].content.title = 'A de, herschreven';
  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].i18n.active, 'de');
  assert.equal(
    sent[0].i18n.dominant,
    'nl',
    'the payload keeps Dutch as source',
  );
  assert.equal(pres.i18n.dominant, 'nl', 'and so does the local model');
  assert.equal(
    sent[0].i18n.versions.nl.slides[0].content.title,
    'A nl',
    'the Dutch prose survived the structure mirror',
  );
});

test('the write seam keeps the deck preview and viewer default on the source', () => {
  // Top-level `title`/`slides` are what the deck list previews and what the
  // viewer serves without `?lang=`; `normalizeI18n` aligns them to the dominant
  // version, so both keep showing the original while German is being edited.
  const pres = makeDeckOpenedInGerman();
  pres.title = 'Dek (de)';
  pres.slides = [slide('a', 'A de, herschreven')];

  normalizeI18n(pres);

  assert.equal(pres.i18n.dominant, 'nl');
  assert.equal(
    pres.lang,
    'nl',
    'the export/public-HTML hint follows the source',
  );
  assert.equal(pres.title, 'Dek');
  assert.equal(pres.slides[0].content.title, 'A nl');
  assert.equal(
    pres.i18n.versions.de.slides[0].content.title,
    'A de, herschreven',
    'while the edited version took the incoming buffers',
  );
});

test('the write seam repairs a dangling dominant the way the bootstrap does', () => {
  // One repair for one malformed state, on both surfaces: a `dominant` naming
  // a version the deck does not carry resolves to the version being edited.
  // The server used to backfill `versions.nl` from the top-level buffers here —
  // which hold the *German* text — and so stored a copy of the translation
  // labelled as the source.
  const pres = {
    id: 'p4',
    title: 'Dek',
    slides: [slide('a', 'A de')],
    i18n: { active: 'de', dominant: 'nl', versions: {} },
  };
  normalizeI18n(pres);

  assert.equal(pres.i18n.dominant, 'de');
  assert.deepEqual(Object.keys(pres.i18n.versions), ['de']);
  assert.equal(pres.lang, 'de');
});

test('the write seam names the edited version as source when the deck names none', () => {
  // Same rule as `initPresentationI18n`: without a stated source, the version
  // being edited is the source — not the first version in the language axis.
  const pres = {
    id: 'p5',
    title: 'Dek',
    slides: [slide('a', 'A de')],
    i18n: {
      active: 'de',
      versions: { nl: { title: 'Dek', slides: [slide('a', 'A nl')] } },
    },
  };
  normalizeI18n(pres);

  assert.equal(pres.i18n.dominant, 'de');
  assert.equal(
    pres.i18n.versions.nl.slides[0].content.title,
    'A nl',
    'the Dutch version is kept as a translation, not overwritten',
  );
});

test('rendering a version for export or publish moves the language mode only', () => {
  const pres = makeDeckOpenedInGerman();
  const projected = projectPresentationForLang(pres, 'de');

  assert.equal(projected.lang, 'de');
  assert.equal(projected.i18n.active, 'de');
  assert.equal(projected.i18n.dominant, 'nl', 'the source is not renamed');
  assert.equal(projected.slides[0].content.title, 'A de');
});

test('the follow API and the menu status both measure from the source', () => {
  const pres = makeDeckOpenedInGerman();
  // The German version is missing the one text the Dutch original fills.
  pres.i18n.versions.de.slides[0].content.title = '';

  assert.deepEqual(translationProgress(pres), {
    dominant: 'nl',
    missing: { de: 1 },
  });

  const meta = followMetaFromPresentation(pres, {
    includeTranslationStatus: true,
  });
  assert.equal(meta.dominantLang, 'nl');
  assert.deepEqual(meta.availableLangs, ['nl', 'de']);
  assert.equal(meta.translationStatus.nl.missing, 0);
  assert.equal(meta.translationStatus.de.missing, 1);
});
