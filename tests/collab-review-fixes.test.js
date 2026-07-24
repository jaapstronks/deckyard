/**
 * Regression tests for the four review blockers fixed on
 * `fix/collab-review-blockers` (against umbrella PR #12):
 *
 *  1. path traversal — `presentationIdFromDocumentName` rejects non-uuid ids
 *     so the doc name can't reach `getPresentation` → `presPath` unsanitized.
 *  2. custom-html capability — a non-capable editor's raw HTML/CSS edit on a
 *     custom-html-slide is reverted in the doc; a capable editor's sticks.
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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';

import * as Y from 'yjs';
import {
  presentationIdFromDocumentName,
  COLLAB_DOC_PREFIX,
} from '../server/collab/auth.js';
import { deckYdocCodec } from '../server/collab/deck-doc.js';
import { extractCustomHtml, guardCustomHtml } from '../server/collab/custom-html-guard.js';
import { createCollabPersistence } from '../server/collab/persistence.js';
import { applyServerWriteToActiveDoc } from '../server/collab/live-apply.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';

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
        `expected ${JSON.stringify(bad)} to be rejected`
      );
    }
  });

  it('rejects names without the collab prefix', () => {
    assert.equal(presentationIdFromDocumentName('other:abc'), null);
    assert.equal(presentationIdFromDocumentName('abc'), null);
  });
});

// ── 2. custom-html capability gate ──────────────────────────────────────────

function customHtmlDeck() {
  const slides = [
    {
      id: 'ch1',
      type: 'custom-html-slide',
      notes: '',
      content: { html: '<p>origineel</p>', css: '.x{color:red}', background: 'lime' },
    },
    { id: 's2', type: 'content-slide', notes: '', content: { title: 'Gewoon', body: '' } },
  ];
  return { id: 'deck-ch', title: 'CH deck', lang: 'nl', slides };
}

function bootstrappedDoc(pres) {
  const doc = new Y.Doc();
  deckYdocCodec.bootstrapPresentationToDoc(structuredClone(pres), doc);
  return doc;
}

function chContent(doc, slideId) {
  for (const ys of doc.getArray('slides').toArray()) {
    if (ys.get('id') === slideId) return ys.get('content');
  }
  return null;
}

describe('guardCustomHtml: reverts non-capable raw HTML/CSS edits', () => {
  it('reverts html + css changed by a non-capable editor', () => {
    const doc = bootstrappedDoc(customHtmlDeck());
    const snap = extractCustomHtml(doc, Y);

    const c = chContent(doc, 'ch1');
    c.set('html', '<script>evil</script>');
    c.set('css', 'body{display:none}');

    const { snapshot, reverted } = guardCustomHtml(doc, snap, { allowed: false, Y });
    assert.equal(reverted, true);
    assert.equal(chContent(doc, 'ch1').get('html'), '<p>origineel</p>');
    assert.equal(chContent(doc, 'ch1').get('css'), '.x{color:red}');
    // snapshot unchanged (still the good baseline)
    assert.equal(snapshot.get('ch1').html, '<p>origineel</p>');
  });

  it('keeps a capable editor edit and re-snapshots', () => {
    const doc = bootstrappedDoc(customHtmlDeck());
    const snap = extractCustomHtml(doc, Y);

    chContent(doc, 'ch1').set('html', '<p>nieuw en toegestaan</p>');
    const { snapshot, reverted } = guardCustomHtml(doc, snap, { allowed: true, Y });
    assert.equal(reverted, false);
    assert.equal(chContent(doc, 'ch1').get('html'), '<p>nieuw en toegestaan</p>');
    assert.equal(snapshot.get('ch1').html, '<p>nieuw en toegestaan</p>');
  });

  it('reverts raw HTML a non-capable editor adds to a fresh custom-html slide', () => {
    const doc = bootstrappedDoc({
      id: 'd',
      title: 't',
      lang: 'nl',
      slides: [{ id: 'ch1', type: 'custom-html-slide', notes: '', content: { background: 'lime' } }],
    });
    const snap = extractCustomHtml(doc, Y); // html baseline ''
    chContent(doc, 'ch1').set('html', '<p>injected</p>');
    const { reverted } = guardCustomHtml(doc, snap, { allowed: false, Y });
    assert.equal(reverted, true);
    assert.equal(chContent(doc, 'ch1').has('html'), false, 'added html field removed');
  });

  it('leaves non-markup fields (background) alone for non-capable editors', () => {
    const doc = bootstrappedDoc(customHtmlDeck());
    const snap = extractCustomHtml(doc, Y);
    chContent(doc, 'ch1').set('background', 'blue');
    const { reverted } = guardCustomHtml(doc, snap, { allowed: false, Y });
    assert.equal(reverted, false, 'background is not gated');
    assert.equal(chContent(doc, 'ch1').get('background'), 'blue');
  });
});

describe('persistence onChange gate (wired end-to-end via a real deck)', () => {
  let tempRoot;
  let deckId;
  let chId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-ch-gate-'));
    const created = await createPresentation(tempRoot, {
      title: 'CH gate deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
    chId = crypto.randomUUID(); // the facade validates slide ids as uuids
    const pres = await getPresentation(tempRoot, deckId);
    pres.slides = [
      { id: chId, type: 'custom-html-slide', notes: '', content: { html: '<p>ok</p>', css: '', background: 'lime' } },
    ];
    // The facade does not enforce the capability (that's the route's job) —
    // exactly the gap the doc-level gate closes.
    await updatePresentation(tempRoot, deckId, pres);
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reverts a non-capable user; accepts a capable user', async () => {
    const log = makeLog();
    const hooks = createCollabPersistence({
      repoRoot: tempRoot,
      deps: { log, canEditCustomHtmlFn: (u) => u?.email === 'boss@example.com' },
    });

    const doc = new Y.Doc();
    await hooks.onLoadDocument({ documentName: docName(deckId), document: doc });

    // Non-capable editor injects raw HTML → reverted by onChange.
    chContent(doc, chId).set('html', '<script>steal()</script>');
    hooks.onChange({
      documentName: docName(deckId),
      document: doc,
      context: { user: { email: 'intern@example.com', isAdmin: false } },
    });
    assert.equal(chContent(doc, chId).get('html'), '<p>ok</p>', 'non-capable edit reverted');
    assert.equal(log.lines.warn.filter((l) => l.includes('canEditCustomHtml')).length, 1);

    // Capable editor's edit sticks.
    chContent(doc, chId).set('html', '<p>legit update</p>');
    hooks.onChange({
      documentName: docName(deckId),
      document: doc,
      context: { user: { email: 'boss@example.com', isAdmin: false } },
    });
    assert.equal(chContent(doc, chId).get('html'), '<p>legit update</p>', 'capable edit kept');

    // Server-origin write (no context.user) is accepted (route-gated already).
    chContent(doc, chId).set('html', '<p>server</p>');
    hooks.onChange({ documentName: docName(deckId), document: doc, context: {} });
    assert.equal(chContent(doc, chId).get('html'), '<p>server</p>', 'server write kept');

    hooks.afterUnloadDocument({ documentName: docName(deckId) });
  });
});

// ── 3. live-apply load race ─────────────────────────────────────────────────

describe('applyServerWriteToActiveDoc: treats loading docs as active', () => {
  function fakeDoc() {
    return { getMap: () => ({ get: () => ({}) }) }; // meta.extra defined
  }
  function fakeHocuspocus({ documents = new Map(), loadingDocuments = new Map() } = {}) {
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
    const hp = fakeHocuspocus({ loadingDocuments: new Map([[docName('x'), {}]]) });
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
  let tempRoot;
  let deckId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-binfail-'));
    const created = await createPresentation(tempRoot, {
      title: 'Binfail deck',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('leaves the JSON untouched (no revision bump) and logs the failure', async () => {
    const log = makeLog();
    // Load with a working store to seed the doc, then swap in a failing one.
    const loader = createCollabPersistence({ repoRoot: tempRoot, deps: { log: makeLog() } });
    const doc = new Y.Doc();
    await loader.onLoadDocument({ documentName: docName(deckId), document: doc });
    const before = await getPresentation(tempRoot, deckId);

    let jsonWriteAttempted = false;
    const failing = createCollabPersistence({
      repoRoot: tempRoot,
      deps: {
        log,
        setYDocState: async () => {
          throw new Error('disk full');
        },
        updatePresentation: async (...args) => {
          jsonWriteAttempted = true;
          return { ok: true, revision: 999 };
        },
      },
    });

    const title = doc.getMap('meta').get('title').get('nl');
    title.insert(title.length, ' (edit)');
    await failing.onStoreDocument({ documentName: docName(deckId), document: doc });

    assert.equal(jsonWriteAttempted, false, 'must not attempt the JSON write');
    const after = await getPresentation(tempRoot, deckId);
    assert.equal(after.revision, before.revision, 'revision unchanged');
    assert.equal(after.title, before.title, 'JSON untouched');
    assert.equal(log.lines.error.length, 1);
    assert.match(log.lines.error[0], /skipping the JSON write/);
  });
});
