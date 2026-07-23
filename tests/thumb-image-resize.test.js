/**
 * Deck-list thumbnails, Fase A (rest): downscale card images.
 *
 * imagekitThumbUrl() appends a width transform only to ImageKit URLs.
 * localUploadThumbUrl() appends a `?w=<n>` request only to same-origin
 * `/uploads/…` URLs (for the server resize endpoint). thumbVariantUrl() picks
 * the right one. downscaleThumbImages() rewrites a rendered thumbnail subtree in
 * place: ImageKit + local background-image/<img> src get a width, <img>s become
 * lazy, and srcset is dropped. Data URIs and unknown hosts are left alone.
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

const { imagekitThumbUrl, localUploadThumbUrl, thumbVariantUrl, downscaleThumbImages } =
  await import('../client/lib/slide-runtime/thumb-image-resize.js');

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
    // A host that only *contains* imagekit.io must not qualify (spoofing).
    'https://imagekit.io.evil.com/acme/pic.jpg',
    'https://notimagekit.io/acme/pic.jpg',
    '',
  ]) {
    assert.equal(imagekitThumbUrl(u, 800), u, `unchanged: ${u}`);
  }
});

test('localUploadThumbUrl adds ?w only to same-origin /uploads/ URLs', () => {
  assert.equal(localUploadThumbUrl('/uploads/pic.jpg', 800), '/uploads/pic.jpg?w=800');
  // Absolute same-origin form is recognized too.
  assert.equal(
    localUploadThumbUrl('http://localhost/uploads/pic.jpg', 800),
    'http://localhost/uploads/pic.jpg?w=800'
  );
  // Existing query string → appended with &.
  assert.equal(
    localUploadThumbUrl('/uploads/pic.jpg?v=2', 800),
    '/uploads/pic.jpg?v=2&w=800'
  );
});

test('localUploadThumbUrl leaves non-local / data / sized / bad-width URLs alone', () => {
  for (const u of [
    'https://ik.imagekit.io/acme/pic.jpg', // ImageKit is not our concern here
    'https://example.com/uploads/pic.jpg', // cross-origin /uploads is not ours
    '/assets/pic.jpg', // not an upload
    '/uploads/pic.jpg?w=800', // already requested
    'data:image/png;base64,AAAA',
    '',
  ]) {
    assert.equal(localUploadThumbUrl(u, 800), u, `unchanged: ${u}`);
  }
  // A width the server won't materialize is refused (no cache-bomb).
  assert.equal(localUploadThumbUrl('/uploads/pic.jpg', 777), '/uploads/pic.jpg');
});

test('thumbVariantUrl routes ImageKit vs local vs untouched', () => {
  assert.equal(
    thumbVariantUrl('https://ik.imagekit.io/acme/pic.jpg', 800),
    'https://ik.imagekit.io/acme/pic.jpg?tr=w-800'
  );
  assert.equal(thumbVariantUrl('/uploads/pic.jpg', 800), '/uploads/pic.jpg?w=800');
  assert.equal(
    thumbVariantUrl('https://example.com/pic.jpg', 800),
    'https://example.com/pic.jpg'
  );
});

test('downscaleThumbImages rewrites ImageKit + local background-image, img src, lazy + srcset', () => {
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
  assert.match(localBg, /\?w=800/, 'local bg gets server width request');

  const a = root.querySelector('img.a');
  assert.match(a.getAttribute('src'), /tr=w-800/, 'ImageKit img src downscaled');
  assert.equal(a.getAttribute('loading'), 'lazy', 'img marked lazy');
  assert.equal(a.hasAttribute('srcset'), false, 'srcset dropped');

  const b = root.querySelector('img.b');
  assert.match(b.getAttribute('src'), /\?w=800/, 'local img src downscaled');
  assert.equal(b.getAttribute('loading'), 'lazy', 'local img still marked lazy');
});
