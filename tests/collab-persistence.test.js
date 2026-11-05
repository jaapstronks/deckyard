/**
 * Tests for collab Y.Doc persistence (phase 2, step 2): the Y.Doc state
 * facade, the Hocuspocus onLoadDocument/onStoreDocument hooks, and
 * cold-binary invalidation when a deck is saved outside the collab doc.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js), the
 * only storage backend there is.
 *
 * Run with: node --test tests/collab-persistence.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import * as Y from 'yjs';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { deckYdocCodec } from '../server/collab/deck-doc.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { getYDocState, setYDocState, deleteYDocState } =
  await import('../server/storage/presentations/ydocs.js');
const { createPresentation, getPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { holdBackRefusedSlideFields } =
  await import('../server/services/slide-field-validation.js');

// The collab hooks still take a `repoRoot` for their scope shape; storage
// ignores it entirely now that PostgreSQL is the only backend.
const REPO_ROOT = process.cwd();

__setTestDb(
  createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  }),
);
await initializeStorage();

// `closeStorage()` would call `db.destroy()`, which the in-memory double does
// not have — drop the adapter singleton instead, the seam meant for exactly
// this (server/db/lifecycle.js).
after(() => {
  __setTestDb(null);
});

function stripVolatile(pres) {
  const p = JSON.parse(JSON.stringify(pres));
  if (p.i18n) delete p.i18n.progress;
  delete p.modified;
  delete p.revision;
  return p;
}

function docName(id) {
  return `presentation:${id}`;
}

/** Collect log lines instead of spamming the test output. */
function makeLog() {
  const lines = { warn: [], error: [] };
  return {
    lines,
    warn: (...args) => lines.warn.push(args.join(' ')),
    error: (...args) => lines.error.push(args.join(' ')),
  };
}

describe('ydoc-state facade', () => {
  let deckId;

  before(async () => {
    const created = await createPresentation(testScope(), {
      title: 'Ydoc state deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });

  it('set/get/delete round-trip', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    assert.equal(await getYDocState(testScope(), deckId), null);
    assert.equal(await setYDocState(testScope(), deckId, bytes), true);
    assert.deepEqual(await getYDocState(testScope(), deckId), bytes);
    assert.equal(await deleteYDocState(testScope(), deckId), true);
    assert.equal(await getYDocState(testScope(), deckId), null);
  });
});

describe('collab persistence hooks', () => {
  let deckId;
  let log;
  let hooks;

  before(async () => {
    const created = await createPresentation(testScope(), {
      title: 'Persistente deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });
  beforeEach(() => {
    log = makeLog();
    hooks = createCollabPersistence({ repoRoot: REPO_ROOT, deps: { log } });
  });

  it('first open bootstraps the doc from the deck JSON and persists the binary', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const stored = await getPresentation(testScope(), deckId);
    assert.deepStrictEqual(
      stripVolatile(deckYdocCodec.projectDocToPresentation(doc)),
      stripVolatile(stored),
    );

    const bin = await getYDocState(testScope(), deckId);
    assert.ok(
      bin instanceof Uint8Array && bin.length > 0,
      'bootstrap binary persisted',
    );
  });

  it('a stored pre-provenance doc gets one shared empty container before peers connect', async () => {
    const old = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: old,
    });
    old.getMap('meta').delete('translationSources');
    await setYDocState(testScope(), deckId, Y.encodeStateAsUpdate(old));
    const loaded = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: loaded,
    });
    assert.ok(loaded.getMap('meta').get('translationSources') instanceof Y.Map);
    assert.equal(loaded.getMap('meta').get('translationSources').size, 0);
    const projected = deckYdocCodec.projectDocToPresentation(loaded);
    for (const version of Object.values(projected.i18n?.versions || {}))
      assert.equal(version.translationSources, undefined);
  });

  it('later opens load the binary instead of re-bootstrapping', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });

    // Edit the live doc + store, then open a second doc: it must see the edit.
    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, ' (bewerkt)');
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const doc2 = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc2,
    });
    assert.match(
      doc2.getMap('meta').get('title').get('nl').toString(),
      / \(bewerkt\)$/,
    );
  });

  it('onStoreDocument serializes the doc back to the deck JSON via the facade', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    const before = await getPresentation(testScope(), deckId);

    const title = doc.getMap('meta').get('title').get('nl');
    title.delete(0, title.length);
    title.insert(0, 'Live bewerkt');
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });

    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.title, 'Live bewerkt');
    assert.equal(
      afterJson.revision,
      before.revision + 1,
      'revision bumped by the facade',
    );
    assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
  });

  it('keeps the binary and leaves the JSON untouched when serialization fails', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    const before = await getPresentation(testScope(), deckId);

    const failing = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: {
        log,
        updatePresentation: async () => {
          throw new Error('validation exploded');
        },
      },
    });

    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, '!!!');
    await assert.doesNotReject(
      failing.onStoreDocument({ documentName: docName(deckId), document: doc }),
    );

    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.title, before.title, 'JSON not clobbered');
    assert.equal(afterJson.revision, before.revision, 'JSON untouched');
    assert.equal(log.lines.error.length, 1);
    assert.match(log.lines.error[0], /JSON left as-is/);

    // The binary DID advance: a reload sees the unserialized edit.
    const doc2 = new Y.Doc();
    await failing.onLoadDocument({
      documentName: docName(deckId),
      document: doc2,
    });
    assert.match(doc2.getMap('meta').get('title').get('nl').toString(), /!!!$/);
  });

  describe('field validation on the store (DY-813)', () => {
    /** A deck with one end slide, open in a doc, and a way to edit that slide. */
    async function openEndSlide(others = []) {
      const { id } = await createPresentation(testScope(), {
        title: 'Eindslide',
        ownerEmail: 'owner@example.com',
        lang: 'nl',
      });
      const stored = await getPresentation(testScope(), id);
      const slide = {
        id: 'end-1',
        type: 'end-slide',
        content: { title: 'Bedankt', contactUrl: 'https://example.com/' },
      };
      await updatePresentation(testScope(), id, {
        ...stored,
        slides: [slide, ...others],
        i18n: {
          ...stored.i18n,
          versions: {
            ...stored.i18n?.versions,
            nl: { ...stored.i18n?.versions?.nl, slides: [slide, ...others] },
          },
        },
      });
      const doc = new Y.Doc();
      await hooks.onLoadDocument({ documentName: docName(id), document: doc });
      const edit = async (fields, index = 0) => {
        const base = deckYdocCodec.projectDocToPresentation(doc);
        const next = structuredClone(base);
        Object.assign(next.slides[index].content, fields);
        const version = next.i18n?.versions?.nl?.slides?.[index];
        if (version) Object.assign(version.content, fields);
        deckYdocCodec.applyPresentationToDoc(next, doc, { base });
        await hooks.onStoreDocument({
          documentName: docName(id),
          document: doc,
        });
      };
      return { id, doc, edit };
    }
    const storedContent = async (id, index = 0) =>
      (await getPresentation(testScope(), id)).slides[index].content;
    const OTHER_SLIDE = {
      id: 'other-1',
      type: 'end-slide',
      content: { title: 'Oud' },
    };

    it('a javascript: link stays out of the JSON, the binary keeps the work, a fix lands', async () => {
      const { id, doc, edit } = await openEndSlide();

      await edit({ contactUrl: 'javascript:alert(1)' });

      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
      assert.deepEqual(
        await getYDocState(testScope(), id),
        Y.encodeStateAsUpdate(doc),
        'the binary holds the refused state, so nothing typed is lost',
      );
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
      assert.equal(log.lines.warn.length, 1);
      assert.match(log.lines.warn[0], /contactUrl/);
      assert.doesNotMatch(log.lines.warn[0], /alert\(1\)/);

      await edit({ contactUrl: 'https://example.org/' });

      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.org/',
      );
    });

    it('an old bad link on a slide nobody touches does not hold back other edits', async () => {
      const { id, edit } = await openEndSlide([
        {
          id: 'end-2',
          type: 'end-slide',
          content: { title: 'Oud', contactUrl: 'example.com' },
        },
      ]);

      await edit({ title: 'Nieuw' });

      assert.equal((await storedContent(id)).title, 'Nieuw');
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
    });

    it('an edit on another slide lands while one field is refused', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ contactUrl: 'www.example.com' });
      await edit({ title: 'Een uur werk' }, 1);

      assert.equal((await storedContent(id, 1)).title, 'Een uur werk');
      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
      const stored = await getPresentation(testScope(), id);
      assert.deepEqual(
        stored.i18n.versions.nl.slides,
        stored.slides,
        'the language version gets the same held-back slides',
      );
    });

    it('another field on the same slide lands beside the refused one', async () => {
      const { id, edit } = await openEndSlide();

      await edit({ contactUrl: 'www.example.com', title: 'Nieuw' });

      const content = await storedContent(id);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, 'https://example.com/');
    });

    it('a write from outside the doc afterwards loses at most the refused field', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);
      await edit({ contactUrl: 'www.example.com' });
      await edit({ title: 'Een uur werk' }, 1);

      const cold = await getPresentation(testScope(), id);
      await updatePresentation(testScope(), id, { ...cold, title: 'Hernoemd' });
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(await getYDocState(testScope(), id), null);
      assert.equal((await storedContent(id, 1)).title, 'Een uur werk');
      assert.equal(
        (await storedContent(id)).contactUrl,
        'https://example.com/',
      );
    });

    it('a title that is too long holds back only that title', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ title: 'x'.repeat(130) });
      await edit({ title: 'Later werk' }, 1);

      assert.equal((await storedContent(id)).title, 'Bedankt');
      assert.equal((await storedContent(id, 1)).title, 'Later werk');
    });

    it('a half-typed e-mail address holds back only that address', async () => {
      const { id, edit } = await openEndSlide([OTHER_SLIDE]);

      await edit({ contactEmail: 'jaap@' });
      await edit({ title: 'Later werk' }, 1);

      assert.equal((await storedContent(id)).contactEmail, undefined);
      assert.equal((await storedContent(id, 1)).title, 'Later werk');
    });

    it('a new slide is stored without its refused field', async () => {
      const { id, doc } = await openEndSlide();
      const base = deckYdocCodec.projectDocToPresentation(doc);
      const next = structuredClone(base);
      const added = {
        id: 'new-1',
        type: 'end-slide',
        content: { title: 'Nieuw', contactUrl: 'javascript:alert(1)' },
        notes: '',
      };
      next.slides.push(added);
      next.i18n.versions.nl.slides.push(structuredClone(added));
      deckYdocCodec.applyPresentationToDoc(next, doc, { base });

      await hooks.onStoreDocument({ documentName: docName(id), document: doc });

      const content = await storedContent(id, 1);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, undefined);
    });

    it('a store that changes only a refused field writes nothing and logs once', async () => {
      const { id, doc, edit } = await openEndSlide([OTHER_SLIDE]);
      await edit({ title: 'Eerst iets echts' }, 1);
      const before = await getPresentation(testScope(), id);

      await edit({ contactUrl: 'www.example.com' });
      await hooks.onStoreDocument({ documentName: docName(id), document: doc });
      await hooks.onStoreDocument({ documentName: docName(id), document: doc });

      const stored = await getPresentation(testScope(), id);
      assert.equal(stored.revision, before.revision, 'no revision bump');
      assert.equal(log.lines.warn.length, 1, log.lines.warn.join('\n'));
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));

      await edit({ contactUrl: 'www.example.org' });
      assert.equal(log.lines.warn.length, 2, 'a new value gets its own line');
    });

    it('an old bad value on a slide someone edits stops nothing and logs nothing', async () => {
      const { id, edit } = await openEndSlide([
        {
          id: 'end-2',
          type: 'end-slide',
          content: { title: 'Oud', contactUrl: 'example.com' },
        },
      ]);

      await edit({ title: 'Nieuw' }, 1);

      const content = await storedContent(id, 1);
      assert.equal(content.title, 'Nieuw');
      assert.equal(content.contactUrl, 'example.com');
      assert.equal(log.lines.warn.length, 0, log.lines.warn.join('\n'));
    });

    it('holds a value back in every language version and reports it per version', async () => {
      const slide = (title, contactUrl) => ({
        id: 'end-1',
        type: 'end-slide',
        content: { title, contactUrl },
      });
      const deck = (nl, en) => ({
        slides: [nl],
        i18n: {
          active: 'nl',
          dominant: 'nl',
          versions: { nl: { slides: [nl] }, 'en-GB': { slides: [en] } },
        },
      });
      const stored = deck(
        slide('Bedankt', 'https://example.com/'),
        slide('Thanks', 'https://example.com/'),
      );

      const { deck: written, refused } = await holdBackRefusedSlideFields(
        testScope(),
        stored,
        deck(
          slide('Bedankt', 'javascript:alert(1)'),
          slide('Thank you', 'javascript:alert(1)'),
        ),
      );

      assert.equal(
        written.slides[0].content.contactUrl,
        'https://example.com/',
      );
      assert.equal(
        written.i18n.versions.nl.slides[0],
        written.slides[0],
        'the active version is the top-level buffer',
      );
      const en = written.i18n.versions['en-GB'].slides[0].content;
      assert.equal(en.contactUrl, 'https://example.com/');
      assert.equal(en.title, 'Thank you');
      assert.equal(refused.length, 2);
    });

    it('a slide whose type changed does not get the stored value of its old type', async () => {
      const stored = {
        slides: [
          {
            id: 's1',
            type: 'content-slide',
            content: { title: 'Oud', contactUrl: 'https://example.com/' },
          },
        ],
      };
      const { deck: written } = await holdBackRefusedSlideFields(
        testScope(),
        stored,
        {
          slides: [
            {
              id: 's1',
              type: 'end-slide',
              content: { title: 'Nieuw', contactUrl: 'javascript:alert(1)' },
            },
          ],
        },
      );
      assert.equal(written.slides[0].content.title, 'Nieuw');
      assert.equal('contactUrl' in written.slides[0].content, false);
    });

    it('an empty required field on its way to a new value is not a refusal', async () => {
      const { id, edit } = await openEndSlide();

      await edit({ title: '' });

      assert.equal((await storedContent(id)).title, '');
      assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
    });
  });

  it('never stores an unpopulated doc over a real deck', async () => {
    const before = await getPresentation(testScope(), deckId);
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: new Y.Doc(),
    });
    const afterJson = await getPresentation(testScope(), deckId);
    assert.equal(afterJson.revision, before.revision);
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /no deck state/);
  });

  it('logs bootstrap warnings loudly when language versions had diverged', async () => {
    const diverged = await createPresentation(testScope(), {
      title: 'Divergent deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    const pres = await getPresentation(testScope(), diverged.id);
    pres.i18n = {
      dominant: 'nl',
      versions: {
        nl: { title: pres.title, slides: pres.slides },
        'en-GB': {
          title: 'Diverged deck',
          slides: [
            ...JSON.parse(JSON.stringify(pres.slides)),
            {
              id: 'ghost-slide',
              type: 'quote-slide',
              content: { quote: 'boo' },
              notes: '',
            },
          ],
        },
      },
    };
    await updatePresentation(testScope(), diverged.id, pres);

    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(diverged.id),
      document: doc,
    });
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /normalized diverged language versions/);
    assert.match(log.lines.warn[0], /ghost-slide/);
  });
});

describe('cold-binary invalidation on non-collab saves', () => {
  let deckId;
  const envBefore = {};

  before(async () => {
    for (const k of ['COLLAB_ENABLED', 'COLLAB_LIVE_EDITS'])
      envBefore[k] = process.env[k];
    process.env.COLLAB_ENABLED = 'true';
    process.env.COLLAB_LIVE_EDITS = 'true';
    const created = await createPresentation(testScope(), {
      title: 'Invalidate me',
      ownerEmail: 'owner@example.com',
    });
    deckId = created.id;
  });
  after(() => {
    for (const [k, v] of Object.entries(envBefore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('a REST/MCP-style save deletes the stored doc binary', async () => {
    const hooks = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: { log: makeLog() },
    });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    assert.ok(
      await getYDocState(testScope(), deckId),
      'binary exists after collab open',
    );

    const pres = await getPresentation(testScope(), deckId);
    await updatePresentation(testScope(), deckId, {
      ...pres,
      title: 'Edited via REST',
    });
    // The invalidation is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      await getYDocState(testScope(), deckId),
      null,
      'binary invalidated',
    );
  });

  it('invalidation also fires while the flag is off (no resurrection after re-enable)', async () => {
    // A binary written while COLLAB_LIVE_EDITS was on must not survive saves
    // made while it is off — re-enabling the flag would resurrect stale state.
    delete process.env.COLLAB_ENABLED;
    delete process.env.COLLAB_LIVE_EDITS;
    try {
      await setYDocState(testScope(), deckId, new Uint8Array([1, 2, 3]));
      const pres = await getPresentation(testScope(), deckId);
      await updatePresentation(testScope(), deckId, {
        ...pres,
        title: 'Saved while flag off',
      });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        await getYDocState(testScope(), deckId),
        null,
        'binary invalidated',
      );
    } finally {
      process.env.COLLAB_ENABLED = 'true';
      process.env.COLLAB_LIVE_EDITS = 'true';
    }
  });

  it('a collab-originated save keeps the binary', async () => {
    const hooks = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: { log: makeLog() },
    });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    await hooks.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(
      await getYDocState(testScope(), deckId),
      'binary survives collab save',
    );
  });
});
