/**
 * The affordance matrix of the read-only editor branch (B151).
 *
 * `client/views/viewer/` is the surface that decides what a `view`- or
 * `comment`-permission collaborator gets to see, and it is reachable from
 * exactly one place: `client/views/editor/render-editor.js`, which routes on
 * `pres._userPermission`. This file drives that real entry — `renderEditor`,
 * not the viewer factories in isolation — so the routing decision and the
 * affordances it produces are pinned together.
 *
 * `docs/reference/permission-model.md` does not describe these affordances
 * normatively; it stops at the ladder and the three advisory mirrors. So this
 * is a pin on the current rendering, not a transcription of a written
 * contract: it records what `view` and `comment` see today, and fails loudly
 * when that changes. The absences matter as much as the presences — an editor
 * affordance leaking into the viewer is the failure mode worth catching, so
 * every row asserts both halves.
 *
 * Transport is the only fake: `globalThis.fetch` is stubbed, and the real
 * `api()` helper, theme loader, slide runtime and comments panel all run.
 *
 * Run with: node --test tests/viewer-affordance-matrix.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
// `navigator` is a getter-only global in Node; jsdom's is close enough not to
// need overriding for this surface.
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}
globalThis.matchMedia = dom.window.matchMedia;
dom.window.open = () => null;

// jsdom ships no EventSource, and the comments panel opens one. A stub that
// stays silent keeps the real code path intact — without it the connection
// throws, the reconnect backoff schedules timers, and the suite hangs on them
// rather than on anything the viewer does.
globalThis.EventSource = class {
  constructor() {
    this.readyState = 0;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
};

const DECK_ID = 'deck-1';

const SLIDES = [
  { id: 's1', type: 'title', title: 'One', subtitle: 'first' },
  { id: 's2', type: 'title', title: 'Two', subtitle: 'second' },
];

/** Every request the fake transport saw, so a test can assert traffic. */
let requestLog = [];

/**
 * Serve the handful of endpoints this surface touches. Anything else answers
 * an empty object rather than a 404, so an unrelated new call does not fail
 * the matrix — the matrix asserts on the DOM, not on transport coverage.
 */
function fakeFetch(permission) {
  return async (input, init = {}) => {
    const url = String(input);
    requestLog.push(`${init.method || 'GET'} ${url}`);

    // Node's own Response, not jsdom's — jsdom does not ship fetch's classes.
    const json = (body) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (url.includes(`/api/presentations/${DECK_ID}/comments/counts`)) {
      return json({ counts: {} });
    }
    if (url.includes(`/api/presentations/${DECK_ID}/comments`)) {
      return json({ comments: [] });
    }
    if (url.includes(`/api/presentations/${DECK_ID}`)) {
      return json({
        id: DECK_ID,
        title: 'A shared deck',
        theme: 'default',
        slides: structuredClone(SLIDES),
        _userPermission: permission,
      });
    }
    if (url.includes('/themes/')) {
      return json({ id: 'default', label: 'Default', cssVars: {} });
    }
    return json({});
  };
}

/**
 * Mount the real entry for a permission and hand back the viewer shell.
 * Returns the detach function so each test can tear its own mount down —
 * the controller registers a document-level keydown listener and the comments
 * panel polls, and neither should survive into the next row of the matrix.
 */
async function mountAs(permission) {
  document.body.innerHTML = '';
  requestLog = [];
  globalThis.fetch = fakeFetch(permission);

  const root = document.createElement('div');
  document.body.append(root);

  const { renderEditor } =
    await import('../client/views/editor/render-editor.js');
  const detach = await renderEditor(root, DECK_ID, {
    user: { id: 'user-1', email: 'viewer@example.com' },
  });
  // Let the comments panel's initial load settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { root, detach, shell: root.querySelector('.viewer-shell') };
}

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// The routing decision: which permissions reach this surface at all
// ---------------------------------------------------------------------------

test('view and comment route into the viewer, and land on a real shell', async () => {
  for (const permission of ['view', 'comment']) {
    const { shell, detach } = await mountAs(permission);
    assert.ok(shell, `${permission} renders the viewer shell`);
    assert.ok(
      shell.querySelector('.viewer-topbar'),
      `${permission} gets a topbar`,
    );
    assert.ok(
      shell.querySelector('.viewer-slides-panel'),
      `${permission} gets the slides panel`,
    );
    assert.ok(
      shell.querySelector('.viewer-preview'),
      `${permission} gets the preview`,
    );
    detach();
  }
});

test('edit never reaches the viewer', async () => {
  // The editor is far too heavy to boot in jsdom, and booting it is not the
  // point: what matters is that the read-only branch is not taken. Whatever
  // the editor does after the fork — mount or throw — no viewer shell exists.
  let detach = () => {};
  try {
    const mounted = await mountAs('edit');
    detach = mounted.detach || detach;
  } catch {
    // the editor failing to boot under jsdom is not this test's business
  }
  assert.equal(
    $('.viewer-shell'),
    null,
    'the edit permission is never served the read-only viewer',
  );
  try {
    detach();
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// The matrix: comment-only affordances
// ---------------------------------------------------------------------------

test('only comment gets the comments affordances', async () => {
  const view = await mountAs('view');
  assert.equal(
    view.shell.querySelector('.viewer-comments-btn'),
    null,
    'view gets no comments button',
  );
  assert.equal(
    view.shell.querySelector('.comments-panel'),
    null,
    'view gets no comments panel',
  );
  assert.equal(
    requestLog.filter((r) => r.includes('/comments')).length,
    0,
    'view never even asks the comments endpoint',
  );
  view.detach();

  const comment = await mountAs('comment');
  assert.ok(
    comment.shell.querySelector('.viewer-comments-btn'),
    'comment gets the comments button',
  );
  assert.ok(
    comment.shell.querySelector('.comments-panel'),
    'comment gets the comments panel',
  );
  assert.ok(
    requestLog.some((r) => r.includes('/comments')),
    'comment loads comments on mount',
  );
  comment.detach();
});

test('the comments panel starts hidden for comment permission', async () => {
  const { shell, detach } = await mountAs('comment');
  const panel = shell.querySelector('.comments-panel');
  assert.equal(
    panel.style.display,
    'none',
    'commenting is an affordance to open, not a pane forced on the reader',
  );
  detach();
});

test('the one place a comment-permission user may type is the comment box', async () => {
  // The absence rows below scope themselves to the deck regions on purpose:
  // this role does get an editable element, and it belongs to the comments
  // panel. Pin where it lives, so "nothing editable" stays a claim about the
  // slides rather than a claim the comment box would quietly break.
  const { shell, detach } = await mountAs('comment');
  const editable = shell.querySelector('[contenteditable="true"]');
  assert.ok(editable, 'comment permission gets a comment input');
  assert.ok(
    editable.closest('.comments-panel'),
    'and it sits in the comments panel, not in the deck',
  );
  detach();
});

// ---------------------------------------------------------------------------
// The matrix: what both roles get
// ---------------------------------------------------------------------------

test('both roles get navigation, present and back — the read affordances', async () => {
  for (const permission of ['view', 'comment']) {
    const { shell, detach } = await mountAs(permission);

    const items = shell.querySelectorAll('.viewer-slides-panel .slide-item');
    assert.equal(items.length, SLIDES.length, `${permission} sees every slide`);

    const counter = shell.querySelector('.viewer-counter');
    assert.equal(counter.textContent, '1 / 2', `${permission} sees a counter`);

    const navButtons = shell.querySelectorAll('.viewer-nav-btn');
    assert.equal(navButtons.length, 2, `${permission} gets prev/next`);
    assert.equal(navButtons[0].disabled, true, 'prev is clamped on slide 1');
    assert.equal(navButtons[1].disabled, false, 'next is available');

    const buttonTexts = [
      ...shell.querySelectorAll('.viewer-topbar button'),
    ].map((b) => b.textContent);
    assert.ok(
      buttonTexts.some((txt) => /present/i.test(txt)),
      `${permission} may present the deck`,
    );
    assert.ok(
      shell.querySelector('.viewer-topbar button[aria-label]'),
      `${permission} gets the back button`,
    );
    detach();
  }
});

test('each role wears its own permission badge', async () => {
  for (const permission of ['view', 'comment']) {
    const { shell, detach } = await mountAs(permission);
    const badge = shell.querySelector('.viewer-permission-badge');
    assert.ok(badge, `${permission} sees a permission badge`);
    assert.ok(
      badge.classList.contains(`viewer-permission-badge--${permission}`),
      `the badge is keyed on the role, not generic`,
    );
    assert.ok(badge.textContent.trim(), 'the badge carries a label');
    detach();
  }
});

// ---------------------------------------------------------------------------
// The half that counts: editor affordances that must not leak in
// ---------------------------------------------------------------------------

/**
 * Selectors the editor really renders, so an absence assertion here is a
 * statement about the viewer rather than about a name nothing uses:
 * `topbar.js` (save status, undo/redo, analytics), `slides-panel.js`
 * (the add-slide drawer) and `editor-form.js` (the inspector tab bar).
 */
const EDITOR_ONLY = [
  '.topbar-save-status',
  '.topbar-undo-btn',
  '.topbar-redo-btn',
  '.topbar-analytics-btn',
  '.slide-add',
  '.slide-add-drawer',
  '.inspector-tabs',
];

test('no editor affordance leaks into either role', async () => {
  for (const permission of ['view', 'comment']) {
    const { detach } = await mountAs(permission);
    for (const sel of EDITOR_ONLY) {
      assert.equal(
        $(sel),
        null,
        `${permission} must not get the editor's ${sel}`,
      );
    }
    for (const region of ['.viewer-preview', '.viewer-slides-panel']) {
      assert.equal(
        $(`${region} [contenteditable="true"]`),
        null,
        `${permission} gets nothing editable inside ${region}`,
      );
    }
    detach();
  }
});

test('the slide list is a navigator, not a manipulator', async () => {
  for (const permission of ['view', 'comment']) {
    const { shell, detach } = await mountAs(permission);
    const items = [...shell.querySelectorAll('.slide-item')];
    for (const item of items) {
      assert.notEqual(
        item.getAttribute('draggable'),
        'true',
        `${permission} cannot reorder slides by dragging`,
      );
      assert.equal(
        item.querySelector('input[type="checkbox"]'),
        null,
        `${permission} gets no multi-select checkbox`,
      );
    }
    detach();
  }
});

// ---------------------------------------------------------------------------
// Lifecycle: the affordances leave when the view does
// ---------------------------------------------------------------------------

test('detach takes the keyboard navigation with it', async () => {
  const { shell, detach } = await mountAs('view');
  const counter = shell.querySelector('.viewer-counter');

  document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }),
  );
  assert.equal(
    counter.textContent,
    '2 / 2',
    'arrow keys navigate while mounted',
  );

  detach();
  const before = counter.textContent;
  document.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }),
  );
  assert.equal(
    counter.textContent,
    before,
    'a detached viewer no longer answers the keyboard',
  );
});
