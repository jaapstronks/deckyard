import test from 'node:test';
import assert from 'node:assert/strict';
import { slideFingerprint } from '../shared/slide-fingerprint.js';
import {
  translationFieldKey,
  translationSource,
} from '../shared/translation-provenance.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const {
  createPresentation,
  duplicatePresentation,
  getPresentation,
  updatePresentation,
} = await import('../server/storage/presentations/index.js');

test.beforeEach(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});
test.afterEach(() => __setTestDb(null));

async function seededDeck() {
  const created = await createPresentation(testScope(), {
    title: 'Deck',
    ownerEmail: 'owner@example.com',
    lang: 'nl',
  });
  const baseSlide = created.slides[0];
  const slides = ['a', 'b'].map((id) => ({
    ...structuredClone(baseSlide),
    id,
    content: { ...baseSlide.content, title: `Bron ${id}` },
  }));
  const doc = structuredClone(created);
  doc.slides = slides;
  doc.i18n = {
    active: 'en-GB',
    dominant: 'nl',
    versions: {
      nl: { title: 'Deck', slides },
      'en-GB': {
        title: 'Deck EN',
        slides: slides.map((slide) => ({
          ...structuredClone(slide),
          content: { ...slide.content, title: `Target ${slide.id}` },
        })),
      },
    },
  };
  doc.title = 'Deck EN';
  doc.slides = doc.i18n.versions['en-GB'].slides;
  await updatePresentation(testScope(), created.id, doc);
  return getPresentation(testScope(), created.id);
}

for (const activeLang of ['nl', 'en-GB'])
  test(`stale ${activeLang} slide merge keeps text and provenance aligned`, async () => {
    const base = await seededDeck();
    const stale = structuredClone(base);
    stale.i18n.active = activeLang;
    stale.title = stale.i18n.versions[activeLang].title;
    stale.slides = structuredClone(stale.i18n.versions[activeLang].slides);
    const fingerprint = slideFingerprint(
      stale.slides.find((s) => s.id === 'a'),
    );
    const other = structuredClone(stale);
    const keyB = translationFieldKey('b', ['title']);
    other.slides.find((s) => s.id === 'b').content.title = 'Translated B';
    other.i18n.versions[activeLang].slides = other.slides;
    const sourceLang = activeLang === 'nl' ? 'en-GB' : 'nl';
    const sourceText = activeLang === 'nl' ? 'Target' : 'Bron';
    other.i18n.versions[activeLang].translationSources = {
      [keyB]: translationSource(sourceLang, `${sourceText} b`),
    };
    const otherLangKey = translationFieldKey('b', ['body']);
    other.i18n.versions[sourceLang].translationSources = {
      [otherLangKey]: translationSource(activeLang, 'Other source'),
    };
    await updatePresentation(testScope(), base.id, other);

    const keyA = translationFieldKey('a', ['title']);
    stale.slides.find((s) => s.id === 'a').content.title = 'Translated A';
    stale.i18n.versions[activeLang].slides = stale.slides;
    stale.i18n.versions[activeLang].translationSources = {
      [keyA]: translationSource(sourceLang, `${sourceText} a`),
    };
    await updatePresentation(testScope(), base.id, stale, {
      expectedRevision: base.revision,
      modifiedSlideIds: ['a'],
      slideBaseFingerprints: { a: fingerprint },
      clientReordered: false,
    });
    const saved = await getPresentation(testScope(), base.id);
    assert.equal(
      saved.i18n.versions[activeLang].slides.find((s) => s.id === 'b').content
        .title,
      'Translated B',
    );
    assert.deepEqual(saved.i18n.versions[activeLang].translationSources, {
      [keyA]: translationSource(sourceLang, `${sourceText} a`),
      [keyB]: translationSource(sourceLang, `${sourceText} b`),
    });
    assert.deepEqual(saved.i18n.versions[sourceLang].translationSources, {
      [otherLangKey]: translationSource(activeLang, 'Other source'),
    });
  });

test('stale translation of a server-modified slide conflicts', async () => {
  const base = await seededDeck();
  const stale = structuredClone(base);
  stale.title = stale.i18n.versions['en-GB'].title;
  stale.slides = structuredClone(stale.i18n.versions['en-GB'].slides);
  const fingerprint = slideFingerprint(stale.slides[0]);
  const other = structuredClone(stale);
  other.slides[0].content.title = 'Other translation';
  other.i18n.versions['en-GB'].slides = other.slides;
  await updatePresentation(testScope(), base.id, other);
  stale.slides[0].content.title = 'Stale translation';
  stale.i18n.versions['en-GB'].slides = stale.slides;
  await assert.rejects(
    updatePresentation(testScope(), base.id, stale, {
      expectedRevision: base.revision,
      modifiedSlideIds: ['a'],
      slideBaseFingerprints: { a: fingerprint },
      clientReordered: false,
    }),
    { statusCode: 409 },
  );
});

test('ordinary stale slide edit retains a server-added record on that slide', async () => {
  const base = await seededDeck();
  const stale = structuredClone(base);
  stale.title = stale.i18n.versions['en-GB'].title;
  stale.slides = structuredClone(stale.i18n.versions['en-GB'].slides);
  const fingerprint = slideFingerprint(stale.slides[0]);
  const key = translationFieldKey('a', ['title']);
  const other = structuredClone(stale);
  other.i18n.versions['en-GB'].translationSources = {
    [key]: translationSource('nl', 'Bron a'),
  };
  await updatePresentation(testScope(), base.id, other);
  stale.slides[0].content.title = 'Edited A';
  stale.i18n.versions['en-GB'].slides = stale.slides;
  await updatePresentation(testScope(), base.id, stale, {
    expectedRevision: base.revision,
    modifiedSlideIds: ['a'],
    slideBaseFingerprints: { a: fingerprint },
    clientReordered: false,
  });
  const saved = await getPresentation(testScope(), base.id);
  assert.equal(
    saved.i18n.versions['en-GB'].slides[0].content.title,
    'Edited A',
  );
  assert.deepEqual(
    saved.i18n.versions['en-GB'].translationSources[key],
    translationSource('nl', 'Bron a'),
  );
});

test('a stale save that also changes the deck title requires an exact revision', async () => {
  const base = await seededDeck();
  const stale = structuredClone(base);
  stale.i18n.active = 'nl';
  stale.title = 'Renamed in stale tab';
  stale.slides = structuredClone(stale.i18n.versions.nl.slides);
  stale.i18n.versions.nl.title = stale.title;
  const other = structuredClone(base);
  other.i18n.active = 'nl';
  other.title = other.i18n.versions.nl.title;
  other.slides = other.i18n.versions.nl.slides;
  await updatePresentation(testScope(), base.id, other);
  await assert.rejects(
    updatePresentation(testScope(), base.id, stale, {
      expectedRevision: base.revision,
      modifiedSlideIds: ['a'],
      clientReordered: false,
    }),
    { statusCode: 409 },
  );
});

test('duplicate rekeys slide provenance and retains deck-title provenance', async () => {
  const base = await seededDeck();
  const doc = structuredClone(base);
  doc.title = doc.i18n.versions['en-GB'].title;
  doc.slides = doc.i18n.versions['en-GB'].slides;
  const keyA = translationFieldKey('a', ['title']);
  const deckKey = translationFieldKey(null, ['title']);
  doc.i18n.versions['en-GB'].translationSources = {
    [keyA]: translationSource('nl', 'Bron a'),
    [deckKey]: translationSource('nl', 'Deck'),
  };
  await updatePresentation(testScope(), base.id, doc);
  const original = await getPresentation(testScope(), base.id);
  const result = await duplicatePresentation(testScope(), base.id);
  assert.equal(result.ok, true);
  const copy = result.presentation;
  const copiedId = copy.i18n.versions['en-GB'].slides[0].id;
  assert.notEqual(copiedId, 'a');
  assert.deepEqual(copy.i18n.versions['en-GB'].translationSources, {
    [translationFieldKey(copiedId, ['title'])]: translationSource(
      'nl',
      'Bron a',
    ),
    [deckKey]: translationSource('nl', 'Deck'),
  });
  assert.deepEqual(await getPresentation(testScope(), base.id), original);
});
