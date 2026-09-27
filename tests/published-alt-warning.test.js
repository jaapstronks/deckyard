/**
 * The editor's warning on a published deck with a picture without alt text
 * (B331, D164): up while the published deck has one, gone once the alt is
 * there or the deck is no longer published, fed by the same
 * `findUnnamedImages` as the publish gate.
 *
 * Run with: node --test tests/published-alt-warning.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');
const { findUnnamedImages } = await import('../shared/unnamed-images.js');
const { assertImagesNamed } =
  await import('../server/services/publish-alt-check.js');
const { createPublishedAltWarning } =
  await import('../client/views/editor/published-alt-warning.js');

const imageSlide = (id, content) => ({ id, type: 'image-slide', content });

function mount(pres, onGoToSlide) {
  const w = createPublishedAltWarning({
    pres,
    slideTypes: SLIDE_TYPES,
    onGoToSlide,
  });
  w.sync();
  return w;
}

test('an unpublished deck with a picture without alt shows no warning', () => {
  const pres = { id: 'd', slides: [imageSlide('a', { image: '/x.png' })] };
  assert.equal(mount(pres).el.hidden, true);
});

test('a published deck warns while a picture has no alt, and stops once it has one', () => {
  const pres = {
    id: 'd',
    published: { id: 'p1', slug: 'deck' },
    slides: [imageSlide('a', { image: '/x.png', alt: 'A cat' })],
  };
  const w = mount(pres);
  assert.equal(w.el.hidden, true, 'named picture: no warning');

  // The alt is removed after publishing: the live deck now has the problem.
  delete pres.slides[0].content.alt;
  w.sync();
  assert.equal(w.el.hidden, false);
  assert.equal(w.el.getAttribute('role'), 'status');
  assert.match(w.el.textContent, /an image on it has no alt text/);

  // The alt comes back: the warning goes away by itself.
  pres.slides[0].content.alt = 'A cat';
  w.sync();
  assert.equal(w.el.hidden, true);
});

test('unpublishing takes the warning away', () => {
  const pres = {
    id: 'd',
    published: { id: 'p1', slug: 'deck' },
    slides: [imageSlide('a', { image: '/x.png' })],
  };
  const w = mount(pres);
  assert.equal(w.el.hidden, false);
  delete pres.published;
  w.sync();
  assert.equal(w.el.hidden, true);
});

test('the warning counts what the publish gate counts, and jumps to the first', () => {
  const pres = {
    id: 'd',
    published: { id: 'p1', slug: 'deck' },
    slides: [
      imageSlide('a', { image: '/x.png', alt: 'fine' }),
      imageSlide('b', { image: '/x.png' }),
      imageSlide('c', { image: '/x.png', imageRole: 'decorative' }),
      imageSlide('e', { image: '/y.png' }),
      {
        ...imageSlide('f', { image: '/z.png' }),
        visibility: { hideInPublished: true },
      },
    ],
  };
  const jumped = [];
  const w = mount(pres, (id) => jumped.push(id));
  const gate = findUnnamedImages(pres, SLIDE_TYPES);
  assert.equal(gate.length, 2);
  assert.throws(
    () => assertImagesNamed(pres, SLIDE_TYPES),
    (err) => err.code === 'missing_alt' && err.details.count === gate.length,
  );
  assert.match(w.el.textContent, /2 images on it have no alt text/);
  const go = w.el.querySelector('button');
  assert.equal(go.textContent, 'Go to slide 2');
  go.click();
  assert.deepEqual(jumped, ['b']);
});

test('the active version is read from the slides being edited', () => {
  // The editor edits pres.slides and mirrors it into the active version on
  // save; between the two, the version entry lags. The warning follows the
  // edit, not the stale entry.
  const stale = [imageSlide('a', { image: '/x.png', alt: 'A' })];
  const pres = {
    id: 'd',
    published: { id: 'p1', slug: 'deck' },
    i18n: { active: 'nl', versions: { nl: { slides: stale } } },
    slides: [imageSlide('a', { image: '/x.png' })],
  };
  const w = mount(pres, () => {});
  assert.equal(w.el.hidden, false);
  assert.equal(w.el.querySelector('button').textContent, 'Go to slide 1');
});

test('a picture only in another version names that version on the jump', () => {
  const pres = {
    id: 'd',
    published: { id: 'p1', slug: 'deck' },
    i18n: {
      active: 'nl',
      versions: {
        nl: { slides: [imageSlide('a', { image: '/x.png', alt: 'Kat' })] },
        'en-GB': { slides: [imageSlide('a', { image: '/x.png' })] },
      },
    },
    slides: [imageSlide('a', { image: '/x.png', alt: 'Kat' })],
  };
  const w = mount(pres, () => {});
  assert.equal(w.el.hidden, false);
  assert.equal(
    w.el.querySelector('button').textContent,
    'Go to slide 1 (en-GB)',
  );
});
