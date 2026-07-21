/**
 * Round-trip test for the `.deck` bundle builder/reader (PR 5, move 2).
 *
 * Writes real asset files to a temp uploads dir (via UPLOADS_DIR), builds a
 * bundle, reads it back, and asserts the mimetype sentinel, content-addressed
 * asset inventory (dedup + integrity), and ref rewriting.
 *
 * Run with: node --test tests/deck-bundle.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let tmpUploads;
let buildDeckBundle;
let readDeckBundle;
let DECK_MIMETYPE;

const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452AAAA', 'hex');
const PNG_B = Buffer.from('89504e470d0a1a0a0000000d49484452BBBBCCCC', 'hex');

before(async () => {
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-uploads-'));
  process.env.UPLOADS_DIR = tmpUploads;
  fs.writeFileSync(path.join(tmpUploads, 'a.png'), PNG_A);
  fs.writeFileSync(path.join(tmpUploads, 'b.png'), PNG_B);
  ({ buildDeckBundle, readDeckBundle, DECK_MIMETYPE } = await import(
    '../server/export/deck-bundle.js'
  ));
});

after(() => {
  try {
    fs.rmSync(tmpUploads, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const pres = () => ({
  title: 'Bundle test',
  theme: 'default',
  slides: [
    { id: '1', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A' } },
    { id: '2', type: 'image-slide', content: { image: '/uploads/a.png', alt: 'A again' } }, // dedup
    { id: '3', type: 'image-slide', content: { image: '/uploads/b.png' } },
    { id: '4', type: 'content-slide', content: { title: 'External', body: '![x](https://example.com/z.png)' } },
    { id: '5', type: 'image-slide', content: { image: '/uploads/gone.png' } }, // missing on disk
  ],
});

describe('buildDeckBundle', () => {
  it('produces a readable bundle with a mimetype sentinel', async () => {
    const buf = await buildDeckBundle('/repo', pres());
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
    const { mimetype, manifest, deck, assets } = await readDeckBundle(buf);
    assert.equal(mimetype, DECK_MIMETYPE);
    assert.equal(manifest.format, 'slidecreator.deck');
    assert.equal(manifest.bundleVersion, 1);
    // a.png (referenced twice) + b.png → 2 unique assets; gone.png is missing.
    assert.equal(manifest.assets.length, 2);
    assert.deepEqual(manifest.missingAssets, ['/uploads/gone.png']);
    assert.equal(assets.size, 2);
  });

  it('content-addresses + de-duplicates assets and records sources', async () => {
    const { manifest } = await readDeckBundle(await buildDeckBundle('/repo', pres()));
    const aHash = crypto.createHash('sha256').update(PNG_A).digest('hex');
    const aAsset = manifest.assets.find((x) => x.hash === aHash);
    assert.ok(aAsset, 'a.png asset present by content hash');
    assert.equal(aAsset.ref, `assets/${aHash}.png`);
    assert.equal(aAsset.mime, 'image/png');
    assert.equal(aAsset.bytes, PNG_A.length);
    assert.ok(aAsset.id.startsWith('sha256-'), 'SRI-shaped id');
    assert.deepEqual(aAsset.sources, ['/uploads/a.png'], 'deduped sources');
  });

  it('rewrites deck refs to bundle refs and leaves external URLs alone', async () => {
    const { deck } = await readDeckBundle(await buildDeckBundle('/repo', pres()));
    const aHash = crypto.createHash('sha256').update(PNG_A).digest('hex');
    assert.equal(deck.slides[0].content.image, `assets/${aHash}.png`);
    assert.equal(deck.slides[1].content.image, `assets/${aHash}.png`);
    assert.ok(!JSON.stringify(deck).includes('/uploads/a.png'), 'no upload refs remain for present assets');
    // The missing asset keeps its original ref (nothing to rewrite to).
    assert.equal(deck.slides[4].content.image, '/uploads/gone.png');
    // External URL untouched.
    assert.ok(JSON.stringify(deck).includes('https://example.com/z.png'));
  });

  it('round-trips asset bytes exactly', async () => {
    const { manifest, assets } = await readDeckBundle(await buildDeckBundle('/repo', pres()));
    const aHash = crypto.createHash('sha256').update(PNG_A).digest('hex');
    const aRef = manifest.assets.find((x) => x.hash === aHash).ref;
    assert.ok(assets.get(aRef).equals(PNG_A));
  });
});

describe('readDeckBundle validation', () => {
  it('rejects a zip without the mimetype sentinel', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('deck.json', '{}');
    const bad = await zip.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(() => readDeckBundle(bad), /mimetype sentinel/);
  });

  it('rejects a tampered asset (integrity check)', async () => {
    const buf = await buildDeckBundle('/repo', pres());
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    // Corrupt one asset's bytes while leaving the manifest hash intact.
    const { manifest } = await readDeckBundle(buf);
    zip.file(manifest.assets[0].ref, Buffer.from('tampered'));
    const tampered = await zip.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(() => readDeckBundle(tampered), /integrity/);
  });
});
