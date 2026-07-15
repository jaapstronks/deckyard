/**
 * Tests for collab Y.Doc persistence (phase 2, step 2): file-backend ydoc
 * state storage, the Hocuspocus onLoadDocument/onStoreDocument hooks, and
 * cold-binary invalidation when a deck is saved outside the collab doc.
 *
 * Uses file-mode storage in a temp repoRoot (same approach as the authz
 * integration tests).
 *
 * Run with: node --test tests/collab-persistence.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as Y from 'yjs';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { deckYdocCodec } from '../server/collab/deck-doc.js';
import {
  getYDocState,
  setYDocState,
  deleteYDocState,
} from '../server/storage/presentations/ydoc-state.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';

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

describe('ydoc-state file backend', () => {
  let tempRoot;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ydoc-state-test-'));
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('set/get/delete round-trip', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    assert.equal(await getYDocState(tempRoot, 'abc-123'), null);
    assert.equal(await setYDocState(tempRoot, 'abc-123', bytes), true);
    assert.deepEqual(await getYDocState(tempRoot, 'abc-123'), bytes);
    assert.equal(await deleteYDocState(tempRoot, 'abc-123'), true);
    assert.equal(await getYDocState(tempRoot, 'abc-123'), null);
  });

  it('refuses path-traversal ids', async () => {
    assert.equal(await setYDocState(tempRoot, '../evil', new Uint8Array([1])), false);
    assert.equal(await getYDocState(tempRoot, '../evil'), null);
  });
});

describe('collab persistence hooks (file-mode storage)', () => {
  let tempRoot;
  let deckId;
  let log;
  let hooks;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-persist-test-'));
    const created = await createPresentation(tempRoot, {
      title: 'Persistente deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  beforeEach(() => {
    log = makeLog();
    hooks = createCollabPersistence({ repoRoot: tempRoot, deps: { log } });
  });

  it('first open bootstraps the doc from the deck JSON and persists the binary', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });

    const stored = await getPresentation(tempRoot, deckId);
    assert.deepStrictEqual(
      stripVolatile(deckYdocCodec.projectDocToPresentation(doc)),
      stripVolatile(stored)
    );

    const bin = await getYDocState(tempRoot, deckId);
    assert.ok(bin instanceof Uint8Array && bin.length > 0, 'bootstrap binary persisted');
  });

  it('later opens load the binary instead of re-bootstrapping', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });

    // Edit the live doc + store, then open a second doc: it must see the edit.
    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, ' (bewerkt)');
    await hooks.onStoreDocument({ documentName: docName(deckId), document: doc });

    const doc2 = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc2 });
    assert.match(doc2.getMap('meta').get('title').get('nl').toString(), / \(bewerkt\)$/);
  });

  it('onStoreDocument serializes the doc back to the deck JSON via the facade', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });
    const before = await getPresentation(tempRoot, deckId);

    const title = doc.getMap('meta').get('title').get('nl');
    title.delete(0, title.length);
    title.insert(0, 'Live bewerkt');
    await hooks.onStoreDocument({ documentName: docName(deckId), document: doc });

    const afterJson = await getPresentation(tempRoot, deckId);
    assert.equal(afterJson.title, 'Live bewerkt');
    assert.equal(afterJson.revision, before.revision + 1, 'revision bumped by the facade');
    assert.equal(log.lines.error.length, 0, log.lines.error.join('\n'));
  });

  it('keeps the binary and leaves the JSON untouched when serialization fails', async () => {
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });
    const before = await getPresentation(tempRoot, deckId);

    const failing = createCollabPersistence({
      repoRoot: tempRoot,
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
      failing.onStoreDocument({ documentName: docName(deckId), document: doc })
    );

    const after = await getPresentation(tempRoot, deckId);
    assert.equal(after.title, before.title, 'JSON not clobbered');
    assert.equal(after.revision, before.revision, 'JSON untouched');
    assert.equal(log.lines.error.length, 1);
    assert.match(log.lines.error[0], /JSON left as-is/);

    // The binary DID advance: a reload sees the unserialized edit.
    const doc2 = new Y.Doc();
    await failing.onLoadDocument({ documentName: docName(deckId), document: doc2 });
    assert.match(doc2.getMap('meta').get('title').get('nl').toString(), /!!!$/);
  });

  it('never stores an unpopulated doc over a real deck', async () => {
    const before = await getPresentation(tempRoot, deckId);
    await hooks.onStoreDocument({ documentName: docName(deckId), document: new Y.Doc() });
    const after = await getPresentation(tempRoot, deckId);
    assert.equal(after.revision, before.revision);
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /no deck state/);
  });

  it('logs bootstrap warnings loudly when language versions had diverged', async () => {
    const diverged = await createPresentation(tempRoot, {
      title: 'Divergent deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    const pres = await getPresentation(tempRoot, diverged.id);
    pres.i18n = {
      dominant: 'nl',
      versions: {
        nl: { title: pres.title, slides: pres.slides },
        'en-GB': {
          title: 'Diverged deck',
          slides: [
            ...JSON.parse(JSON.stringify(pres.slides)),
            { id: 'ghost-slide', type: 'quote-slide', content: { quote: 'boo' }, notes: '' },
          ],
        },
      },
    };
    await updatePresentation(tempRoot, diverged.id, pres);

    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(diverged.id), document: doc });
    assert.equal(log.lines.warn.length, 1);
    assert.match(log.lines.warn[0], /normalized diverged language versions/);
    assert.match(log.lines.warn[0], /ghost-slide/);
  });
});

describe('cold-binary invalidation on non-collab saves', () => {
  let tempRoot;
  let deckId;
  const envBefore = {};

  before(async () => {
    for (const k of ['COLLAB_ENABLED', 'COLLAB_LIVE_EDITS']) envBefore[k] = process.env[k];
    process.env.COLLAB_ENABLED = 'true';
    process.env.COLLAB_LIVE_EDITS = 'true';
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-invalidate-test-'));
    const created = await createPresentation(tempRoot, {
      title: 'Invalidate me',
      ownerEmail: 'owner@example.com',
    });
    deckId = created.id;
  });
  after(async () => {
    for (const [k, v] of Object.entries(envBefore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('a REST/MCP-style save deletes the stored doc binary', async () => {
    const hooks = createCollabPersistence({ repoRoot: tempRoot, deps: { log: makeLog() } });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });
    assert.ok(await getYDocState(tempRoot, deckId), 'binary exists after collab open');

    const pres = await getPresentation(tempRoot, deckId);
    await updatePresentation(tempRoot, deckId, { ...pres, title: 'Edited via REST' });
    // The invalidation is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await getYDocState(tempRoot, deckId), null, 'binary invalidated');
  });

  it('a collab-originated save keeps the binary', async () => {
    const hooks = createCollabPersistence({ repoRoot: tempRoot, deps: { log: makeLog() } });
    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });
    await hooks.onStoreDocument({ documentName: docName(deckId), document: doc });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(await getYDocState(tempRoot, deckId), 'binary survives collab save');
  });
});
