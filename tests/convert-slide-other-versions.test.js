/**
 * A type conversion reaches every language version (B590 PR B).
 *
 * The save mirrors the active version's structure into the other versions,
 * type included, and keeps each version's own prose, an undeclared string
 * too (D79). A conversion, from the editor's Convert… or from an alternative
 * in the AI review, therefore left the old type's text keys in every other
 * version: `body` on a list slide. The server refuses that deck as
 * `unknown_field`, on every save after it. `convertSlideInOtherVersions()`
 * converts the same slide in the other versions, so the save that follows
 * mirrors a deck the server takes.
 *
 * Run with: node --test tests/convert-slide-other-versions.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveManager } from '../client/views/editor/save-manager.js';
import { convertSlideInOtherVersions } from '../client/views/editor/convert-slide-action.js';
import { normalizeLang } from '../shared/i18n-utils.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { undeclaredContentKeys } from '../shared/slide-types/declared-keys.js';

const noopToast = { info: () => {}, error: () => {}, success: () => {} };

function bilingualDeck(type, contentFor) {
  const nl = [{ id: 'a', type, content: contentFor('nl'), notes: '' }];
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: nl,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': {
          title: 'Deck',
          slides: [{ id: 'a', type, content: contentFor('en-GB'), notes: '' }],
        },
      },
    },
  };
}

async function save(pres) {
  const mgr = createSaveManager({
    api: async (_path, opts) => ({
      ...JSON.parse(opts.body),
      revision: Number(opts.headers['If-Match']) + 1,
      modified: 'x',
    }),
    toast: noopToast,
    pres,
    id: pres.id,
    SLIDE_TYPES,
    normalizeLang,
    getSelectedSlideId: () => 'a',
  });
  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();
}

const undeclared = (pres) =>
  Object.entries(pres.i18n.versions).flatMap(([lang, version]) =>
    version.slides.flatMap((slide) =>
      undeclaredContentKeys(SLIDE_TYPES[slide.type], slide.content).map(
        (key) => `${lang}: ${slide.type}.${key}`,
      ),
    ),
  );

test('a switch the convert seam does not know keeps the declared keys elsewhere', async () => {
  const pres = bilingualDeck('content-slide', (lang) => ({
    title: lang === 'nl' ? 'Partners' : 'Partners (en)',
    body: lang === 'nl' ? '- Alfa\n- Beta' : '- Alpha\n- Beta',
  }));
  // What the AI review's switch leaves in the active version.
  pres.slides[0] = {
    ...pres.slides[0],
    type: 'list-slide',
    content: {
      title: 'Partners',
      items: [
        { title: 'Alfa', text: '' },
        { title: 'Beta', text: '' },
      ],
    },
  };
  pres.i18n.versions.nl.slides = pres.slides;
  convertSlideInOtherVersions({
    pres,
    slideId: 'a',
    toType: 'list-slide',
    SLIDE_TYPES,
  });
  await save(pres);

  const en = pres.i18n.versions['en-GB'].slides[0];
  assert.equal(en.type, 'list-slide');
  assert.equal(en.content.title, 'Partners (en)', 'the shared key survives');
  assert.equal(en.content.items.length, 2, 'the structure mirrors');
  assert.deepEqual(undeclared(pres), []);
});

test('without it the save leaves the old type text behind (the bug)', async () => {
  const pres = bilingualDeck('content-slide', () => ({
    title: 'Partners',
    body: 'Old text',
  }));
  pres.slides[0] = {
    ...pres.slides[0],
    type: 'list-slide',
    content: { title: 'Partners', items: [{ title: 'A', text: '' }] },
  };
  pres.i18n.versions.nl.slides = pres.slides;
  await save(pres);
  assert.deepEqual(undeclared(pres), ['en-GB: list-slide.body']);
});

test('a pair the convert seam knows converts in every version', async () => {
  const pres = bilingualDeck('image-text-slide', (lang) => ({
    title: lang,
    body: `Body ${lang}`,
    image: '/x.jpg',
  }));
  convertSlideInOtherVersions({
    pres,
    slideId: 'a',
    toType: 'image-set-slide',
    SLIDE_TYPES,
  });
  const en = pres.i18n.versions['en-GB'].slides[0];
  assert.equal(en.type, 'image-set-slide');
  assert.equal(en.content.title, 'en-GB');
  assert.equal(en.content.body, 'Body en-GB');
  assert.equal(
    pres.slides[0].type,
    'image-text-slide',
    'the active version is the caller’s',
  );
});
