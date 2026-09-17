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
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');

let tmpUploads;
let repoRoot;
let buildDeckBundle;
let readDeckBundle;
let handlePresentationsImportDeck;

const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452AAAA', 'hex');
const PNG_B = Buffer.from('89504e470d0a1a0a0000000d49484452BBBBCCCC', 'hex');

test.before(async () => {
  // Assets still live on disk; only the deck itself moved to the adapter.
  tmpUploads = fs.mkdtempSync(
    path.join(os.tmpdir(), 'deckyard-import-uploads-'),
  );
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-import-repo-'));
  process.env.UPLOADS_DIR = tmpUploads;
  fs.writeFileSync(path.join(tmpUploads, 'a.png'), PNG_A);
  fs.writeFileSync(path.join(tmpUploads, 'b.png'), PNG_B);
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
  ({ buildDeckBundle, readDeckBundle } =
    await import('../server/export/deck-bundle.js'));
  ({ handlePresentationsImportDeck } =
    await import('../server/routes/api/presentations/import-deck.js'));
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
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
    storageScope: testScope(),
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
    {
      id: '1',
      type: 'image-slide',
      content: { image: '/uploads/a.png', alt: 'A' },
    },
    {
      id: '2',
      type: 'image-slide',
      content: { image: '/uploads/a.png', alt: 'A2' },
    }, // dedup
    { id: '3', type: 'image-slide', content: { image: '/uploads/b.png' } },
    {
      id: '4',
      type: 'content-slide',
      content: { title: 'Ext', body: '![x](https://example.com/z.png)' },
    },
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
  assert.ok(
    !json.includes('assets/'),
    'no bundle refs remain in the imported deck',
  );
  assert.ok(json.includes('/uploads/'), 'assets are referenced by upload URL');
  // External URL survives untouched.
  assert.ok(
    json.includes('https://example.com/z.png'),
    'external URL preserved',
  );
  // The missing asset keeps its original ref and does not crash the import.
  assert.ok(json.includes('/uploads/gone.png'), 'missing asset ref preserved');

  // The rewritten upload files exist on disk.
  const uploadRefs = [...json.matchAll(/\/uploads\/([\w.-]+)/g)]
    .map((m) => m[1])
    .filter((f) => f !== 'gone.png');
  assert.ok(uploadRefs.length >= 2, 'at least a.png + b.png re-hydrated');
  for (const f of uploadRefs) {
    assert.ok(
      fs.existsSync(path.join(tmpUploads, f)),
      `re-hydrated file ${f} exists`,
    );
  }
});

test('unknown slide type degrades to a placeholder, not a crash', async () => {
  const bundle = await buildDeckBundle(repoRoot, fixture());
  const { res, body } = await importBundle(bundle);
  assert.equal(res.statusCode, 201);
  const placeholder = body.slides.find(
    (s) =>
      s.type === 'content-slide' &&
      /does not have/i.test(JSON.stringify(s.content)),
  );
  assert.ok(placeholder, 'unknown type became a content-slide placeholder');
  // Import is the one surface that PERSISTS rather than renders, so the
  // archived-slide contract has to hold here too: the placeholder names the
  // missing type and carries its content across as text instead of dropping it.
  assert.match(JSON.stringify(placeholder.content), /totally-unknown-type/);
  assert.match(
    JSON.stringify(placeholder.content),
    /bar/,
    'stored content carried across',
  );
});

// Known-only variant: the unknown-type placeholder is a deliberately lossy
// degradation (partial content on first pass, fully normalized on the next), so
// the fixpoint is measured on real content-bearing slides.
const knownFixture = () => ({
  title: 'Round-trip deck',
  theme: 'default',
  slides: [
    {
      id: '1',
      type: 'image-slide',
      content: { image: '/uploads/a.png', alt: 'A' },
    },
    {
      id: '2',
      type: 'image-slide',
      content: { image: '/uploads/a.png', alt: 'A2' },
    },
    { id: '3', type: 'image-slide', content: { image: '/uploads/b.png' } },
    {
      id: '4',
      type: 'content-slide',
      content: { title: 'Ext', body: '![x](https://example.com/z.png)' },
    },
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
  assert.deepEqual(
    contentShape(deck3),
    contentShape(deck2),
    'round-trip content is stable',
  );
});

test('a two-language deck imports as two language versions (D89)', async () => {
  const nl = [
    {
      id: 'a',
      type: 'content-slide',
      content: { title: 'Waarom', body: 'Eén bron.', background: 'lime' },
      notes: 'Stilstaan.',
      duration: 20,
      visibility: { hideInPublished: true },
    },
  ];
  const en = [
    {
      ...nl[0],
      content: { title: 'Why', body: 'One source.', background: 'lime' },
      notes: 'Pause.',
    },
  ];
  const stored = {
    title: 'Waarom',
    theme: 'default',
    lang: 'nl',
    slides: nl,
    i18n: {
      dominant: 'nl',
      active: 'nl',
      versions: {
        nl: { title: 'Waarom', slides: nl },
        'en-GB': { title: 'Why', slides: en },
      },
    },
  };
  const { res, body } = await importBundle(
    await buildDeckBundle(repoRoot, stored),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(body.i18n.dominant, 'nl');
  const [slide] = body.slides;
  assert.equal(slide.notes, 'Stilstaan.');
  assert.equal(slide.duration, 20);
  assert.deepEqual(slide.visibility, { hideInPublished: true });
  const version = body.i18n.versions['en-GB'];
  assert.equal(version.title, 'Why');
  assert.equal(version.slides[0].id, slide.id);
  assert.equal(version.slides[0].content.body, 'One source.');
  assert.equal(version.slides[0].notes, 'Pause.');
});

test('rejects a bundle whose deck language is not supported', async () => {
  const stored = {
    title: 'x',
    theme: 'default',
    slides: [{ id: 'a', type: 'content-slide', content: { title: 'x' } }],
  };
  const bundle = await buildDeckBundle(repoRoot, stored);
  const { deck, manifest } = await readDeckBundle(bundle);
  deck.lang = 'pt-BR';
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bundle);
  zip.file('deck.json', JSON.stringify(deck));
  zip.file('manifest.json', JSON.stringify(manifest));
  const { res, body } = await importBundle(
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  assert.equal(res.statusCode, 400);
  assert.match(body.message, /pt-BR/);
});

// A non-zip gets the format's own sentence, never JSZip's ("Can't find end of
// central directory … see https://stuk.github.io/…"): the dialog shows it (B310).
for (const [what, buf] of [
  ['a text file', Buffer.from('just some notes\n')],
  ['a JSON deck', Buffer.from(JSON.stringify({ title: 'x', slides: [] }))],
]) {
  test(`rejects ${what} posing as a .deck with one sentence of its own`, async () => {
    const { res, body } = await importBundle(buf);
    assert.equal(res.statusCode, 400);
    assert.equal(body.error, 'bad_request');
    assert.equal(
      body.message,
      'Invalid .deck bundle: the file is not a zip archive',
    );
  });
}

// A real zip whose manifest is broken JSON is refused the same way: the entry
// is named, V8's parser sentence ("Unexpected token …") is not (B310, review).
test('rejects a bundle whose manifest is not JSON with the entry named', async () => {
  const stored = {
    title: 'x',
    theme: 'default',
    slides: [{ id: 'a', type: 'content-slide', content: { title: 'x' } }],
  };
  const bundle = await buildDeckBundle(repoRoot, stored);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bundle);
  zip.file('manifest.json', '{ "bundleVersion": ');
  const { res, body } = await importBundle(
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(body.error, 'bad_request');
  assert.equal(
    body.message,
    'Invalid .deck bundle: manifest.json is not valid JSON',
  );
});

test('rejects an empty body with 400', async () => {
  const { res, body } = await importBundle(Buffer.alloc(0));
  assert.equal(res.statusCode, 400);
  assert.equal(body.error, 'bad_request');
  assert.match(body.message, /Empty request body/);
});
