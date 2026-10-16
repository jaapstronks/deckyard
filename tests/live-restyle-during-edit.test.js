/**
 * A style or layout commit during an inline edit shows on the canvas at once
 * (B719).
 *
 * The editor does not remount the canvas while a field is being edited, so
 * `restyleLiveSlide()` carries the commit over as a class/style delta onto the
 * living slide. Pinned here under jsdom:
 *
 *   1. Text size L on the title-slide title, the content-slide title and the
 *      content-slide body lands as `tf-size-lg` on the live field.
 *   2. Layout → Centred (`titleBlockAlign`) lands as the block class on the
 *      live slide root.
 *   3. The edited text node survives (the caret lives in it), and what the
 *      canvas added after mounting - the inline editor's `ie-*` classes, the
 *      theme variables on the root - is left alone.
 *   4. Taking a style back removes its class again.
 *
 * Run with: node --test tests/live-restyle-during-edit.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initSanitizer } from '../shared/sanitize.js';
import { renderSlideHtml } from '../shared/slide-types.js';

// The server-side sanitizer first: with a global `window` it looks for a
// browser DOMPurify instead.
await initSanitizer();

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/abc',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { restyleLiveSlide } =
  await import('../client/lib/slide-runtime/live-restyle.js');

/** Mount `slide` the way the canvas does, plus the canvas's own additions. */
function mountLive(slide) {
  const wrap = document.createElement('div');
  wrap.innerHTML = renderSlideHtml(slide, { mode: 'edit', lang: 'en' }).trim();
  const el = wrap.firstElementChild;
  el.style.setProperty('--t-color-bg', '#123456');
  document.body.replaceChildren(el);
  return el;
}

function field(root, key) {
  return root.querySelector(`[data-inline-field="${key}"]`);
}

const titleSlide = {
  id: 's1',
  type: 'title-slide',
  content: { title: 'Hello world', subheading: 'Sub' },
};
const contentSlide = {
  id: 's2',
  type: 'content-slide',
  content: { title: 'A title', body: 'Some body text' },
};

for (const [slide, key] of [
  [titleSlide, 'title'],
  [contentSlide, 'title'],
  [contentSlide, 'body'],
]) {
  test(`Text size L on ${slide.type} ${key} lands on the live field`, () => {
    const live = mountLive(slide);
    const target = field(live, key);
    assert.ok(target, `${slide.type} renders a ${key} field`);
    target.classList.add('ie-editing');
    const textNode = target.firstChild;

    const after = structuredClone(slide);
    after.content.textStyles = { [key]: { size: 'lg' } };
    assert.equal(
      restyleLiveSlide(live, slide, after, { mode: 'edit', lang: 'en' }),
      true,
    );

    assert.ok(target.classList.contains('tf-size-lg'));
    assert.ok(target.classList.contains('ie-editing'), 'editor class stays');
    assert.equal(field(live, key), target, 'same element, not remounted');
    assert.equal(target.firstChild, textNode, 'the caret text node survives');
    assert.equal(live.style.getPropertyValue('--t-color-bg'), '#123456');

    assert.equal(
      restyleLiveSlide(live, after, slide, { mode: 'edit', lang: 'en' }),
      true,
    );
    assert.ok(!target.classList.contains('tf-size-lg'), 'taken back');
    assert.ok(target.classList.contains('ie-editing'));
  });
}

test('Layout → Centred during an edit centres the block on the live root', () => {
  const live = mountLive(titleSlide);
  const title = field(live, 'title');
  const textNode = title.firstChild;
  const after = structuredClone(titleSlide);
  after.content.titleBlockAlign = 'center';
  const fresh = document.createElement('div');
  fresh.innerHTML = renderSlideHtml(after, { mode: 'edit', lang: 'en' }).trim();
  const added = [...fresh.firstElementChild.classList].filter(
    (c) => !live.classList.contains(c),
  );
  assert.ok(added.length, 'the centred block renders another root class');

  assert.equal(
    restyleLiveSlide(live, titleSlide, after, { mode: 'edit', lang: 'en' }),
    true,
  );
  for (const c of added) assert.ok(live.classList.contains(c), c);
  assert.equal(title.firstChild, textNode);
});

test('nothing to carry over is a no-op', () => {
  const live = mountLive(contentSlide);
  const before = live.outerHTML;
  assert.equal(
    restyleLiveSlide(live, contentSlide, structuredClone(contentSlide), {
      mode: 'edit',
      lang: 'en',
    }),
    false,
  );
  assert.equal(live.outerHTML, before);
});
