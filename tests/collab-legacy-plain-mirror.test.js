/**
 * Editing a doc that was bootstrapped before the text-field classifier moved.
 *
 * Until 2026-08-25 the collab codec treated a `hidden` field as a plain value —
 * one string shared by every language — which was wrong for
 * `text-blocks-slide`'s numbered keys, a legacy mirror of translatable prose.
 * The classifier now lives in `shared/slide-types/text-fields.js` and asks only
 * about the field's type, so new docs store such a field per language.
 *
 * Docs already in `presentation_ydocs.state` are not re-classified on load.
 * Any non-collab save drops the binary and forces a re-bootstrap under the new
 * rule, so most decks heal by themselves — but a deck edited only through
 * collab keeps its old binary indefinitely, holding one plain string where the
 * schema now says text.
 *
 * The first local edit on such a field is the dangerous moment. Seeding only
 * the language being typed in would turn a wrong-but-present translation into
 * an empty one, and `onStoreDocument` would write that emptiness into the
 * durable deck JSON — the same data loss the classifier fix was meant to end,
 * arriving through the other door. So the binder seeds every language from the
 * plain value it found, then patches the active one.
 *
 * The legacy state is reproduced honestly: the doc is bootstrapped through a
 * codec whose registry declares the mirror as an enum (landing it plain,
 * exactly as `hidden` used to), and then edited through a codec using the real
 * registry (where it is text).
 *
 * Run with: node --test tests/collab-legacy-plain-mirror.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';
import { createDeckYdocCodec } from '../shared/collab/deck-ydoc.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { createLiveDocBinder } from '../client/lib/collab/live-doc-binder.js';

const MIRROR_KEY = 'row1Block1Title';

/** A registry in which the mirror is plain — the pre-fix classification. */
function legacyRegistry() {
  const def = SLIDE_TYPES['text-blocks-slide'];
  return {
    ...SLIDE_TYPES,
    'text-blocks-slide': {
      ...def,
      fields: def.fields.map((f) =>
        f.key === MIRROR_KEY ? { ...f, type: 'enum', options: [] } : f,
      ),
    },
  };
}

function bilingualDeck() {
  const slides = (lang) => [
    {
      id: 's1',
      type: 'text-blocks-slide',
      content: { [MIRROR_KEY]: lang === 'nl' ? 'Kopje' : 'Heading' },
      notes: '',
    },
  ];
  return {
    id: 'deck-legacy',
    title: 'Legacy deck',
    lang: 'nl',
    theme: 'default',
    slides: slides('nl'),
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Legacy deck', slides: slides('nl') },
        'en-GB': { title: 'Legacy deck', slides: slides('en-GB') },
      },
    },
  };
}

/** Bootstrap under the old rule, then bind with the real one. */
function legacyDocAndBinder(activeLang) {
  const doc = new Y.Doc();
  createDeckYdocCodec(Y, {
    slideTypes: legacyRegistry(),
  }).bootstrapPresentationToDoc(bilingualDeck(), doc);

  const codec = createDeckYdocCodec(Y);
  const pres = codec.projectDocToPresentation(doc);
  pres.i18n.active = activeLang;
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => pres?.i18n?.active || null,
  });
  binder.attach();
  return { doc, codec, pres, binder };
}

test('the legacy doc really does hold the mirror as one plain value', () => {
  const { doc, codec, binder } = legacyDocAndBinder('nl');
  const content = doc.getArray('slides').get(0).get('content');
  assert.equal(
    typeof content.get(MIRROR_KEY),
    'string',
    'fixture assumes the pre-fix shape: a plain string, not a lang map',
  );
  const projected = codec.projectDocToPresentation(doc);
  // Both languages show the dominant text — the collapse this fixture models.
  assert.equal(
    projected.i18n.versions.nl.slides[0].content[MIRROR_KEY],
    'Kopje',
  );
  assert.equal(
    projected.i18n.versions['en-GB'].slides[0].content[MIRROR_KEY],
    'Kopje',
  );
  binder.destroy();
});

test('editing a legacy plain mirror does not empty the other language', () => {
  const { doc, codec, pres, binder } = legacyDocAndBinder('nl');

  pres.slides[0].content[MIRROR_KEY] = 'Kopje bewerkt';
  binder.syncLocal();

  const projected = codec.projectDocToPresentation(doc);
  assert.equal(
    projected.i18n.versions.nl.slides[0].content[MIRROR_KEY],
    'Kopje bewerkt',
    'the edited language takes the new text',
  );
  assert.equal(
    projected.i18n.versions['en-GB'].slides[0].content[MIRROR_KEY],
    'Kopje',
    'the other language keeps what it was displaying — never blanked',
  );
  binder.destroy();
});

test('editing from the non-dominant language seeds the dominant one', () => {
  const { doc, codec, pres, binder } = legacyDocAndBinder('en-GB');

  pres.slides[0].content[MIRROR_KEY] = 'Heading edited';
  binder.syncLocal();

  const projected = codec.projectDocToPresentation(doc);
  assert.equal(
    projected.i18n.versions['en-GB'].slides[0].content[MIRROR_KEY],
    'Heading edited',
  );
  assert.equal(
    projected.i18n.versions.nl.slides[0].content[MIRROR_KEY],
    'Kopje',
    'the dominant language keeps its text',
  );
  binder.destroy();
});

test('a doc bootstrapped under the current rule is unaffected', () => {
  const doc = new Y.Doc();
  const codec = createDeckYdocCodec(Y);
  codec.bootstrapPresentationToDoc(bilingualDeck(), doc);
  const pres = codec.projectDocToPresentation(doc);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => 'nl',
  });
  binder.attach();

  pres.slides[0].content[MIRROR_KEY] = 'Kopje bewerkt';
  binder.syncLocal();

  const projected = codec.projectDocToPresentation(doc);
  assert.equal(
    projected.i18n.versions.nl.slides[0].content[MIRROR_KEY],
    'Kopje bewerkt',
  );
  assert.equal(
    projected.i18n.versions['en-GB'].slides[0].content[MIRROR_KEY],
    'Heading',
    'a per-language doc keeps its real translation',
  );
  binder.destroy();
});
