import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver = undefined;

const { createCardRenderer } =
  await import('../client/views/list/presentation-card.js');

function fixture({ isTrashView = false } = {}) {
  let active = false;
  let selected = false;
  let toggles = 0;
  const selectionState = {
    isActive: () => active,
    isSelected: () => selected,
    toggle: () => {
      selected = !selected;
      toggles += 1;
    },
  };
  const { renderCard } = createCardRenderer({
    api: async () => ({}),
    detachThumbs: [],
    selectionState,
  });
  const card = renderCard(
    { id: 'deck-1', title: 'Deck one', hasSlides: false },
    { isTrashView },
  );
  document.body.append(card);
  const key = (target, value) =>
    target.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  const reset = () => history.replaceState(null, '', '/app');
  reset();
  return {
    card,
    key,
    reset,
    selectMode(value) {
      active = value;
      card._updateSelection();
    },
    get toggles() {
      return toggles;
    },
  };
}

test('card opens the editor by mouse, Enter and Space; Present opens only presenter', () => {
  const { card, key, reset } = fixture();
  assert.equal(card.getAttribute('role'), 'link');
  assert.match(card.getAttribute('aria-label'), /Deck one/);
  assert.ok(card.querySelector('.presentation-card-open'));
  const present = card.querySelector('.presentation-card-present');
  assert.equal(present.textContent.trim(), 'Present');
  assert.equal(present.getAttribute('tabindex'), null);

  card.click();
  assert.equal(location.pathname, '/app/deck-1');
  reset();
  key(card, 'Enter');
  assert.equal(location.pathname, '/app/deck-1');
  reset();
  key(card, ' ');
  assert.equal(location.pathname, '/app/deck-1');
  reset();
  present.click();
  assert.equal(location.pathname, '/present/deck-1');
  card.remove();
});

test('nested controls never trigger card keyboard navigation or selection', () => {
  const f = fixture();
  const { card, key, reset } = f;
  const present = card.querySelector('.presentation-card-present');
  const checkbox = card.querySelector('.presentation-card-checkbox');
  const more = card.querySelector('.presentation-card-more');
  const menuPresent = card.querySelector('.presentation-card-menu-item');
  for (const control of [present, checkbox, more, menuPresent]) {
    for (const value of ['Enter', ' ']) {
      reset();
      const before = f.toggles;
      key(control, value);
      assert.equal(location.pathname, '/app');
      assert.equal(f.toggles, before);
    }
  }
  checkbox.click();
  assert.equal(f.toggles, 1);
  assert.equal(location.pathname, '/app');
  more.click();
  assert.equal(location.pathname, '/app');
  card.remove();
});

test('selection mode changes the card action and removes its Present shortcut', () => {
  const f = fixture();
  const { card, key } = f;
  f.selectMode(true);
  assert.equal(card.getAttribute('role'), 'button');
  assert.equal(card.getAttribute('aria-pressed'), 'false');
  assert.equal(card.classList.contains('is-selection-mode'), true);
  key(card, 'Enter');
  assert.equal(f.toggles, 1);
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.equal(location.pathname, '/app');
  card.click();
  assert.equal(f.toggles, 2);
  assert.equal(location.pathname, '/app');
  f.selectMode(false);
  assert.equal(card.getAttribute('role'), 'link');
  assert.equal(card.hasAttribute('aria-pressed'), false);
  card.remove();
});

test('trash card has no editor action or Present shortcut', () => {
  const { card, key } = fixture({ isTrashView: true });
  assert.equal(card.getAttribute('tabindex'), '-1');
  assert.equal(card.hasAttribute('role'), false);
  assert.equal(card.querySelector('.presentation-card-present'), null);
  assert.equal(card.querySelector('.presentation-card-open'), null);
  card.click();
  key(card, 'Enter');
  assert.equal(location.pathname, '/app');
  card.remove();
});
