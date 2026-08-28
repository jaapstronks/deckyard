/**
 * A slide added in one language version lands in **every** other version of the
 * deck (B182 fase 2, D72 #4).
 *
 * The save manager mirrors slide structure — ids, order, type and every
 * non-translatable field — from the version being edited into the others, so a
 * deck cannot end up with three versions that disagree about which slides
 * exist. It used to mirror into `otherLang()`'s answer, which names one
 * language and only inside the NL/EN pair: on a deck with `nl`, `de` and `fr`
 * a slide added in Dutch reached neither of the other two, and on a deck
 * without a Dutch or English version it reached nothing at all.
 *
 * Translatable text is deliberately NOT copied: the mirrored slide arrives with
 * its text fields empty (or keeps the text that version already had), which is
 * what makes the missing-scan and the AI fill able to tell them apart.
 *
 * Run with: node --test tests/language-structure-sync-all-versions.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveManager } from '../client/views/editor/save-manager.js';
import { normalizeLang } from '../shared/i18n-utils.js';

const noopToast = { info: () => {}, error: () => {}, success: () => {} };

const SLIDE_TYPES = {
  'text-slide': {
    fields: [
      { key: 'body', type: 'markdown' },
      { key: 'accent', type: 'text', translatable: false },
    ],
  },
};

const slide = (id, body, accent) => ({
  id,
  type: 'text-slide',
  content: { body, accent },
  notes: '',
});

/** Deck in Dutch (active), German and French — no English version at all. */
function makeTrilingualPres() {
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: [slide('a', 'A nl', 'lime')],
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides: [slide('a', 'A nl', 'lime')] },
        de: { title: 'Deck', slides: [slide('a', 'A de', 'lime')] },
        fr: { title: 'Deck', slides: [slide('a', 'A fr', 'lime')] },
      },
    },
  };
}

function makeManager(pres) {
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
    getSelectedSlideId: () => 'b',
  });
  return { mgr, sent };
}

test('a slide added in the active version reaches every other version', async () => {
  const pres = makeTrilingualPres();
  const { mgr } = makeManager(pres);

  pres.slides.push(slide('b', 'B nl', 'coral'));
  mgr.markDirty({ slideId: 'b' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  for (const lang of ['de', 'fr']) {
    const slides = pres.i18n.versions[lang].slides;
    assert.deepEqual(
      slides.map((s) => s.id),
      ['a', 'b'],
      `${lang} carries both slides in the source's order`,
    );
    const added = slides[1];
    assert.equal(added.type, 'text-slide');
    assert.equal(
      added.content.accent,
      'coral',
      `${lang} follows the source's non-translatable fields`,
    );
    assert.equal(
      added.content.body ?? '',
      '',
      `${lang} does not inherit the source's prose`,
    );
  }
});

test('existing translations survive the mirror', async () => {
  const pres = makeTrilingualPres();
  const { mgr } = makeManager(pres);

  pres.slides[0].content.accent = 'indigo';
  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.equal(pres.i18n.versions.de.slides[0].content.body, 'A de');
  assert.equal(pres.i18n.versions.fr.slides[0].content.body, 'A fr');
  assert.equal(pres.i18n.versions.de.slides[0].content.accent, 'indigo');
});

test('a deleted slide is removed from every other version', async () => {
  const pres = makeTrilingualPres();
  const { mgr } = makeManager(pres);

  pres.slides = [];
  mgr.markDirty();
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.deepEqual(pres.i18n.versions.de.slides, []);
  assert.deepEqual(pres.i18n.versions.fr.slides, []);
});

test('versions the deck does not have are not created by the sync', async () => {
  const pres = makeTrilingualPres();
  const { mgr } = makeManager(pres);

  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.deepEqual(Object.keys(pres.i18n.versions).sort(), ['de', 'fr', 'nl']);
});
