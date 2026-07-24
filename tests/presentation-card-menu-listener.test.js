/**
 * Regression: the deck-card "more actions" menu must not leak a document click
 * listener.
 *
 * The outside-click handler used to be attached to `document` unconditionally on
 * every `renderCard`, and never removed — so a long deck list accumulated one
 * permanent document listener per card (each firing on every click). The menu
 * now attaches the listener only while it is open and removes it on close.
 *
 * Run with: node --test tests/presentation-card-menu-listener.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopResizeObserver;
window.ResizeObserver = NoopResizeObserver;
globalThis.IntersectionObserver = undefined;
window.IntersectionObserver = undefined;

// Count live document 'click' listeners by wrapping add/removeEventListener.
let liveClickListeners = 0;
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);
document.addEventListener = (type, fn, opts) => {
  if (type === 'click') liveClickListeners += 1;
  return origAdd(type, fn, opts);
};
document.removeEventListener = (type, fn, opts) => {
  if (type === 'click') liveClickListeners -= 1;
  return origRemove(type, fn, opts);
};

const { createCardRenderer } = await import('../client/views/list/presentation-card.js');

function renderOneCard() {
  const { renderCard } = createCardRenderer({
    api: async () => ({}),
    nav: () => {},
    detachThumbs: [],
  });
  return renderCard({
    id: 'deck-1',
    title: 'Deck one',
    theme: 'default',
    modified: new Date().toISOString(),
    hasSlides: true,
  });
}

test('rendering a card attaches no document click listener up front', () => {
  const before = liveClickListeners;
  const card = renderOneCard();
  document.body.append(card);
  assert.equal(
    liveClickListeners,
    before,
    'no document click listener until the menu is opened'
  );
  card.remove();
});

test('opening the menu attaches one listener; an outside click removes it', () => {
  const before = liveClickListeners;
  const card = renderOneCard();
  document.body.append(card);

  const moreBtn = card.querySelector('.presentation-card-more');
  const menu = card.querySelector('.presentation-card-menu');
  assert.ok(moreBtn && menu, 'card has a more button and a menu');

  moreBtn.click();
  assert.equal(menu.classList.contains('is-open'), true, 'menu opens on click');
  assert.equal(liveClickListeners, before + 1, 'exactly one document listener while open');

  // Outside click closes the menu and releases the listener.
  const outside = new dom.window.MouseEvent('click', { bubbles: true });
  document.body.dispatchEvent(outside);
  assert.equal(menu.classList.contains('is-open'), false, 'menu closes on outside click');
  assert.equal(liveClickListeners, before, 'listener removed on close — no leak');

  card.remove();
});

test('toggling the menu closed with the button also releases the listener', () => {
  const before = liveClickListeners;
  const card = renderOneCard();
  document.body.append(card);
  const moreBtn = card.querySelector('.presentation-card-more');

  moreBtn.click(); // open
  assert.equal(liveClickListeners, before + 1);
  moreBtn.click(); // toggle closed
  assert.equal(liveClickListeners, before, 'closing via the button removes the listener');

  card.remove();
});

test('many cards do not accumulate document click listeners', () => {
  const before = liveClickListeners;
  for (let i = 0; i < 25; i += 1) document.body.append(renderOneCard());
  assert.equal(liveClickListeners, before, '25 rendered cards add zero standing listeners');
});
