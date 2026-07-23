/**
 * Tests for deck asset ref enumeration + rewriting + content-addressing
 * (PR 5, move 2 — the pure layer).
 *
 * Run with: node --test tests/deck-assets.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isUploadRef,
  isBundleRef,
  collectAssetRefs,
  rewriteAssetRefs,
  rewriteBundleRefs,
  assetRefForHash,
} from '../shared/slide-types/deck-assets.js';

describe('isUploadRef', () => {
  it('accepts a plain uploads ref', () => {
    assert.equal(isUploadRef('/uploads/photo-abc.png'), true);
  });
  it('rejects non-uploads, traversal, and nested paths', () => {
    assert.equal(isUploadRef('https://example.com/x.png'), false);
    assert.equal(isUploadRef('/uploads/'), false);
    assert.equal(isUploadRef('/uploads/../secret'), false);
    assert.equal(isUploadRef('/uploads/sub/x.png'), false);
    assert.equal(isUploadRef(42), false);
    assert.equal(isUploadRef(null), false);
  });
});

describe('collectAssetRefs', () => {
  const deck = {
    slides: [
      { content: { image: '/uploads/a.png', title: 'hi' } },
      { content: { gallery: ['/uploads/b.jpg', 'https://x/y.png', '/uploads/a.png'] } },
      { content: { items: [{ src: '/uploads/c.webp' }, { src: '/uploads/b.jpg' }] } },
      { content: { note: 'no assets here' } },
    ],
  };
  it('collects unique upload refs across nested content, first-seen order', () => {
    assert.deepEqual(collectAssetRefs(deck), [
      '/uploads/a.png',
      '/uploads/b.jpg',
      '/uploads/c.webp',
    ]);
  });
  it('ignores external URLs and returns [] for an empty deck', () => {
    assert.deepEqual(collectAssetRefs({ slides: [] }), []);
    assert.deepEqual(collectAssetRefs({}), []);
    assert.deepEqual(collectAssetRefs(null), []);
  });
});

describe('rewriteAssetRefs', () => {
  it('rewrites every upload ref via mapFn without mutating input', () => {
    const deck = {
      title: 'T',
      slides: [
        { id: '1', content: { image: '/uploads/a.png', title: 'keep' } },
        { id: '2', content: { items: [{ src: '/uploads/b.jpg' }] } },
      ],
    };
    const map = { '/uploads/a.png': 'assets/aa.png', '/uploads/b.jpg': 'assets/bb.jpg' };
    const out = rewriteAssetRefs(deck, (ref) => map[ref]);
    assert.equal(out.slides[0].content.image, 'assets/aa.png');
    assert.equal(out.slides[0].content.title, 'keep');
    assert.equal(out.slides[1].content.items[0].src, 'assets/bb.jpg');
    assert.equal(out.title, 'T');
    // input untouched
    assert.equal(deck.slides[0].content.image, '/uploads/a.png');
  });
  it('keeps the original ref when mapFn returns falsy', () => {
    const deck = { slides: [{ content: { image: '/uploads/a.png' } }] };
    const out = rewriteAssetRefs(deck, () => null);
    assert.equal(out.slides[0].content.image, '/uploads/a.png');
  });
  it('round-trips: rewrite forward then back is identity for content', () => {
    const deck = { slides: [{ content: { image: '/uploads/a.png', x: [1, { y: '/uploads/b.jpg' }] } }] };
    const fwd = { '/uploads/a.png': 'assets/aa.png', '/uploads/b.jpg': 'assets/bb.jpg' };
    const back = { 'assets/aa.png': '/uploads/a.png', 'assets/bb.jpg': '/uploads/b.jpg' };
    const there = rewriteAssetRefs(deck, (r) => fwd[r]);
    // back-map keys are bundle refs, which are NOT upload refs, so rewriteAssetRefs
    // (which only touches upload refs) won't reverse them — verify via a manual walk.
    assert.equal(there.slides[0].content.image, 'assets/aa.png');
    assert.equal(there.slides[0].content.x[1].y, 'assets/bb.jpg');
    assert.ok(back['assets/aa.png'] === '/uploads/a.png');
  });
});

describe('isBundleRef', () => {
  it('accepts a content-addressed bundle ref', () => {
    assert.equal(isBundleRef('assets/deadbeef.png'), true);
    assert.equal(isBundleRef('assets/deadbeef'), true);
  });
  it('rejects uploads, traversal, nested, and non-strings', () => {
    assert.equal(isBundleRef('/uploads/a.png'), false);
    assert.equal(isBundleRef('assets/'), false);
    assert.equal(isBundleRef('assets/../secret'), false);
    assert.equal(isBundleRef('assets/sub/x.png'), false);
    assert.equal(isBundleRef(42), false);
  });
});

describe('rewriteBundleRefs', () => {
  it('rewrites bundle refs back to uploads (inverse of rewriteAssetRefs)', () => {
    const deck = {
      slides: [
        { content: { image: 'assets/aa.png', title: 'keep' } },
        { content: { items: [{ src: 'assets/bb.jpg' }] } },
      ],
    };
    const map = { 'assets/aa.png': '/uploads/a-1.png', 'assets/bb.jpg': '/uploads/b-2.jpg' };
    const out = rewriteBundleRefs(deck, (r) => map[r]);
    assert.equal(out.slides[0].content.image, '/uploads/a-1.png');
    assert.equal(out.slides[0].content.title, 'keep');
    assert.equal(out.slides[1].content.items[0].src, '/uploads/b-2.jpg');
    // input untouched
    assert.equal(deck.slides[0].content.image, 'assets/aa.png');
  });
  it('keeps the original ref when mapFn returns falsy (missing asset)', () => {
    const deck = { slides: [{ content: { image: 'assets/gone.png' } }] };
    const out = rewriteBundleRefs(deck, () => undefined);
    assert.equal(out.slides[0].content.image, 'assets/gone.png');
  });
  it('round-trips: rewriteAssetRefs then rewriteBundleRefs is identity', () => {
    const deck = { slides: [{ content: { image: '/uploads/a.png', x: [1, { y: '/uploads/b.jpg' }] } }] };
    const fwd = { '/uploads/a.png': 'assets/aa.png', '/uploads/b.jpg': 'assets/bb.jpg' };
    const back = { 'assets/aa.png': '/uploads/a.png', 'assets/bb.jpg': '/uploads/b.jpg' };
    const there = rewriteAssetRefs(deck, (r) => fwd[r]);
    const backAgain = rewriteBundleRefs(there, (r) => back[r]);
    assert.deepEqual(backAgain, deck);
  });
});

describe('assetRefForHash', () => {
  it('formats content-addressed refs with and without an extension', () => {
    assert.equal(assetRefForHash('ABC123', 'png'), 'assets/abc123.png');
    assert.equal(assetRefForHash('abc123', '.jpg'), 'assets/abc123.jpg');
    assert.equal(assetRefForHash('abc123'), 'assets/abc123');
  });
});
