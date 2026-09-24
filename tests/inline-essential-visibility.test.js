/**
 * `essential` decides what an empty field shows without hover (B435, D211,
 * D212; Test 2 of the brief).
 *
 * An empty `essential` field asks for itself in edit mode: a text field whose
 * element the renderer draws anyway gets an in-box placeholder ("Click to add
 * title"), an essential image frame its "+ Add image" and an essential list
 * its "+ Add", both marked to show without hover. An empty field that is not
 * essential stays a chip that appears on hover.
 *
 * The real inline editor runs on real renders in jsdom; the "without hover"
 * half is the stylesheet, read below.
 *
 * Run with: node --test tests/inline-essential-visibility.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/editor/p1',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { renderSlideElement, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');
const { createInlineEditor } =
  await import('../client/views/editor/inline-edit/inline-editor.js');

/** Mount the inline editor on one client-rendered slide. */
function mount(slide, getSlideDef = (type) => SLIDE_TYPES[type]) {
  const stage = document.createElement('div');
  const thumb = document.createElement('div');
  stage.append(thumb);
  document.body.append(stage);
  const pres = { id: 'p1', slides: [slide] };
  let editor;
  const rerenderPreview = () => {
    if (editor.isEditing()) return;
    thumb.innerHTML = '';
    thumb.append(
      renderSlideElement(slide, { mode: 'edit', lang: NO_DECK_LANG }),
    );
    editor.refresh();
  };
  editor = createInlineEditor({
    thumb,
    previewStage: stage,
    getSlide: () => slide,
    getSlideDef,
    getCanEdit: () => true,
    markDirty: () => {},
    rerenderPreview,
    openImagePicker: () => {},
    pres,
  });
  rerenderPreview();
  return {
    thumb,
    teardown: () => {
      editor.detach();
      stage.remove();
    },
  };
}

test('an empty essential title gets an in-box placeholder, not a chip', () => {
  const env = mount({ id: 's', type: 'title-slide', content: { title: '' } });
  try {
    const title = env.thumb.querySelector('[data-inline-field="title"]');
    assert.ok(title.classList.contains('ie-placeholder'));
    assert.match(title.getAttribute('data-ie-placeholder'), /title/i);
    assert.equal(
      env.thumb.querySelector('[data-ie-ghost="title"]'),
      null,
      'the placeholder replaces a chip, it does not sit beside one',
    );
  } finally {
    env.teardown();
  }
});

test('a field that has both a placeholder and a declared ghost shows only the placeholder', () => {
  // title-slide declares no title ghost; a fork descriptor (or PR 2's
  // HEADER_GHOSTS types) can. The placeholder is the answer, not both.
  const base = SLIDE_TYPES['title-slide'];
  const def = {
    ...base,
    inline: {
      ghosts: [
        { field: 'title', anchors: [{ sel: '.tsu-content', pos: 'prepend' }] },
      ],
    },
  };
  const env = mount(
    { id: 's', type: 'title-slide', content: { title: '' } },
    () => def,
  );
  try {
    const title = env.thumb.querySelector('[data-inline-field="title"]');
    assert.ok(title.classList.contains('ie-placeholder'));
    assert.equal(env.thumb.querySelector('[data-ie-ghost="title"]'), null);
  } finally {
    env.teardown();
  }
});

test('a filled essential title carries no placeholder', () => {
  const env = mount({ id: 's', type: 'title-slide', content: { title: 'Hi' } });
  try {
    const title = env.thumb.querySelector('[data-inline-field="title"]');
    assert.equal(title.classList.contains('ie-placeholder'), false);
  } finally {
    env.teardown();
  }
});

test('an empty optional field that is not essential stays a hover chip', () => {
  const env = mount({ id: 's', type: 'title-slide', content: { title: 'Hi' } });
  try {
    for (const field of ['subheading', 'meta']) {
      const chip = env.thumb.querySelector(`[data-ie-ghost="${field}"]`);
      assert.ok(chip, `${field} has a ghost chip`);
      assert.equal(chip.classList.contains('is-essential'), false);
      assert.equal(chip.getAttribute('aria-label'), chip.textContent.slice(1));
    }
  } finally {
    env.teardown();
  }
});

test('an empty essential image frame asks for its image without hover', () => {
  const env = mount({ id: 's', type: 'image-slide', content: { image: '' } });
  try {
    const hint = env.thumb.querySelector('.ie-media-hint');
    assert.ok(hint, 'the empty frame has its "+ Add image"');
    assert.ok(hint.classList.contains('is-essential'));
  } finally {
    env.teardown();
  }
});

test('an empty essential list offers its first item without hover', () => {
  const env = mount({
    id: 's',
    type: 'team-cards-slide',
    content: { title: 'Team', members: [] },
  });
  try {
    const add = env.thumb.querySelector('.ie-card-add');
    assert.ok(add, 'the list has its "+ Add"');
    assert.ok(add.classList.contains('is-essential'));
    // The always-visible button stands where the renderer's empty-state note
    // is; the container is marked so the note steps aside (the stylesheet).
    assert.ok(
      env.thumb
        .querySelector('.team-cards-grid')
        .classList.contains('ie-essential'),
    );
  } finally {
    env.teardown();
  }
});

test('the stylesheet shows is-essential without hover and hides other chips until then', () => {
  const css = readFileSync(
    'client/styles/base/04-editor-and-misc/105-inline-edit.css',
    'utf8',
  );
  const block = (selector) => {
    const i = css.indexOf(selector);
    assert.ok(i >= 0, `rule for ${selector}`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(block('.ie-overlay .ie-ghost,\n'), /opacity:\s*0;/);
  assert.match(block('.ie-overlay .ie-ghost.is-essential,'), /opacity:\s*1;/);
  assert.doesNotMatch(
    block('.ie-overlay .ie-ghost.is-essential,'),
    /:hover/,
    'is-essential is shown without hover',
  );
  assert.match(
    block('.thumb.is-inline-edit .ie-placeholder:empty::before'),
    /content:\s*attr\(data-ie-placeholder\)/,
  );
  assert.match(
    block(
      '.thumb.is-inline-edit .team-cards-grid.ie-essential + .team-cards-empty',
    ),
    /opacity:\s*0;/,
    'the empty-state note steps aside for the essential "+ Add"',
  );
});
