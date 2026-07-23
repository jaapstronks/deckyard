/**
 * Deck-list thumbnails, Fase A (rest): downscale card images.
 *
 * imagekitThumbUrl() appends a width transform only to ImageKit URLs, and never
 * to local uploads, data URIs, or URLs that already carry a transform.
 * downscaleThumbImages() rewrites a rendered thumbnail subtree in place:
 * background-image URLs + <img> src get the ImageKit width, <img>s become lazy,
 * and srcset is dropped.
 *
 * Run with: node --test tests/thumb-image-resize.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { imagekitThumbUrl, downscaleThumbImages } = await import(
  '../client/lib/slide-runtime/thumb-image-resize.js'
);

test('imagekitThumbUrl adds a width transform only to ImageKit URLs', () => {
  assert.equal(
    imagekitThumbUrl('https://ik.imagekit.io/acme/pic.jpg', 800),
    'https://ik.imagekit.io/acme/pic.jpg?tr=w-800'
  );
  // Appends with & when the URL already has a query string.
  assert.equal(
    imagekitThumbUrl('https://ik.imagekit.io/acme/pic.jpg?v=2', 800),
    'https://ik.imagekit.io/acme/pic.jpg?v=2&tr=w-800'
  );
});

test('imagekitThumbUrl leaves non-ImageKit / data / already-transformed URLs alone', () => {
  for (const u of [
    '/uploads/local.jpg',
    'https://example.com/pic.jpg',
    'data:image/png;base64,AAAA',
    'https://ik.imagekit.io/acme/pic.jpg?tr=w-1600', // author transform respected
    '',
  ]) {
    assert.equal(imagekitThumbUrl(u, 800), u, `unchanged: ${u}`);
  }
});

test('downscaleThumbImages rewrites background-image, img src, lazy + srcset', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="slide-bg-layer" style="background-image:url('https://ik.imagekit.io/acme/bg.jpg');background-size:cover;"></div>
    <div class="slide-bg-local" style="background-image:url('/uploads/bg.jpg');"></div>
    <img class="a" src="https://ik.imagekit.io/acme/photo.jpg" srcset="https://ik.imagekit.io/acme/photo.jpg 2x">
    <img class="b" src="/uploads/photo.jpg">
  `;
  downscaleThumbImages(root, { width: 800 });

  const ikBg = root.querySelector('.slide-bg-layer').style.backgroundImage;
  assert.match(ikBg, /tr=w-800/, 'ImageKit bg gets width transform');
  const localBg = root.querySelector('.slide-bg-local').style.backgroundImage;
  assert.doesNotMatch(localBg, /tr=/, 'local bg untouched');

  const a = root.querySelector('img.a');
  assert.match(a.getAttribute('src'), /tr=w-800/, 'ImageKit img src downscaled');
  assert.equal(a.getAttribute('loading'), 'lazy', 'img marked lazy');
  assert.equal(a.hasAttribute('srcset'), false, 'srcset dropped');

  const b = root.querySelector('img.b');
  assert.equal(b.getAttribute('src'), '/uploads/photo.jpg', 'local img src untouched');
  assert.equal(b.getAttribute('loading'), 'lazy', 'local img still marked lazy');
});
