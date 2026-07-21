/**
 * Title-slide background unification (bgImage → slideBgImage).
 *
 * The title type used to draw its own bgImage/bgAlt as a bespoke
 * `<img class="slide-bg">` with a `.has-bg` treatment, on top of the generic
 * slideBgImage layer — two systems, two controls, two possible images. These
 * tests pin the single read authority (resolveTitleSlideBackground), the
 * migrate-on-edit fold (ensureTitleSlideBackground) and the render fallback
 * (legacy draws its own <img>; canonical draws nothing so the shared layer
 * owns it).
 *
 * Run with: node --test tests/title-slide-background.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTitleSlideBackground,
  ensureTitleSlideBackground,
} from '../shared/slide-types/title-slide-background.js';
import { renderSlideHtml, SLIDE_TYPES } from '../shared/slide-types.js';

// ---- resolveTitleSlideBackground: canonical wins → legacy → none ----

test('resolve: canonical slideBgImage wins over a legacy bgImage', () => {
  const r = resolveTitleSlideBackground({
    slideBgImage: '/canon.jpg',
    bgImage: '/legacy.jpg',
    bgAlt: 'old',
  });
  assert.deepEqual(r, { image: '/canon.jpg', alt: '', source: 'canonical' });
});

test('resolve: legacy bgImage/bgAlt when no canonical', () => {
  const r = resolveTitleSlideBackground({ bgImage: '/legacy.jpg', bgAlt: 'desc' });
  assert.deepEqual(r, { image: '/legacy.jpg', alt: 'desc', source: 'legacy' });
});

test('resolve: none when neither is set', () => {
  assert.deepEqual(resolveTitleSlideBackground({}), {
    image: '',
    alt: '',
    source: 'none',
  });
  assert.deepEqual(resolveTitleSlideBackground({ slideBgImage: '  ', bgImage: '' }), {
    image: '',
    alt: '',
    source: 'none',
  });
});

// ---- ensureTitleSlideBackground: fold + reproduce look + idempotent ----

test('ensure: folds legacy into slideBgImage and reproduces the has-bg look', () => {
  const content = { title: 'T', bgImage: '/legacy.jpg', bgAlt: 'desc' };
  ensureTitleSlideBackground(content);
  assert.equal(content.slideBgImage, '/legacy.jpg');
  assert.equal(content.slideBgText, 'light');
  assert.equal(content.slideBgOverlay, 'gradient-bottom');
  assert.ok(!('bgImage' in content), 'legacy bgImage dropped');
  assert.ok(!('bgAlt' in content), 'bgAlt dropped');
});

test('ensure: is idempotent (second run is a no-op)', () => {
  const content = { title: 'T', bgImage: '/legacy.jpg' };
  ensureTitleSlideBackground(content);
  const once = structuredClone(content);
  ensureTitleSlideBackground(content);
  assert.deepEqual(content, once);
});

test('ensure: never overwrites an author\'s explicit text/overlay choices', () => {
  const content = {
    bgImage: '/legacy.jpg',
    slideBgText: 'dark',
    slideBgOverlay: 'none',
  };
  ensureTitleSlideBackground(content);
  assert.equal(content.slideBgImage, '/legacy.jpg');
  assert.equal(content.slideBgText, 'dark');
  assert.equal(content.slideBgOverlay, 'none');
});

test('ensure: canonical present → legacy dropped as redundant, canonical kept', () => {
  const content = { slideBgImage: '/canon.jpg', bgImage: '/legacy.jpg', bgAlt: 'x' };
  ensureTitleSlideBackground(content);
  assert.equal(content.slideBgImage, '/canon.jpg');
  assert.ok(!('bgImage' in content));
  assert.ok(!('bgAlt' in content));
  // Canonical bg keeps whatever text/overlay it had (unset here).
  assert.ok(!content.slideBgText);
});

test('ensure: no legacy background → no keys invented, canonical untouched', () => {
  const content = { title: 'T', slideBgImage: '/canon.jpg' };
  ensureTitleSlideBackground(content);
  assert.deepEqual(content, { title: 'T', slideBgImage: '/canon.jpg' });
});

test('ensure: clears a stray empty legacy key without touching anything else', () => {
  const content = { title: 'T', bgImage: '', bgAlt: '' };
  ensureTitleSlideBackground(content);
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
    content: { title: 'Hello', slideBgImage: '/canon.jpg', bgImage: '/legacy.jpg' },
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

test('schema: title-slide no longer declares bgImage/bgAlt fields', () => {
  const keys = SLIDE_TYPES['title-slide'].fields.map((f) => f.key);
  assert.ok(!keys.includes('bgImage'));
  assert.ok(!keys.includes('bgAlt'));
  // The shared slideBgImage field is added by withGlobalSlideFields.
  assert.ok(keys.includes('slideBgImage'));
});
