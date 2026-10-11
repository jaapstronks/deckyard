/**
 * Legacy background unification (bgImage → slideBgImage).
 *
 * Slide types used to draw their own bgImage/bgAlt as a bespoke
 * `<img class="slide-bg">` with a `.has-bg` treatment, on top of the generic
 * slideBgImage layer — two systems, two controls, two possible images. These
 * tests pin the fold (ensureSlideBgImage), its place in the read funnel
 * (schema v21 -> v22, B257 B1-bg) and that the render draws the shared layer
 * only: the legacy render fallback is gone.
 *
 * Run with: node --test tests/legacy-bg-image.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSlideBgImage } from '../shared/slide-types/legacy-bg-image.js';
import { migratePresentation } from '../shared/slide-types/schema-version.js';
import {
  renderSlideHtml,
  SLIDE_TYPES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../shared/slide-types.js';

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

test('ensure: the picker provider id goes too, with or without the pair', () => {
  const content = {
    slideBgImage: '/canon.jpg',
    bgAlt: 'x',
    bgImagekitFileId: 'f1',
  };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { slideBgImage: '/canon.jpg' });
});

test('ensure: content that never carried the pair is left alone entirely', () => {
  const content = { title: 'T' };
  ensureSlideBgImage(content);
  assert.deepEqual(content, { title: 'T' });
});

// ---- the read funnel: every type, every language version ----

test('funnel: folds the pair on every slide of every language version', () => {
  const pres = migratePresentation({
    slides: [
      {
        type: 'title-slide',
        content: { title: 'T', bgImage: '/nl.jpg', bgAlt: 'a' },
      },
    ],
    i18n: {
      versions: {
        'en-GB': {
          slides: [
            {
              type: 'title-slide',
              content: { title: 'T', bgImage: '/en.jpg' },
            },
            {
              type: 'text-slide',
              content: { bgImage: '', bgImagekitFileId: 'f' },
            },
          ],
        },
      },
    },
  });
  assert.deepEqual(pres.slides[0].content, {
    title: 'T',
    slideBgImage: '/nl.jpg',
    slideBgText: 'light',
    slideBgOverlay: 'gradient-bottom',
  });
  const [title, other] = pres.i18n.versions['en-GB'].slides;
  assert.equal(title.content.slideBgImage, '/en.jpg');
  assert.ok(!('bgImage' in title.content));
  assert.deepEqual(
    other.content,
    { slideBgImage: '' },
    'any type, emptiness kept',
  );
});

test('funnel: a no-op on the current shape', () => {
  const current = {
    slides: [
      { type: 'title-slide', content: { title: 'T', slideBgImage: '/a.jpg' } },
    ],
  };
  const before = structuredClone(current.slides);
  assert.deepEqual(migratePresentation(current).slides, before);
});

// ---- render: the shared layer only ----

test('render: a legacy deck draws its background through the shared layer', () => {
  const pres = migratePresentation({
    slides: [
      {
        type: 'title-slide',
        content: { title: 'Hello', bgImage: '/legacy.jpg', bgAlt: 'a photo' },
      },
    ],
  });
  const html = renderSlideHtml(pres.slides[0]);
  assert.match(html, /slide-bg-layer/);
  assert.match(html, /\/legacy.jpg/);
  assert.doesNotMatch(html, /<img class="slide-bg"/);
  assert.doesNotMatch(html, /\shas-bg[\s"]/);
});

test('render: an un-funneled bgImage is no longer read', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: { title: 'Hello', bgImage: '/legacy.jpg' },
  });
  assert.doesNotMatch(html, /\/legacy.jpg/);
  assert.doesNotMatch(html, /slide-bg-layer/);
});

test('render: canonical slideBgImage draws only the shared layer', () => {
  const html = renderSlideHtml({
    type: 'title-slide',
    content: { title: 'Hello', slideBgImage: '/canon.jpg' },
  });
  assert.match(html, /slide-bg-layer/);
  assert.doesNotMatch(html, /<img class="slide-bg"/);
});

test('schema: no core slide type declares bgImage/bgAlt fields', () => {
  // One background control per slide: a type re-declaring the legacy pair gets
  // its own picker rendered beside the shared Background section, which is the
  // duplication this module exists to end. Core types only — a fork's types are
  // absent from a clean checkout, the same carve-out the other policy tests
  // make (see tests/helpers/slide-type-companions.js). A fork that still
  // declared the pair would have the read funnel delete its values.
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    if (CUSTOM_SLIDE_TYPE_NAMES.includes(name)) continue;
    const keys = (def.fields || []).map((f) => f.key);
    assert.ok(!keys.includes('bgImage'), `${name} declares a legacy bgImage`);
    assert.ok(!keys.includes('bgAlt'), `${name} declares a legacy bgAlt`);
    // The shared slideBgImage field is added by withGlobalSlideFields.
    assert.ok(keys.includes('slideBgImage'), `${name} lacks slideBgImage`);
  }
});
