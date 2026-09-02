/**
 * The editor's save-time language sync reads an undeclared string as prose
 * (B211 part 2, D79, #1040).
 *
 * `syncStructureInto` mirrors the active version's structure into every other
 * version, and used to decide what to mirror with `translatableKeysForType()`
 * alone: a content key the slide type does not declare was copied verbatim
 * from the source language into all the others, on every single save. That is
 * the same loss the collab codec produced — a renamed key, a retired type or a
 * hand-written deck kept exactly one language — and it predates collab by
 * years, which is why fixing the codec alone would have left it standing.
 *
 * The rule now: the type decides for a key it declares, the stored value
 * decides for one it does not. A string is prose and stays per version; a
 * number, an object or an array is a machine value and follows the source.
 *
 * Run with: node --test tests/editor-save-undeclared-string-sync.test.js
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
      { key: 'accent', type: 'enum', options: ['lime', 'coral'] },
    ],
  },
};

/**
 * One slide as an older install stored it: two declared keys, plus a
 * `legacyTagline` the type dropped somewhere along the way and a
 * `legacyColumns` that was always a machine value.
 */
const slide = (id, { body, tagline, accent = 'lime', columns = 3 }) => ({
  id,
  type: 'text-slide',
  content: { body, accent, legacyTagline: tagline, legacyColumns: columns },
  notes: '',
});

function makeBilingualPres() {
  const nl = [slide('a', { body: 'A nl', tagline: 'Zo doen wij dat' })];
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
        de: {
          title: 'Deck',
          slides: [slide('a', { body: 'A de', tagline: 'So machen wir das' })],
        },
      },
    },
  };
}

function makeManager(pres) {
  return createSaveManager({
    api: async (_path, opts) => {
      const body = JSON.parse(opts.body);
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
}

test('a save from one version leaves the other version its own undeclared prose', async () => {
  const pres = makeBilingualPres();
  const mgr = makeManager(pres);

  // Edit the declared prose and the machine value in the active version.
  pres.slides[0].content.body = 'A nl v2';
  pres.slides[0].content.accent = 'coral';
  pres.slides[0].content.legacyColumns = 4;
  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  const de = pres.i18n.versions.de.slides[0].content;
  assert.equal(
    de.legacyTagline,
    'So machen wir das',
    'an undeclared string is prose: the German version keeps its own',
  );
  assert.equal(de.body, 'A de', 'declared prose still survives');
  assert.equal(de.accent, 'coral', 'a declared machine value still mirrors');
  assert.equal(
    de.legacyColumns,
    4,
    'an undeclared non-string is still a machine value and mirrors',
  );
});

test('a slide mirrored into a fresh version arrives without the source prose', async () => {
  const pres = makeBilingualPres();
  const mgr = makeManager(pres);

  pres.slides.push(slide('b', { body: 'B nl', tagline: 'Nieuw en fris' }));
  mgr.markDirty({ slideId: 'b' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  const added = pres.i18n.versions.de.slides[1];
  assert.equal(added.id, 'b', 'the slide reached the German version');
  assert.equal(added.content.body ?? '', '', 'declared prose starts empty');
  assert.equal(
    added.content.legacyTagline ?? '',
    '',
    'undeclared prose starts empty too, rather than arriving in Dutch',
  );
  assert.equal(
    added.content.accent,
    'lime',
    'machine values follow the source',
  );
  assert.equal(added.content.legacyColumns, 3);
});

test('an undeclared string inside an items entry is prose as well', async () => {
  const withItems = (id, { itemTitle, itemNote }) => ({
    id,
    type: 'list-slide',
    content: {
      items: [{ title: itemTitle, icon: 'star', legacyNote: itemNote }],
    },
    notes: '',
  });
  const types = {
    'list-slide': {
      fields: [
        {
          key: 'items',
          type: 'items',
          itemFields: [
            { key: 'title', type: 'string' },
            { key: 'icon', type: 'enum', options: ['star'] },
          ],
        },
      ],
    },
  };
  const nl = [withItems('a', { itemTitle: 'Eén', itemNote: 'Let op' })];
  const pres = {
    id: 'p2',
    title: 'Deck',
    revision: 1,
    slides: nl,
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        de: {
          title: 'Deck',
          slides: [withItems('a', { itemTitle: 'Eins', itemNote: 'Achtung' })],
        },
      },
    },
  };
  const mgr = createSaveManager({
    api: async (_path, opts) => {
      const body = JSON.parse(opts.body);
      return {
        ...body,
        revision: Number(opts.headers['If-Match']) + 1,
        modified: 'x',
      };
    },
    toast: noopToast,
    pres,
    id: pres.id,
    SLIDE_TYPES: types,
    normalizeLang,
    getSelectedSlideId: () => 'a',
  });

  pres.slides[0].content.items[0].title = 'Eén (v2)';
  mgr.markDirty({ slideId: 'a' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  const item = pres.i18n.versions.de.slides[0].content.items[0];
  assert.equal(item.legacyNote, 'Achtung', 'the item keeps its own prose');
  assert.equal(item.title, 'Eins', 'declared item prose survives too');
  assert.equal(item.icon, 'star');
});
