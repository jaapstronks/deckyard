/**
 * The editor writes a text into any language version, not only the active one
 * (B762).
 *
 * `pres.slides` is the active version. Before this seam the binder diffed only
 * that and re-projected every other version over whatever was written into it,
 * and the legacy save tracked only active slide ids, so a translation view had
 * no safe route to its target column. `writeVersionText` is that route, with a
 * collab adapter (the binder writes that language's Y.Text) and a legacy one
 * (`i18n.versions[lang]`, carried by the PUT). Each mode: write a top-level
 * and an item text into the inactive language, store, reload, and find the
 * value there with the active version byte-identical.
 *
 * Run with: node --test tests/version-text-write.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');
const { createVersionTextWriter } =
  await import('../client/views/editor/version-text.js');
const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');
const { normalizeI18n } =
  await import('../server/storage/presentations/i18n.js');
const { pickVersion } = await import('../shared/i18n-progress.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

const normalizeLang = (l) => (l === 'nl' || l === 'en-GB' ? l : null);

const listSlide = (title, items) => ({
  id: 's1',
  type: 'list-slide',
  notes: '',
  content: { title, items },
});

/** A bilingual deck, edited in Dutch; the English list is half translated. */
function bilingualPres() {
  const nl = [
    listSlide('Waarom', [
      { title: 'Snel', text: 'Binnen een dag' },
      { title: 'Open', text: 'Broncode op GitHub' },
    ]),
  ];
  return {
    id: 'p1',
    title: 'Deck',
    lang: 'nl',
    theme: 'default',
    visibility: 'private',
    revision: 1,
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Deck', slides: nl },
        'en-GB': {
          title: '',
          slides: [
            listSlide('', [
              { title: 'Fast', text: '' },
              { title: '', text: '' },
            ]),
          ],
        },
      },
    },
  };
}

const json = (v) => JSON.stringify(v);

// ── collab ────────────────────────────────────────────────────────────────

/** An editor-like collab client: doc, pres, binder and the write seam. */
function collabClient(doc, pres) {
  const codec = createDeckYdocCodec(Y);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => normalizeLang(pres.i18n.active),
  });
  binder.attach();
  let edits = 0;
  const write = createVersionTextWriter({
    pres,
    normalizeLang,
    markDirty: () => {
      edits += 1;
      binder.syncLocal();
    },
    liveEditsActive: true,
    getLiveEdits: () => ({ writeVersionText: binder.writeVersionText }),
  });
  return { codec, binder, write, edits: () => edits };
}

test('collab: a top-level and an item text land in the inactive version only', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  const { codec, binder, write, edits } = collabClient(doc, pres);
  const nlBefore = json(codec.projectDocToPresentation(doc).i18n.versions.nl);
  const presBefore = json(pres.slides);

  assert.equal(write('en-GB', 's1', ['title'], 'Why'), true);
  assert.equal(write('en-GB', 's1', ['items', 1, 'title'], 'Open'), true);
  assert.equal(write('en-GB', null, ['title'], 'Deck EN'), true);
  assert.equal(edits(), 0, 'an inactive write does not go through markDirty');

  // Reload: what the server persists is the doc's projection, and a fresh
  // doc from its state is what the next editor opens.
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc));
  const stored = codec.projectDocToPresentation(fresh);
  const en = stored.i18n.versions['en-GB'];
  assert.equal(en.title, 'Deck EN');
  assert.equal(en.slides[0].content.title, 'Why');
  assert.equal(en.slides[0].content.items[1].title, 'Open');
  assert.equal(en.slides[0].content.items[0].title, 'Fast', 'neighbour kept');
  assert.equal(
    json(stored.i18n.versions.nl),
    nlBefore,
    'the active version is byte-identical',
  );
  assert.equal(json(pres.slides), presBefore, 'pres (active) is untouched');

  // The local buffer shows it at once.
  const buf = pres.i18n.versions['en-GB'];
  assert.equal(buf.title, 'Deck EN');
  assert.equal(buf.slides[0].content.items[1].title, 'Open');
  binder.detach();
});

test('collab: the write survives a re-projection of the version buffers', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  docA.on(
    'update',
    (u, origin) => origin !== 'peer' && Y.applyUpdate(docB, u, 'peer'),
  );
  docB.on(
    'update',
    (u, origin) => origin !== 'peer' && Y.applyUpdate(docA, u, 'peer'),
  );
  const presA = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(presA, docA);
  const a = collabClient(docA, presA);
  const presB = bilingualPres();
  const b = collabClient(docB, presB);

  assert.equal(
    a.write('en-GB', 's1', ['items', 1, 'text'], 'Source on GitHub'),
    true,
  );

  // A collaborator adds a slide: a structural change, so A re-projects every
  // version buffer from the doc (`refreshVersionBuffers`).
  presB.slides.push({
    id: 's2',
    type: 'list-slide',
    notes: '',
    content: { title: 'Nieuw', items: [] },
  });
  b.binder.syncLocal();
  assert.equal(presA.slides.length, 2, 'the remote slide reached A');
  assert.equal(
    presA.i18n.versions['en-GB'].slides[0].content.items[1].text,
    'Source on GitHub',
    'the re-projection keeps the written text',
  );

  // A collaborator types into the same slide: the per-slide re-projection.
  presB.slides[0].content.title = 'Waarom wij';
  b.binder.syncLocal();
  assert.equal(presA.slides[0].content.title, 'Waarom wij');
  assert.equal(
    presA.i18n.versions['en-GB'].slides[0].content.items[1].text,
    'Source on GitHub',
  );
  // And the collaborator sees the translation in their own buffer.
  assert.equal(
    presB.i18n.versions['en-GB'].slides[0].content.items[1].text,
    'Source on GitHub',
  );
  a.binder.detach();
  b.binder.detach();
});

test('collab: undo reverts an inactive write', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  const { codec, binder, write } = collabClient(doc, pres);
  write('en-GB', 's1', ['title'], 'Why');
  assert.equal(binder.canUndo(), true);
  binder.undo();
  const en = codec.projectDocToPresentation(doc).i18n.versions['en-GB'];
  assert.equal(en.slides[0].content.title, '');
  assert.equal(pres.i18n.versions['en-GB'].slides[0].content.title, '');
  binder.detach();
});

test('collab: the active column goes through pres and markDirty', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  const { codec, binder, write, edits } = collabClient(doc, pres);
  assert.equal(write('nl', 's1', ['items', 0, 'text'], 'Binnen een uur'), true);
  assert.equal(edits(), 1);
  const out = codec.projectDocToPresentation(doc).i18n.versions;
  assert.equal(out.nl.slides[0].content.items[0].text, 'Binnen een uur');
  assert.equal(out['en-GB'].slides[0].content.items[0].text, '');
  binder.detach();
});

test('collab: refuses what is not an existing text address', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  const { binder, write } = collabClient(doc, pres);
  const before = json(Y.encodeStateVector(doc));
  assert.equal(
    binder.writeVersionText('nl', 's1', ['title'], 'x'),
    false,
    'active',
  );
  assert.equal(
    write('de', 's1', ['title'], 'x'),
    false,
    'a language the deck lacks',
  );
  assert.equal(write('en-GB', 'nope', ['title'], 'x'), false, 'unknown slide');
  assert.equal(write('en-GB', 's1', ['items'], 'x'), false, 'an items array');
  assert.equal(
    write('en-GB', 's1', ['items', 5, 'title'], 'x'),
    false,
    'no item 5',
  );
  assert.equal(write('en-GB', 's1', ['title'], 3), false, 'not a string');
  assert.equal(json(Y.encodeStateVector(doc)), before, 'the doc is unchanged');
  binder.detach();
});

// ── legacy ────────────────────────────────────────────────────────────────

/**
 * An editor-like legacy client: pres, save manager and the write seam, over
 * a fake PUT that stores what the server would (`normalizeI18n`).
 */
function legacyClient(pres) {
  const server = { stored: null, headers: null };
  const api = async (_path, opts) => {
    server.headers = opts.headers;
    const body = structuredClone(opts.body);
    normalizeI18n(body);
    body.revision = Number(opts.headers['If-Match']) + 1;
    server.stored = body;
    return structuredClone(body);
  };
  const saveManager = createSaveManager({
    api,
    toast: { info() {}, success() {}, error() {} },
    pres,
    id: pres.id,
    SLIDE_TYPES,
    normalizeLang,
    getSelectedSlideId: () => 's1',
  });
  const marks = [];
  const write = createVersionTextWriter({
    pres,
    normalizeLang,
    markDirty: (opts) => {
      marks.push(opts);
      saveManager.markDirty(opts);
    },
    syncVersionStructure: saveManager.syncVersionStructure,
  });
  return { server, saveManager, write, marks };
}

test('legacy: a top-level and an item text land in the inactive version only', async () => {
  const pres = bilingualPres();
  const { server, saveManager, write, marks } = legacyClient(pres);
  // What the server stores for the Dutch version without the writes.
  const control = structuredClone(pres);
  normalizeI18n(control);
  const nlBefore = json(pickVersion(control, 'nl'));

  assert.equal(write('en-GB', 's1', ['title'], 'Why'), true);
  assert.equal(write('en-GB', 's1', ['items', 1, 'title'], 'Open'), true);
  assert.equal(write('en-GB', null, ['title'], 'Deck EN'), true);
  assert.ok(
    marks.every((m) => m.noActiveSlide),
    'no active slide claimed',
  );
  assert.equal(saveManager.isDirty(), true);

  await saveManager.requestSave();
  saveManager.cancelAutosave();
  assert.equal(
    server.headers['X-Modified-Slides'],
    undefined,
    'the slide-level merge is not told an active slide changed',
  );

  // Reload: the editor opens a version from the stored deck.
  const en = pickVersion(server.stored, 'en-GB');
  assert.equal(en.title, 'Deck EN');
  assert.equal(en.slides[0].content.title, 'Why');
  assert.equal(en.slides[0].content.items[1].title, 'Open');
  assert.equal(en.slides[0].content.items[0].title, 'Fast', 'neighbour kept');
  assert.equal(
    json(pickVersion(server.stored, 'nl')),
    nlBefore,
    'the active version is byte-identical',
  );
});

test('legacy: a version that lags the active structure is mirrored first', async () => {
  const pres = bilingualPres();
  const { server, saveManager, write } = legacyClient(pres);
  // An item and a slide added in Dutch, not saved yet: the English version
  // does not have them.
  pres.slides[0].content.items.push({ title: 'Vrij', text: 'Geen lock-in' });
  pres.slides.push(listSlide('Hoe', []));
  pres.slides[1].id = 's2';

  assert.equal(write('en-GB', 's1', ['items', 2, 'title'], 'Free'), true);
  assert.equal(write('en-GB', 's2', ['title'], 'How'), true);

  await saveManager.requestSave();
  saveManager.cancelAutosave();
  const en = pickVersion(server.stored, 'en-GB');
  assert.equal(en.slides[0].content.items[2].title, 'Free');
  assert.equal(en.slides[0].content.items[2].text, '', 'no Dutch copied over');
  assert.equal(en.slides[1].content.title, 'How');
  assert.equal(pickVersion(server.stored, 'nl').slides[1].content.title, 'Hoe');
});

test('legacy: the active column writes pres and claims its slide', async () => {
  const pres = bilingualPres();
  const { server, saveManager, write, marks } = legacyClient(pres);
  assert.equal(write('nl', 's1', ['items', 0, 'title'], 'Snel genoeg'), true);
  assert.deepEqual(marks, [{ slideId: 's1', action: 'edit' }]);
  assert.equal(pres.slides[0].content.items[0].title, 'Snel genoeg');
  await saveManager.requestSave();
  saveManager.cancelAutosave();
  assert.equal(server.headers['X-Modified-Slides'], JSON.stringify(['s1']));
  assert.equal(
    pickVersion(server.stored, 'en-GB').slides[0].content.items[0].title,
    'Fast',
  );
});

test('legacy: refuses what is not an existing text address', () => {
  const pres = bilingualPres();
  const { write, marks } = legacyClient(pres);
  const before = json(pres);
  assert.equal(
    write('de', 's1', ['title'], 'x'),
    false,
    'a language the deck lacks',
  );
  assert.equal(write('en-GB', 'nope', ['title'], 'x'), false, 'unknown slide');
  assert.equal(write('en-GB', 's1', ['items'], 'x'), false, 'an items array');
  assert.equal(
    write('en-GB', 's1', ['items', 5, 'title'], 'x'),
    false,
    'no item 5',
  );
  assert.equal(marks.length, 0);
  assert.equal(json(pres), before);
});

test('collab: inactive deck titles follow peer writes, undo and redo', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  const a = collabClient(doc, pres);
  const peer = bilingualPres();
  const b = collabClient(doc, peer);
  const before = json(pres.slides);
  a.write('en-GB', null, ['title'], 'English deck');
  assert.equal(peer.i18n.versions['en-GB'].title, 'English deck');
  a.binder.undo();
  assert.equal(pres.i18n.versions['en-GB'].title, '');
  assert.equal(peer.i18n.versions['en-GB'].title, '');
  a.binder.redo();
  assert.equal(pres.i18n.versions['en-GB'].title, 'English deck');
  assert.equal(peer.i18n.versions['en-GB'].title, 'English deck');
  assert.equal(pres.title, 'Deck');
  assert.equal(json(pres.slides), before);
  a.binder.detach();
  b.binder.detach();
});

test('legacy: mixed-language saves require the exact revision, then resume slide merging', async () => {
  const pres = bilingualPres();
  const { server, saveManager, write } = legacyClient(pres);
  write('nl', 's1', ['title'], 'Waarom wij');
  write('en-GB', 's1', ['title'], 'Why us');
  await saveManager.requestSave();
  assert.equal(server.headers['If-Match'], '1');
  assert.equal(server.headers['X-Modified-Slides'], undefined);
  assert.equal(
    server.stored.i18n.versions['en-GB'].slides[0].content.title,
    'Why us',
  );
  write('nl', 's1', ['title'], 'Waarom nu');
  await saveManager.requestSave();
  saveManager.cancelAutosave();
  assert.equal(server.headers['X-Modified-Slides'], JSON.stringify(['s1']));
});

test('collab: promoting a plain text preserves the other language', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  createDeckYdocCodec(Y).bootstrapPresentationToDoc(pres, doc);
  doc.getArray('slides').get(0).get('content').set('title', 'Shared old text');
  const { binder, codec, write } = collabClient(doc, pres);
  const before = json(codec.projectDocToPresentation(doc).i18n.versions.nl);
  assert.equal(write('en-GB', 's1', ['title'], 'English text'), true);
  const versions = codec.projectDocToPresentation(doc).i18n.versions;
  assert.equal(json(versions.nl), before);
  assert.equal(versions['en-GB'].slides[0].content.title, 'English text');
  binder.detach();
});

const { translationFieldKey, translationSource, translationFieldStatus } =
  await import('../shared/translation-provenance.js');

for (const mode of ['legacy', 'collab']) {
  for (const target of ['en-GB', 'nl']) {
    test(`${mode}: provenance for ${target} survives save and a normal source edit makes it stale`, () => {
      const pres = bilingualPres();
      const from = target === 'nl' ? 'en-GB' : 'nl';
      const doc = new Y.Doc();
      const codec = createDeckYdocCodec(Y);
      codec.bootstrapPresentationToDoc(pres, doc);
      const client = mode === 'collab' ? collabClient(doc, pres) : null;
      const write =
        client?.write ||
        createVersionTextWriter({ pres, normalizeLang, markDirty: () => {} });
      const path = ['items', 0, 'title'];
      const key = translationFieldKey('s1', path);
      const beforeSource = from === 'nl' ? 'Snel' : 'Fast';
      assert.ok(
        write(target, 's1', path, 'Accepted text', { sourceLang: from }),
      );
      const saved =
        mode === 'collab'
          ? codec.projectDocToPresentation(doc)
          : structuredClone(pres);
      normalizeI18n(saved);
      assert.deepEqual(
        saved.i18n.versions[target].translationSources[key],
        translationSource(from, beforeSource),
      );
      assert.equal(
        translationFieldStatus(
          { source: beforeSource, target: 'Accepted text' },
          from,
          saved.i18n.versions[target].translationSources[key],
        ),
        'current',
      );
      // An ordinary editor edit passes no source: existing provenance stays.
      assert.ok(write(from, 's1', path, 'Changed source'));
      assert.equal(
        translationFieldStatus(
          { source: 'Changed source', target: 'Accepted text' },
          from,
          pres.i18n.versions[target].translationSources[key],
        ),
        'changed',
      );
      if (client) client.binder.detach();
    });
  }
}

test('collab: text and provenance undo/redo together, including after peer re-projection', () => {
  const doc = new Y.Doc();
  const pres = bilingualPres();
  const codec = createDeckYdocCodec(Y);
  codec.bootstrapPresentationToDoc(pres, doc);
  const { binder, write } = collabClient(doc, pres);
  const key = translationFieldKey('s1', ['title']);
  write('en-GB', 's1', ['title'], 'Why', { sourceLang: 'nl' });
  assert.ok(pres.i18n.versions['en-GB'].translationSources[key]);
  binder.undo();
  assert.equal(pres.i18n.versions['en-GB'].slides[0].content.title, '');
  assert.equal(pres.i18n.versions['en-GB'].translationSources, undefined);
  binder.redo();
  assert.equal(pres.i18n.versions['en-GB'].slides[0].content.title, 'Why');
  assert.deepEqual(
    pres.i18n.versions['en-GB'].translationSources[key],
    translationSource('nl', 'Waarom'),
  );
  // A server diff of unrelated text cannot erase a concurrent source record.
  const base = codec.projectDocToPresentation(doc);
  const changed = structuredClone(base);
  changed.i18n.versions.nl.title = 'New deck title';
  const peerKey = translationFieldKey('s1', ['items', 1, 'title']);
  doc.transact(
    () =>
      codec.writeTranslationSource(
        doc,
        'en-GB',
        peerKey,
        translationSource('nl', 'Open'),
      ),
    'peer',
  );
  codec.applyPresentationToDoc(changed, doc, { base });
  assert.deepEqual(
    codec.projectDocToPresentation(doc).i18n.versions['en-GB']
      .translationSources[peerKey],
    translationSource('nl', 'Open'),
  );
  binder.detach();
});
