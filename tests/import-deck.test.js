/**
 * End-to-end round-trip test for the `.deck` bundle importer (PR 5b, move 2).
 *
 * Drives the real import handler (handlePresentationsImportDeck) with a bundle
 * built by the exporter, against a temp uploads dir + temp storage root. Asserts:
 *   - assets are re-hydrated into /uploads/ and the deck's bundle refs are
 *     rewritten back to those upload URLs (no `assets/…` refs remain);
 *   - the export→import→export round-trip is content-stable (a fixpoint once
 *     the deck is normalized);
 *   - unknown slide types and missing assets degrade without crashing.
 *
 * Run with: node --test tests/import-deck.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpUploads;
let repoRoot;
let buildDeckBundle;
let readDeckBundle;
let handlePresentationsImportDeck;

const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452AAAA', 'hex');
const PNG_B = Buffer.from('89504e470d0a1a0a0000000d49484452BBBBCCCC', 'hex');

test.before(async () => {
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-import-uploads-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-import-repo-'));
  process.env.UPLOADS_DIR = tmpUploads;
  fs.writeFileSync(path.join(tmpUploads, 'a.png'), PNG_A);
  fs.writeFileSync(path.join(tmpUploads, 'b.png'), PNG_B);
  ({ buildDeckBundle, readDeckBundle } = await import('../server/export/deck-bundle.js'));
  ({ handlePresentationsImportDeck } = await import(
    '../server/routes/api/presentations/import-deck.js'
  ));
});

test.after(() => {
  for (const dir of [tmpUploads, repoRoot]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function fakeReq(buf) {
  return (async function* () {
    yield buf;
  })();
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    ended: false,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
      this.ended = true;
    },
  };
}

async function importBundle(buf) {
  const res = fakeRes();
  await handlePresentationsImportDeck({
    repoRoot,
    req: fakeReq(buf),
    res,
    authedUser: { email: 'importer@example.com' },
  });
  return { res, body: res.body ? JSON.parse(res.body) : null };
}

/** Slide identity for round-trip comparison (ignore regenerated ids). */
function contentShape(deck) {
  return (deck.slides || []).map((s) => ({ type: s.type, content: s.content }));
}

const fixture = () => ({
  title: 'Round-trip deck',
  theme: 'default',
  slides: [
    { id: '1', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A' } },
    { id: '2', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A2' } }, // dedup
    { id: '3', type: 'image-slide', content: { image: '/uploads/b.png' } },
    { id: '4', type: 'content-slide', content: { title: 'Ext', body: '![x](https://example.com/z.png)' } },
    { id: '5', type: 'image-slide', content: { image: '/uploads/gone.png' } }, // missing on disk
    { id: '6', type: 'totally-unknown-type', content: { foo: 'bar' } }, // unknown type
  ],
});

test('imports a .deck bundle, re-hydrating assets to /uploads/', async () => {
  const bundle = await buildDeckBundle(repoRoot, fixture());
  const { res, body } = await importBundle(bundle);

  assert.equal(res.statusCode, 201, 'import returns 201');
  assert.ok(body?.id, 'a presentation was created');

  const json = JSON.stringify(body.slides);
  assert.ok(!json.includes('assets/'), 'no bundle refs remain in the imported deck');
  assert.ok(json.includes('/uploads/'), 'assets are referenced by upload URL');
  // External URL survives untouched.
  assert.ok(json.includes('https://example.com/z.png'), 'external URL preserved');
  // The missing asset keeps its original ref and does not crash the import.
  assert.ok(json.includes('/uploads/gone.png'), 'missing asset ref preserved');

  // The rewritten upload files exist on disk.
  const uploadRefs = [...json.matchAll(/\/uploads\/([\w.-]+)/g)]
    .map((m) => m[1])
    .filter((f) => f !== 'gone.png');
  assert.ok(uploadRefs.length >= 2, 'at least a.png + b.png re-hydrated');
  for (const f of uploadRefs) {
    assert.ok(fs.existsSync(path.join(tmpUploads, f)), `re-hydrated file ${f} exists`);
  }
});

test('unknown slide type degrades to a placeholder, not a crash', async () => {
  const bundle = await buildDeckBundle(repoRoot, fixture());
  const { res, body } = await importBundle(bundle);
  assert.equal(res.statusCode, 201);
  const placeholder = body.slides.find(
    (s) => s.type === 'content-slide' && /unknown slide type/i.test(JSON.stringify(s.content))
  );
  assert.ok(placeholder, 'unknown type became a content-slide placeholder');
});

// Known-only variant: the unknown-type placeholder is a deliberately lossy
// degradation (partial content on first pass, fully normalized on the next), so
// the fixpoint is measured on real content-bearing slides.
const knownFixture = () => ({
  title: 'Round-trip deck',
  theme: 'default',
  slides: [
    { id: '1', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A' } },
    { id: '2', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A2' } },
    { id: '3', type: 'image-slide', content: { image: '/uploads/b.png' } },
    { id: '4', type: 'content-slide', content: { title: 'Ext', body: '![x](https://example.com/z.png)' } },
    { id: '5', type: 'image-slide', content: { image: '/uploads/gone.png' } },
  ],
});

test('export→import→export is content-stable (round-trip fixpoint)', async () => {
  // First import normalizes the deck (defaults filled, ids regenerated).
  const bundle1 = await buildDeckBundle(repoRoot, knownFixture());
  const { body: pres1 } = await importBundle(bundle1);

  // Export the normalized presentation, import it again, export once more.
  const bundle2 = await buildDeckBundle(repoRoot, pres1);
  const { body: pres2 } = await importBundle(bundle2);
  const bundle3 = await buildDeckBundle(repoRoot, pres2);

  const deck2 = (await readDeckBundle(bundle2)).deck;
  const deck3 = (await readDeckBundle(bundle3)).deck;

  // Same bytes → same content-addressed refs; normalized content is identical.
  assert.deepEqual(contentShape(deck3), contentShape(deck2), 'round-trip content is stable');
});

test('rejects a non-bundle body with 400', async () => {
  const { res, body } = await importBundle(Buffer.from('not a zip'));
  assert.equal(res.statusCode, 400);
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /Invalid \.deck bundle/);
});

test('rejects an empty body with 400', async () => {
  const { res, body } = await importBundle(Buffer.alloc(0));
  assert.equal(res.statusCode, 400);
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /Empty request body/);
});
