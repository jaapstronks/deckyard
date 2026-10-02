/**
 * Regression tests for the review blockers fixed on
 * `fix/collab-review-blockers` (against umbrella PR #12):
 *
 *  1. path traversal — `presentationIdFromDocumentName` rejects non-uuid ids
 *     so the doc name can't reach `getPresentation` → `presPath` unsanitized.
 *  2. (retired with the raw-HTML slide type, A7.8b: the capability gate it pinned
 *     left core with the type.)
 *  3. live-apply load race — a server write is applied to a doc that is still
 *     LOADING (in `loadingDocuments`, not yet in `documents`), not dropped as
 *     a cold write.
 *  4. binary-store failure — `onStoreDocument` does NOT write the JSON when
 *     the binary store failed (keeps binary/JSON consistent).
 *
 * Run with: node --test tests/collab-review-fixes.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

import * as Y from 'yjs';
import {
  presentationIdFromDocumentName,
  COLLAB_DOC_PREFIX,
} from '../server/collab/auth.js';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { applyServerWriteToActiveDoc } from '../server/collab/live-apply.js';
import { testScope } from './helpers/storage-scope.js';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, getPresentation } =
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
// not have — drop the adapter singleton instead.
after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

function makeLog() {
  const lines = { warn: [], error: [] };
  return {
    lines,
    warn: (...a) => lines.warn.push(a.join(' ')),
    error: (...a) => lines.error.push(a.join(' ')),
  };
}

const docName = (id) => `${COLLAB_DOC_PREFIX}${id}`;

// ── 1. path traversal ───────────────────────────────────────────────────────

describe('presentationIdFromDocumentName: charset guard (traversal)', () => {
  it('accepts real uuid-shaped ids', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    assert.equal(presentationIdFromDocumentName(docName(id)), id);
  });

  it('rejects path-traversal and separators', () => {
    for (const bad of [
      '../../../../etc/passwd',
      '..%2f..%2fsecret',
      'foo/bar',
      'foo.bar',
      'foo bar',
      '..',
      '.',
      '',
    ]) {
      assert.equal(
        presentationIdFromDocumentName(docName(bad)),
        null,
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });

  it('rejects names without the collab prefix', () => {
    assert.equal(presentationIdFromDocumentName('other:abc'), null);
    assert.equal(presentationIdFromDocumentName('abc'), null);
  });
});

// ── 3. live-apply load race ─────────────────────────────────────────────────

describe('applyServerWriteToActiveDoc: treats loading docs as active', () => {
  function fakeDoc() {
    return { getMap: () => ({ get: () => ({}) }) }; // meta.extra defined
  }
  function fakeHocuspocus({
    documents = new Map(),
    loadingDocuments = new Map(),
  } = {}) {
    let opened = 0;
    return {
      documents,
      loadingDocuments,
      get opened() {
        return opened;
      },
      async openDirectConnection() {
        opened += 1;
        return {
          async transact(fn) {
            fn(fakeDoc());
          },
          async disconnect() {},
        };
      },
    };
  }
  const codec = { applyPresentationToDoc: () => ({ warnings: [] }) };
  const pres = { id: 'x', title: 't', slides: [] };

  it('applies to a doc that is still loading (not yet in documents)', async () => {
    const hp = fakeHocuspocus({
      loadingDocuments: new Map([[docName('x'), {}]]),
    });
    const applied = await applyServerWriteToActiveDoc('x', pres, {
      hocuspocus: hp,
      codec,
      log: makeLog(),
    });
    assert.equal(applied, true);
    assert.equal(hp.opened, 1);
  });

  it('still no-ops when the doc is neither loaded nor loading (cold write)', async () => {
    const hp = fakeHocuspocus();
    const applied = await applyServerWriteToActiveDoc('x', pres, {
      hocuspocus: hp,
      codec,
      log: makeLog(),
    });
    assert.equal(applied, false);
    assert.equal(hp.opened, 0);
  });
});

// ── 4. binary-store failure keeps JSON consistent ───────────────────────────

describe('onStoreDocument: a failed binary store does not write JSON', () => {
  let deckId;

  before(async () => {
    const created = await createPresentation(testScope(), {
      title: 'Binfail deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });

  it('leaves the JSON untouched (no revision bump) and logs the failure', async () => {
    const log = makeLog();
    // Load with a working store to seed the doc, then swap in a failing one.
    const loader = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: { log: makeLog() },
    });
    const doc = new Y.Doc();
    await loader.onLoadDocument({
      documentName: docName(deckId),
      document: doc,
    });
    const before = await getPresentation(testScope(), deckId);

    let jsonWriteAttempted = false;
    const failing = createCollabPersistence({
      repoRoot: REPO_ROOT,
      deps: {
        log,
        setYDocState: async () => {
          throw new Error('disk full');
        },
        updatePresentation: async () => {
          jsonWriteAttempted = true;
          return { ok: true, revision: 999 };
        },
      },
    });

    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, ' (edit)');
    await failing.onStoreDocument({
      documentName: docName(deckId),
      document: doc,
    });

    assert.equal(jsonWriteAttempted, false, 'must not attempt the JSON write');
    const stored = await getPresentation(testScope(), deckId);
    assert.equal(stored.revision, before.revision, 'revision unchanged');
    assert.equal(stored.title, before.title, 'JSON untouched');
    assert.equal(log.lines.error.length, 1);
    assert.match(log.lines.error[0], /skipping the JSON write/);
  });
});
