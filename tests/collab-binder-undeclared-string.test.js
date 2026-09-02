/**
 * The live-edit path classifies an undeclared string as prose too (B211 part
 * 2, D79, #1040).
 *
 * `diffContentMap` in the binder is the fourth place that had to answer "is
 * this content key per language" — after the codec bootstrap, the codec's
 * server apply and the editor's save sync. It answered with the declared text
 * keys alone, so typing into a key the type does not declare wrote a plain
 * LWW value: one string for the whole deck, and the other language's version
 * gone on the next projection. Same rule, same module, same answer.
 *
 * Run with: node --test tests/collab-binder-undeclared-string.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/lib/collab/live-doc-binder.js');

/**
 * A type declaring one text field and one machine value. `legacyTagline` and
 * `legacyColumns` below are what history left behind: stored, never declared.
 */
const SLIDE_TYPES = {
  'text-slide': {
    fields: [
      { key: 'body', type: 'markdown' },
      { key: 'accent', type: 'enum', options: ['lime', 'coral'] },
    ],
  },
};

function bilingualPres() {
  const slideFor = (body, tagline) => ({
    id: 's1',
    type: 'text-slide',
    notes: '',
    content: {
      body,
      accent: 'lime',
      legacyTagline: tagline,
      legacyColumns: 3,
    },
  });
  const nl = [slideFor('Body nl', 'Zo doen wij dat')];
  return {
    id: 'p1',
    title: 'Deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': {
          title: 'Deck',
          slides: [slideFor('Body en', 'That is how we do it')],
        },
      },
    },
  };
}

test('typing into an undeclared string key writes a per-language text field', () => {
  const codec = createDeckYdocCodec(Y, { slideTypes: SLIDE_TYPES });
  const doc = new Y.Doc();
  const pres = bilingualPres();
  codec.bootstrapPresentationToDoc(pres, doc);

  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => 'nl',
  });
  binder.attach();

  pres.slides[0].content.legacyTagline = 'Zo doen wij dat (v2)';
  binder.syncLocal();

  const ycontent = doc.getArray('slides').get(0).get('content');
  const entry = ycontent.get('legacyTagline');
  assert.ok(
    entry instanceof Y.Map,
    'an undeclared string is stored as a lang→Y.Text map, not one plain value',
  );

  const out = codec.projectDocToPresentation(doc);
  assert.equal(
    out.i18n.versions.nl.slides[0].content.legacyTagline,
    'Zo doen wij dat (v2)',
    'the edit landed in the active language',
  );
  assert.equal(
    out.i18n.versions['en-GB'].slides[0].content.legacyTagline,
    'That is how we do it',
    'the other language kept its own prose',
  );
  assert.equal(
    out.i18n.versions['en-GB'].slides[0].content.legacyColumns,
    3,
    'an undeclared non-string stays one machine value for the deck',
  );

  binder.detach();
});

test('an undeclared non-string edit stays a plain last-write-wins value', () => {
  const codec = createDeckYdocCodec(Y, { slideTypes: SLIDE_TYPES });
  const doc = new Y.Doc();
  const pres = bilingualPres();
  codec.bootstrapPresentationToDoc(pres, doc);

  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => 'nl',
  });
  binder.attach();

  pres.slides[0].content.legacyColumns = 4;
  binder.syncLocal();

  const ycontent = doc.getArray('slides').get(0).get('content');
  assert.equal(ycontent.get('legacyColumns'), 4, 'stored as a plain value');

  const out = codec.projectDocToPresentation(doc);
  for (const lang of ['nl', 'en-GB']) {
    assert.equal(
      out.i18n.versions[lang].slides[0].content.legacyColumns,
      4,
      `${lang} follows the one machine value`,
    );
  }

  binder.detach();
});
