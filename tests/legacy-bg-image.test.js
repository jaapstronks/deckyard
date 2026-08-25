/**
 * Legacy background unification (bgImage → slideBgImage).
 *
 * Slide types used to draw their own bgImage/bgAlt as a bespoke
 * `<img class="slide-bg">` with a `.has-bg` treatment, on top of the generic
 * slideBgImage layer — two systems, two controls, two possible images. These
 * tests pin the single read authority (resolveSlideBgImage), the
 * migrate-on-edit fold (ensureSlideBgImage) and the render fallback (legacy
 * draws its own <img>; canonical draws nothing so the shared layer owns it).
 *
 * Run with: node --test tests/legacy-bg-image.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSlideBgImage,
  ensureSlideBgImage,
} from '../shared/slide-types/legacy-bg-image.js';
import {
  renderSlideHtml,
  SLIDE_TYPES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../shared/slide-types.js';

// ---- resolveSlideBgImage: canonical wins → legacy → none ----

test('resolve: canonical slideBgImage wins over a legacy bgImage', () => {
  const r = resolveSlideBgImage({
    slideBgImage: '/canon.jpg',
    bgImage: '/legacy.jpg',
    bgAlt: 'old',
  });
  assert.deepEqual(r, { image: '/canon.jpg', alt: '', source: 'canonical' });
});

test('resolve: legacy bgImage/bgAlt when no canonical', () => {
  const r = resolveSlideBgImage({
    bgImage: '/legacy.jpg',
    bgAlt: 'desc',
  });
  assert.deepEqual(r, { image: '/legacy.jpg', alt: 'desc', source: 'legacy' });
});

test('resolve: none when neither is set', () => {
  assert.deepEqual(resolveSlideBgImage({}), {
    image: '',
    alt: '',
    source: 'none',
  });
  assert.deepEqual(resolveSlideBgImage({ slideBgImage: '  ', bgImage: '' }), {
    image: '',
    alt: '',
    source: 'none',
  });
});

// ---- ensureSlideBgImage: fold + reproduce look + idempotent ----

test('ensure: folds legacy into slideBgImage and reproduces the has-bg look', () => {
  const content = { title: 'T', bgImage: '/legacy.jpg', bgAlt: 'desc' };
  ensureSlideBgImage(content);
  assert.equal(content.slideBgImage, '/legacy.jpg');
  assert.equal(content.slideBgText, 'light');
  assert.equal(content.slideBgOverlay, 'gradient-bottom');
  assert.ok(!('bgImage' in content), 'legacy bgImage dropped');
  assert.ok(!('bgAlt' in content), 'bgAlt dropped');
});

test('ensure: is idempotent (second run is a no-op)', () => {
  const content = { title: 'T', bgImage: '/legacy.jpg' };
  ensureSlideBgImage(content);
  const once = structuredClone(content);
  ensureSlideBgImage(content);
  assert.deepEqual(content, once);
});

test("ensure: never overwrites an author's explicit text/overlay choices", () => {
  const content = {
    bgImage: '/legacy.jpg',
    slideBgText: 'dark',
    slideBgOverlay: 'none',
  };
  ensureSlideBgImage(content);
  assert.equal(content.slideBgImage, '/legacy.jpg');
  assert.equal(content.slideBgText, 'dark');
  assert.equal(content.slideBgOverlay, 'none');
});

test('ensure: canonical present → legacy dropped as redundant, canonical kept', () => {
  const content = {
    slideBgImage: '/canon.jpg',
    bgImage: '/legacy.jpg',
    bgAlt: 'x',
  };
  ensureSlideBgImage(content);
  assert.equal(content.slideBgImage, '/canon.jpg');
  assert.ok(!('bgImage' in content));
  assert.ok(!('bgAlt' in content));
  // Canonical bg keeps whatever text/overlay it had (unset here).
  assert.ok(!content.slideBgText);
});

test('ensure: no legacy background → no keys invented, canonical untouched', () => {
  const content = { title: 'T', slideBgImage: '/canon.jpg' };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T', slideBgImage: '/canon.jpg' });
});

test('ensure: folds an empty legacy key into an empty canonical one', () => {
  // "Deliberately cleared" must survive the fold: for a type declaring
  // autoBackgroundPreset, deleting the key outright reads as "never chosen"
  // and re-seeds the background the author just removed.
  const content = { title: 'T', bgImage: '', bgAlt: '' };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T', slideBgImage: '' });
  // ...and stays that way on a second run.
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T', slideBgImage: '' });
});

test('ensure: an empty legacy key never overwrites a canonical background', () => {
  const content = { title: 'T', bgImage: '', slideBgImage: '/canon.jpg' };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T', slideBgImage: '/canon.jpg' });
});

test('ensure: content that never carried the pair is left alone entirely', () => {
  const content = { title: 'T' };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T' });
});

// ---- render fallback: mutual exclusivity, no double image ----

test('render: legacy deck draws its own slide-bg img + has-bg (unchanged look)', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: { title: 'Hello', bgImage: '/legacy.jpg', bgAlt: 'a photo' },
  });
  assert.match(html, /<img class="slide-bg" src="\/legacy.jpg" alt="a photo"/);
  assert.match(html, /class="slide slide-title-universal[^"]*\shas-bg/);
  // The shared slideBgImage layer must NOT appear (no canonical image).
  assert.doesNotMatch(html, /slide-bg-layer/);
});

test('render: canonical slideBgImage draws only the shared layer, no legacy img', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: { title: 'Hello', slideBgImage: '/canon.jpg' },
  });
  // Shared layer paints it; the title type draws nothing of its own.
  assert.match(html, /slide-bg-layer/);
  assert.doesNotMatch(html, /<img class="slide-bg"/);
  assert.doesNotMatch(html, /\shas-bg[\s"]/);
});

test('render: a slide with BOTH keys shows only the canonical layer (no double image)', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: {
      title: 'Hello',
      slideBgImage: '/canon.jpg',
      bgImage: '/legacy.jpg',
    },
  });
  assert.match(html, /slide-bg-layer/);
  assert.doesNotMatch(html, /<img class="slide-bg"/);
  assert.doesNotMatch(html, /\/legacy.jpg/);
});

test('render: no background draws neither system', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: { title: 'Hello' },
  });
  assert.doesNotMatch(html, /<img class="slide-bg"/);
  assert.doesNotMatch(html, /slide-bg-layer/);
});

test('schema: no core slide type declares bgImage/bgAlt fields', () => {
  // One background control per slide: a type re-declaring the legacy pair gets
  // its own picker rendered beside the shared Background section, which is the
  // duplication this module exists to end. Core types only — a fork's types are
  // absent from a clean checkout, the same carve-out the other policy tests
  // make (see tests/helpers/slide-type-companions.js). A fork that still
  // declares the pair renders two pickers until migrate-on-edit folds it.
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    if (CUSTOM_SLIDE_TYPE_NAMES.includes(name)) continue;
    const keys = (def.fields || []).map((f) => f.key);
    assert.ok(!keys.includes('bgImage'), `${name} declares a legacy bgImage`);
    assert.ok(!keys.includes('bgAlt'), `${name} declares a legacy bgAlt`);
    // The shared slideBgImage field is added by withGlobalSlideFields.
    assert.ok(keys.includes('slideBgImage'), `${name} lacks slideBgImage`);
  }
});
