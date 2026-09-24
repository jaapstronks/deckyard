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
// The fork-stable definitions: a checkout's custom types carry their own
// audit, and an override must not change what core declares.
const { CORE_SLIDE_TYPE_DEFS } =
  await import('../shared/slide-types/registry.js');
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

/**
 * The audit (B435 PR 2) as a table: every `essential` field of every core
 * type, and what its empty state shows without hover. The table is the
 * reviewable record (docs/reference/essential-fields.md carries the reasons);
 * the test below holds the schema to it in both directions and renders each
 * row.
 *
 * - `placeholder`: the renderer draws the field's element even when empty,
 *   which gets the in-box "Add …" placeholder.
 * - `chip`: the renderer omits the empty element; its ghost chip is marked
 *   to show without hover.
 * - `add`: an empty list; its "+ Add" is marked to show without hover.
 * - `hint`: an empty flat image frame; its "+ Add image" likewise.
 * - a selector: the field has no inline affordance (set in the inspector, or
 *   an image list whose empty frames the renderer draws itself); the
 *   renderer's own empty state, named here, is what asks for it.
 */
const ESSENTIAL = {
  'callout-slide.body': 'placeholder',
  'chapter-title-slide.title': 'placeholder',
  'chart-slide.title': 'placeholder',
  'chart-slide.data': '.chart-error',
  'comparison-slide.leftTitle': 'chip',
  'comparison-slide.leftBody': 'chip',
  'comparison-slide.rightTitle': 'chip',
  'comparison-slide.rightBody': 'chip',
  'content-slide.title': 'placeholder',
  'content-slide.body': 'placeholder',
  'custom-html-slide.html': '.custom-html-empty',
  'cycle-slide.title': 'chip',
  'cycle-slide.items': 'add',
  'embed-slide.embedUrl': '.embed-empty',
  'end-slide.title': 'placeholder',
  'feedback-slide.question': 'placeholder',
  'funnel-slide.title': 'chip',
  'funnel-slide.items': 'add',
  'gallery-slide.images': 'add',
  'icon-card-grid-slide.title': 'placeholder',
  'icon-card-grid-slide.items': 'add',
  'image-set-slide.title': 'placeholder',
  'image-set-slide.body': 'placeholder',
  'image-set-slide.images': '.image-placeholder.is-empty',
  'image-slide.image': 'hint',
  'image-text-slide.title': 'placeholder',
  'image-text-slide.body': 'placeholder',
  'image-text-slide.image': 'hint',
  'kpi-metrics-slide.metrics': 'add',
  'likert-slide.question': 'placeholder',
  'likert-slide.options': 'add',
  'likert-slider-slide.question': 'placeholder',
  'list-slide.title': 'placeholder',
  'list-slide.items': 'add',
  'logo-wall-slide.logos': '.logo-wall-placeholder.is-empty',
  'matrix-slide.cells': 'add',
  'poll-slide.question': 'placeholder',
  'poll-slide.options': 'add',
  'process-slide.title': 'chip',
  'process-slide.items': 'add',
  'pyramid-slide.title': 'chip',
  'pyramid-slide.levels': 'add',
  'quote-slide.quote': 'placeholder',
  'table-slide.title': 'placeholder',
  'table-slide.rows': 'add',
  'team-cards-slide.members': 'add',
  'text-blocks-slide.title': 'placeholder',
  'text-blocks-slide.rows': 'add',
  'timeline-slide.items': 'add',
  'title-slide.title': 'placeholder',
  'video-slide.source': '.video-empty',
};

test('the essential fields of the core types are exactly the audit table', () => {
  const declared = Object.entries(CORE_SLIDE_TYPE_DEFS)
    .flatMap(([name, def]) =>
      (def.fields || [])
        .filter((f) => f.essential === true)
        .map((f) => `${name}.${f.key}`),
    )
    .sort();
  assert.deepEqual(declared, Object.keys(ESSENTIAL).sort());
});

for (const [row, expect] of Object.entries(ESSENTIAL)) {
  test(`empty ${row} asks for itself without hover (${expect})`, () => {
    const [type, key] = row.split('.');
    const def = CORE_SLIDE_TYPE_DEFS[type];
    const field = def.fields.find((f) => f.key === key);
    const content = structuredClone(def.defaults || {});
    content[key] = field.type === 'items' ? [] : '';
    const env = mount({ id: 's', type, content });
    try {
      const q = (sel) => env.thumb.querySelector(sel);
      if (expect === 'placeholder') {
        const el = q(`[data-inline-field="${key}"]`);
        assert.ok(
          el?.classList.contains('ie-placeholder'),
          'in-box placeholder',
        );
        assert.equal(el.innerHTML, '', 'empty, so the :empty rule shows it');
      } else if (expect === 'chip') {
        assert.ok(q(`.ie-ghost.is-essential[data-ie-ghost="${key}"]`));
      } else if (expect === 'add') {
        assert.ok(q('.ie-card-add.is-essential'));
      } else if (expect === 'hint') {
        assert.ok(q('.ie-media-hint.is-essential'));
      } else {
        assert.ok(q(expect), `the renderer's empty state ${expect}`);
      }
      // The other half of Test 2: whatever else shows a chip here is not
      // essential and waits for hover.
      for (const chip of env.thumb.querySelectorAll('.ie-ghost.is-essential')) {
        const f = chip.getAttribute('data-ie-ghost');
        assert.equal(
          def.fields.find((x) => x.key === f)?.essential,
          true,
          `${f} is not essential but shows without hover`,
        );
      }
    } finally {
      env.teardown();
    }
  });
}
