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
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { getYDocState, setYDocState, deleteYDocState } =
  await import('../server/storage/presentations/ydocs.js');
const { createPresentation, getPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');

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
// this (server/storage/lifecycle.js).
after(() => {
  __resetStorageForTests();
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
