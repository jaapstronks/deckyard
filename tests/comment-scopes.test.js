/**
 * The two comment scopes are visible (D355, B747): the empty pane offers both
 * ways in, an anchored thread carries a pin glyph and "Show on slide", the
 * card on a spot is the pane's rich composer, the keyboard can place and
 * cancel a pin, and readers who do not place pins still see them.
 *
 * Run with: node --test tests/comment-scopes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { createCommentsPanel, createCommentsApi, createCommentMarkers } =
  await import('../client/views/comments/index.js');
const { createPreviewPanel } =
  await import('../client/views/editor/preview-panel.js');

const ANCHORED = {
  id: 'pin1',
  body: 'Source for this claim?',
  author: { id: 'u1', displayName: 'Ada' },
  status: 'open',
  createdAt: new Date().toISOString(),
  slideId: 's1',
  positionX: 40,
  positionY: 30,
  replies: [],
};
const SLIDE_LEVEL = {
  id: 'plain1',
  body: 'Overall: a stronger title.',
  author: { id: 'u1', displayName: 'Ada' },
  status: 'open',
  createdAt: new Date().toISOString(),
  slideId: 's1',
  positionX: null,
  positionY: null,
  replies: [],
};

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openPanel(comments, opts = {}) {
  const api = async (path) => {
    if (String(path).includes('/comments/counts')) return { counts: {} };
    if (String(path).includes('/comments')) {
      return { comments, openCount: comments.length };
    }
    return {};
  };
  const panel = createCommentsPanel({
    api,
    commentsApi: createCommentsApi({ api, presentationId: 'p1' }),
    presentationId: 'p1',
    pres: { id: 'p1', slides: [{ id: 's1' }] },
    user: { id: 'u1', email: 'ada@example.com' },
    getSelectedSlideId: () => 's1',
    ...opts,
  });
  document.body.append(panel.panelEl);
  panel.show();
  await tick();
  await tick();
  return panel;
}

test('the empty pane offers a comment here and a mark on a spot', async () => {
  let focused = 0;
  let marked = 0;
  const panel = await openPanel([], { onMarkSpot: () => marked++ });
  const buttons = [
    ...panel.panelEl.querySelectorAll('.comment-ways-in button'),
  ];
  assert.deepEqual(
    buttons.map((b) => b.textContent),
    ['Comment on this slide', 'Mark a spot'],
  );
  const input = panel.panelEl.querySelector('.comments-input-textarea');
  input.focus = () => focused++;
  buttons[0].click();
  buttons[1].click();
  assert.equal(focused, 1);
  assert.equal(marked, 1);
  panel.detach();
  panel.panelEl.remove();
});

test('without a canvas to pin on, the empty pane offers only the composer', async () => {
  const panel = await openPanel([]);
  const buttons = [
    ...panel.panelEl.querySelectorAll('.comment-ways-in button'),
  ];
  assert.deepEqual(
    buttons.map((b) => b.textContent),
    ['Comment on this slide'],
  );
  panel.detach();
  panel.panelEl.remove();
});

test('an anchored thread shows a pin glyph and "Show on slide"; a slide comment shows neither', async () => {
  const shown = [];
  const panel = await openPanel([ANCHORED, SLIDE_LEVEL], {
    onShowOnSlide: (c) => shown.push(c.id),
  });
  const pinned = panel.panelEl.querySelector('[data-comment-id="pin1"]');
  const plain = panel.panelEl.querySelector('[data-comment-id="plain1"]');
  assert.ok(pinned.classList.contains('is-anchored'));
  assert.equal(
    pinned.querySelector('.comment-anchor-glyph').getAttribute('aria-label'),
    'Marked on a spot of the slide',
  );
  pinned.querySelector('.comment-show-on-slide').click();
  assert.deepEqual(shown, ['pin1']);
  assert.ok(!plain.classList.contains('is-anchored'));
  assert.equal(plain.querySelector('.comment-anchor-glyph'), null);
  assert.equal(plain.querySelector('.comment-show-on-slide'), null);
  panel.detach();
  panel.panelEl.remove();
});

test('Escape leaves add mode; a press inside the open card is the card’s', () => {
  const containerEl = document.createElement('div');
  document.body.append(containerEl);
  let cancelled = 0;
  const markers = createCommentMarkers({
    containerEl,
    onCancelAddMode: () => cancelled++,
  });
  markers.enterAddMode();
  const card = document.createElement('div');
  card.className = 'positioned-comment-popup';
  const inCard = document.createElement('div');
  card.append(inCard);
  document.body.append(card);
  inCard.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(markers.isInAddMode(), true);
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(markers.isInAddMode(), false);
  assert.equal(cancelled, 1);
  card.remove();
  markers.detach();
  containerEl.remove();
});

test('read-only markers show pins but never enter add mode', () => {
  const containerEl = document.createElement('div');
  let selected = 0;
  const markers = createCommentMarkers({
    containerEl,
    readOnly: true,
    onPositionSelect: () => selected++,
  });
  markers.setComments([ANCHORED, SLIDE_LEVEL]);
  assert.equal(containerEl.querySelectorAll('.comment-marker').length, 1);
  markers.enterAddMode();
  containerEl.click();
  assert.equal(markers.isInAddMode(), false);
  assert.equal(selected, 0);
  assert.equal(markers.flash('pin1'), true);
  assert.ok(
    containerEl
      .querySelector('[data-comment-id="pin1"]')
      .classList.contains('is-flashing'),
  );
  markers.detach();
});

function makePreview({ support } = {}) {
  // The card posts only through the pane's support, which owns the refusal
  // sentence (B881); the transport is never its second route.
  const commentsApi = {
    listSlideComments: async () => [],
    createComment: async () => assert.fail('the card posted past the pane'),
  };
  const panel = createPreviewPanel({
    root: document.body,
    pres: { id: 'p1', slides: [{ id: 's1' }] },
    lockDocumentScroll: () => () => {},
    attachThumbScale: () => () => {},
    attachThumbScaleContain: () => () => {},
    renderSlideElement: () => document.createElement('div'),
    getSelectedSlideId: () => 's1',
    commentsApi,
    getAnchoredComposerSupport: () => support,
  });
  document.body.append(panel.previewEl);
  return { panel };
}

test('the keyboard places a pin in the middle and opens the rich composer; Escape cancels', async () => {
  const submitted = [];
  const support = {
    onSubmit: async (body, position) => submitted.push({ body, ...position }),
  };
  const { panel } = makePreview({ support });
  const btn = panel.previewEl.querySelector('.pin-comment-btn');
  assert.equal(btn.getAttribute('aria-label'), 'Mark a spot');

  // A click the keyboard made carries detail 0.
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  const card = panel.previewEl.querySelector('.positioned-comment-popup');
  assert.ok(card, 'the card opens without a pointer');
  assert.ok(card.querySelector('.comment-rich-input'), 'rich composer');
  assert.ok(card.querySelector('.comment-toolbar-btn'), 'Link');

  const input = card.querySelector('.comment-rich-input');
  input.textContent = 'Check this';
  [...card.querySelectorAll('button')]
    .find((b) => b.textContent === 'Post')
    .click();
  await tick();
  assert.deepEqual(submitted, [
    { body: 'Check this', positionX: 50, positionY: 50 },
  ]);
  assert.equal(
    panel.previewEl.querySelector('.positioned-comment-popup'),
    null,
  );
  assert.equal(panel.isCommentAddMode(), false);

  // Again, then Escape in the card cancels the card and the mode.
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  panel.previewEl
    .querySelector('.positioned-comment-popup .comment-rich-input')
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  assert.equal(
    panel.previewEl.querySelector('.positioned-comment-popup'),
    null,
  );
  assert.equal(panel.isCommentAddMode(), false);
  assert.equal(btn.getAttribute('aria-label'), 'Mark a spot');
  panel.previewEl.remove();
});

test('a refused anchored post shows inline in the card and keeps it open', async () => {
  const support = {
    onSubmit: async () => {
      throw new Error('This slide is not saved yet.');
    },
  };
  const { panel } = makePreview({ support });
  panel.startPinMode({ keyboard: true });
  const card = panel.previewEl.querySelector('.positioned-comment-popup');
  card.querySelector('.comment-rich-input').textContent = 'Hello';
  [...card.querySelectorAll('button')]
    .find((b) => b.textContent === 'Post')
    .click();
  await tick();
  assert.match(card.textContent, /This slide is not saved yet\./);
  assert.ok(panel.previewEl.querySelector('.positioned-comment-popup'));
  panel.previewEl.remove();
});

test('a failed post from the card shows the pane’s copy, or the server sentence (B881)', async () => {
  let failure;
  const api = async (path, opts = {}) => {
    if (opts.method === 'POST') throw failure;
    if (String(path).includes('/comments/counts')) return { counts: {} };
    if (String(path).includes('/comments'))
      return { comments: [], openCount: 0 };
    return {};
  };
  const pane = await openPanel([], {
    api,
    commentsApi: createCommentsApi({ api, presentationId: 'p1' }),
  });
  const { panel } = makePreview({ support: pane.anchoredComposerSupport });

  const post = async () => {
    panel.startPinMode({ keyboard: true });
    const card = panel.previewEl.querySelector('.positioned-comment-popup');
    card.querySelector('.comment-rich-input').textContent = 'Hello';
    [...card.querySelectorAll('button')]
      .find((b) => b.textContent === 'Post')
      .click();
    await tick();
    await tick();
    return card.querySelector('.inline-error').textContent;
  };

  // What `api()` throws for a 500 without a sentence and for a network error.
  failure = Object.assign(new Error('Request failed (500)'), {
    statusCode: 500,
    body: { ok: false, error: 'internal' },
  });
  assert.equal(await post(), 'Failed to post comment');
  failure = new TypeError('Failed to fetch');
  assert.equal(await post(), 'Failed to post comment');
  failure = Object.assign(new Error('Comments are closed'), {
    statusCode: 403,
    body: { ok: false, error: 'forbidden', message: 'Comments are closed' },
  });
  assert.equal(await post(), 'Comments are closed');
  panel.previewEl.remove();
  pane.panelEl.remove();
});

test('the in-app viewer shows the slide’s pins read-only', async () => {
  const { createViewerPreview } =
    await import('../client/views/viewer/viewer-preview.js');
  const asked = [];
  const preview = createViewerPreview({
    pres: {
      id: 'p1',
      slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
    },
    getSelectedSlideId: () => 's1',
    commentsApi: {
      listSlideComments: async (slideId) => {
        asked.push({ slideId });
        return [ANCHORED, SLIDE_LEVEL];
      },
    },
  });
  document.body.append(preview.previewEl);
  preview.rerenderPreview();
  await preview.refreshMarkers();
  const wrap = preview.previewEl.querySelector('.viewer-slide-wrap');
  const pins = wrap.querySelectorAll('.comment-marker');
  assert.equal(pins.length, 1);
  assert.equal(pins[0].dataset.commentId, 'pin1');
  assert.deepEqual(asked.at(-1), { slideId: 's1' });
  wrap.click();
  assert.ok(!wrap.classList.contains('is-add-comment-mode'));
  assert.equal(preview.showCommentMarker('pin1'), true);
  preview.detach();
  preview.previewEl.remove();
});
