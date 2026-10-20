import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { JSDOM } from 'jsdom';
import { settleBgTextContrast } from '../server/utils/bg-image-contrast.js';
import { buildBackgroundControls } from '../client/views/editor/editor-form/background-section.js';
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  eachSlide,
  migratePresentation,
  migrateLibraryItem,
} from '../shared/slide-types/schema-version.js';
import {
  renderSlideHtml,
  validateSlide,
} from '../shared/slide-types/presentation.js';
import { createFakeDb } from './helpers/fake-db.js';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import { __setTestDb } from '../server/db/client.js';
import { initializeStorage } from '../server/db/lifecycle.js';
import {
  createPresentation,
  duplicatePresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations/index.js';
import {
  getYDocState,
  setYDocState,
} from '../server/storage/presentations/ydocs.js';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { deckYdocCodec } from '../server/collab/deck-doc.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
let db;
test.before(async () => {
  db = createFakeDb({
    organizations: [
      {
        id: process.env.DEFAULT_ORGANIZATION_ID,
        name: 'Default',
        slug: 'default',
      },
    ],
    themes: [await seedRow('brand')],
  });
  __setTestDb(db);
  await initializeStorage();
});
test.after(() => __setTestDb(null));

function slides(lang) {
  return [
    {
      id: 'old-background',
      type: 'title-slide',
      content: {
        title: `Background ${lang}`,
        background: 'brand',
        slideBgImage: '/uploads/background.jpg',
        slideBgText: 'default',
        slideBgTextAuto: 'light',
        slideBgNeedsScrim: true,
      },
    },
    {
      id: 'other-slide',
      type: 'title-slide',
      content: { title: `Other ${lang}` },
    },
  ];
}
function legacyDeck() {
  return {
    title: 'Old deck',
    lang: 'nl',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    slides: slides('nl'),
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: Object.fromEntries(
        ['nl', 'en-GB', 'de'].map((lang) => [
          lang,
          { title: `Deck ${lang}`, slides: slides(lang) },
        ]),
      ),
    },
  };
}
function assertCanonical(deck) {
  assert.equal(deck.slides.length, 2);
  assert.equal(Object.keys(deck.i18n.versions).length, 3);
  for (const version of Object.values(deck.i18n.versions))
    assert.equal(version.slides.length, 2);
  for (const slide of eachSlide(deck)) {
    if (slide.content.slideBgImage) assert.equal(slide.content.slideBgText, '');
    else assert.ok(!Object.hasOwn(slide.content, 'slideBgText'));
    assert.deepEqual(validateSlide(slide), []);
  }
}

test('default folds to empty optional enum in every language regardless of stamp, idempotently', () => {
  const deck = legacyDeck();
  assert.ok(
    validateSlide(deck.slides[0]).some((e) => e.includes('slideBgText')),
  );
  const expected = structuredClone(deck);
  for (const slide of eachSlide(expected))
    if (slide.content.slideBgText === 'default') slide.content.slideBgText = '';
  assert.equal(migratePresentation(deck), deck);
  assertCanonical(deck);
  assert.deepEqual(deck, expected, 'only the retired key changes');
  migratePresentation(deck);
  assert.deepEqual(deck, expected);
});

test('current values and unrelated invalid values are untouched', () => {
  for (const value of ['auto', 'light', 'dark', '', null, 'invalid']) {
    const deck = migratePresentation({
      slides: [{ content: { slideBgText: value } }],
    });
    assert.equal(deck.slides[0].content.slideBgText, value);
  }
});

test('empty optional enum renders like historical default, without activating dormant auto detection', () => {
  for (const image of ['', '/uploads/background.jpg']) {
    for (const overlay of [undefined, 'none', 'dark', 'gradient-bottom']) {
      const slide = slides('nl')[0];
      slide.content.slideBgImage = image;
      if (overlay) slide.content.slideBgOverlay = overlay;
      const historical = renderSlideHtml(slide);
      const migrated = migratePresentation({ slides: [structuredClone(slide)] })
        .slides[0];
      assert.equal(renderSlideHtml(migrated), historical);
      if (image && !overlay) {
        slide.content.slideBgText = 'auto';
        const auto = renderSlideHtml(slide);
        assert.notEqual(auto, historical);
        assert.match(auto, /slide-bg-overlay-auto/);
        assert.doesNotMatch(historical, /slide-bg-overlay-auto/);
      }
    }
  }
});

test('legacy bgImage folds before default is removed, retaining theme text', () => {
  const slide = slides('nl')[0];
  delete slide.content.slideBgImage;
  slide.content.bgImage = '/uploads/background.jpg';
  // The v21 -> v22 fold has historically kept truthy default instead of
  // forcing light. Removing it first would accidentally force light text.
  const preV24 = { slides: [structuredClone(slide)] };
  for (const step of SCHEMA_MIGRATIONS.slice(0, -1)) step(preV24);
  const historical = renderSlideHtml(preV24.slides[0]);
  const migrated = migratePresentation({ slides: [slide] }).slides[0];
  assert.equal(renderSlideHtml(migrated), historical);
  assert.equal(migrated.content.slideBgImage, '/uploads/background.jpg');
  assert.equal(migrated.content.slideBgText, '');
  assert.doesNotMatch(renderSlideHtml(migrated), /has-slide-bg-light-text/);
});

async function storedLegacyDeck() {
  const created = await createPresentation(testScope(), { title: 'Old deck' });
  const row = db.__tables.presentations.find((r) => r.id === created.id);
  const old = legacyDeck();
  // Bypass current writers to reproduce historical persisted data.
  row.slides = old.slides;
  row.i18n = old.i18n;
  return created.id;
}

test('duplicate old data, edit another slide, and save all language versions', async () => {
  const id = await storedLegacyDeck();
  const copy = await duplicatePresentation(testScope(), id);
  assert.equal(copy.ok, true);
  assertCanonical(copy.presentation);
  const deck = await getPresentation(testScope(), copy.presentation.id);
  assertCanonical(deck);
  for (const [lang, version] of Object.entries(deck.i18n.versions))
    version.slides[1].content.title = `Edited ${lang}`;
  deck.slides[1].content.title = 'Edited nl';
  const saved = await updatePresentation(testScope(), deck.id, deck);
  assert.notEqual(saved.ok, false, JSON.stringify(saved));
  assertCanonical(await getPresentation(testScope(), deck.id));
  const row = db.__tables.presentations.find((r) => r.id === deck.id);
  assertCanonical(row);
  for (const [lang, version] of Object.entries(row.i18n.versions))
    assert.equal(version.slides[1].content.title, `Edited ${lang}`);
  assert.equal(
    db.__tables.presentations.find((r) => r.id === id).slides[0].content
      .slideBgText,
    'default',
    'source row is not rewritten',
  );
});

test('a historical collab binary saves an unrelated edit through the same funnel', async () => {
  const id = await storedLegacyDeck();
  const historical = await getPresentation(testScope(), id);
  historical.i18n.versions['en-GB'].translationSources = {
    '["other-slide",["title"]]': 'source-fingerprint',
  };
  for (const slide of eachSlide(historical))
    if (slide.content.slideBgImage) slide.content.slideBgText = 'default';
  // Codec does not migrate: a restored binary bypasses JSON bootstrap.
  const oldDoc = new Y.Doc();
  deckYdocCodec.bootstrapPresentationToDoc(historical, oldDoc);
  await setYDocState(testScope(), id, Y.encodeStateAsUpdate(oldDoc));
  oldDoc.destroy();
  const errors = [];
  const hooks = createCollabPersistence({
    repoRoot: process.cwd(),
    documentScope: () => testScope(),
    deps: { log: { warn() {}, error: (...args) => errors.push(args) } },
  });
  const doc = new Y.Doc();
  const documentName = `presentation:${id}`;
  await hooks.onLoadDocument({ documentName, document: doc });
  const projected = deckYdocCodec.projectDocToPresentation(doc);
  assertCanonical(projected);
  assert.deepEqual(
    projected.i18n.versions['en-GB'].translationSources,
    historical.i18n.versions['en-GB'].translationSources,
  );
  const reloaded = new Y.Doc();
  Y.applyUpdate(reloaded, await getYDocState(testScope(), id));
  assertCanonical(deckYdocCodec.projectDocToPresentation(reloaded));
  reloaded.destroy();
  const edited = structuredClone(projected);
  edited.slides[1].content.title = 'Collab edit';
  edited.i18n.versions.nl.slides[1].content.title = 'Collab edit';
  deckYdocCodec.applyPresentationToDoc(edited, doc, { base: projected });
  await hooks.onStoreDocument({ documentName, document: doc });
  assert.deepEqual(errors, []);
  const row = db.__tables.presentations.find((r) => r.id === id);
  assertCanonical(row);
  assert.equal(row.slides[1].content.title, 'Collab edit');
  for (const lang of ['en-GB', 'de'])
    assert.equal(
      row.i18n.versions[lang].slides[1].content.title,
      `Other ${lang}`,
    );
  doc.destroy();
});

test('empty optional enum survives successful server contrast detection', async () => {
  const deck = legacyDeck();
  for (const slide of eachSlide(deck)) {
    if (slide.content.slideBgImage) {
      slide.content.slideBgImage = '/assets/images/backgrounds/demo-moss.jpg';
      delete slide.content.slideBgTextAuto;
      delete slide.content.slideBgNeedsScrim;
    }
  }
  migratePresentation(deck);
  const html = renderSlideHtml(deck.slides[0]);
  const count = await settleBgTextContrast(deck, {
    repoRoot: process.cwd(),
    loadTheme: async () => null,
  });
  assert.equal(count, 4, 'real readable image sampled in every buffer');
  assertCanonical(deck);
  assert.equal(renderSlideHtml(deck.slides[0]), html);
  migratePresentation(deck);
  assertCanonical(deck);
});

test('inspector initialization preserves the explicit empty enum', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const original = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const slide = migratePresentation({ slides: slides('nl') }).slides[0];
    // Skip asynchronous image loading: server detection is exercised above.
    slide.content.slideBgAutoFor = slide.content.slideBgImage;
    const html = renderSlideHtml(slide);
    buildBackgroundControls({
      slide,
      pres: {},
      fieldByKey: new Map([['slideBgImage', { key: 'slideBgImage' }]]),
      renderField: () => null,
      fieldGrid: () => null,
    });
    assert.equal(slide.content.slideBgText, '');
    assert.equal(renderSlideHtml(slide), html);
  } finally {
    globalThis.document = original;
    dom.window.close();
  }
});

test('library items share the canonical fold, including every translation', () => {
  const item = {
    slideType: 'title-slide',
    content: slides('nl')[0].content,
    i18n: {
      versions: Object.fromEntries(
        ['nl', 'en-GB', 'de'].map((lang) => [
          lang,
          { content: slides(lang)[0].content },
        ]),
      ),
    },
  };
  migrateLibraryItem(item);
  assert.equal(item.content.slideBgText, '');
  for (const version of Object.values(item.i18n.versions))
    assert.equal(version.content.slideBgText, '');
  const once = structuredClone(item);
  migrateLibraryItem(item);
  assert.deepEqual(item, once);
});

test('loading a current binary preserves text identities, provenance and future extras without rewriting it', async () => {
  const deck = migratePresentation(legacyDeck());
  deck.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
  deck.futureExtra = { untouched: true };
  deck.i18n.versions['en-GB'].translationSources = {
    '["other-slide",["title"]]': 'source-fingerprint',
  };
  const original = new Y.Doc();
  deckYdocCodec.bootstrapPresentationToDoc(deck, original);
  const bytes = Y.encodeStateAsUpdate(original);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const text = doc
    .getArray('slides')
    .get(1)
    .get('content')
    .get('title')
    .get('nl');
  const vector = Y.encodeStateVector(doc);
  const projected = deckYdocCodec.projectDocToPresentation(doc);
  let writes = 0;
  const hooks = createCollabPersistence({
    repoRoot: process.cwd(),
    deps: {
      getYDocState: async () => bytes,
      setYDocState: async () => {
        writes += 1;
      },
    },
  });
  await hooks.onLoadDocument({
    documentName: 'presentation:current',
    document: doc,
  });
  assert.equal(writes, 0);
  assert.equal(
    doc.getArray('slides').get(1).get('content').get('title').get('nl'),
    text,
  );
  assert.deepEqual(Y.encodeStateVector(doc), vector);
  assert.deepEqual(deckYdocCodec.projectDocToPresentation(doc), projected);
  assert.equal(projected.schemaVersion, CURRENT_SCHEMA_VERSION + 1);
  assert.deepEqual(projected.futureExtra, { untouched: true });
  assert.deepEqual(
    projected.i18n.versions['en-GB'].translationSources,
    deck.i18n.versions['en-GB'].translationSources,
  );
  original.destroy();
  doc.destroy();
});
