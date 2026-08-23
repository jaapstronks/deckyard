/**
 * Tests for how icon-card-grid-slide derives its card count.
 *
 * items[] is the only source: its length, with trailing blanks trimmed, is the
 * count. The legacy `cardCount` enum and its numbered card{N}* family went with
 * the v7 -> v8 schema fold — a stored deck is folded once at read time, so a
 * stale count can no longer draw a ghost card after an inline removal.
 *
 * Run with: node --test tests/icon-card-grid-count.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { ensureIconCards } from '../shared/slide-types/types/icon-card-grid-slide/cards.js';

function render(content, ctx = {}) {
  return renderSlideHtml({ type: 'icon-card-grid-slide', content }, ctx);
}

const countCards = (html, re) => (html.match(re) || []).length;
const FILLED = /<div class="icon-card(?:\s(?!is-empty)[^"]*)?"/g;
const EMPTY = /<div class="icon-card is-empty/g;

describe('icon-card-grid card count', () => {
  it('ignores trailing blank items[] entries (padded external data)', () => {
    const html = render(
      {
        title: 'Deck',
        items: [
          { icon: 'target', title: 'Card 1', body: 'x' },
          { icon: 'users', title: 'Card 2', body: 'y' },
          {},
          {},
          { icon: '', title: '   ', body: '' },
          {},
        ],
      },
      { mode: 'edit' },
    );
    assert.equal(countCards(html, FILLED), 2);
    assert.equal(countCards(html, EMPTY), 4);
    assert.match(html, /data-card-count="2"/);
  });

  it('keeps a blank item that sits between filled ones (indices stay editable)', () => {
    const html = render(
      {
        title: 'Deck',
        items: [
          { icon: 'target', title: 'Card 1', body: 'x' },
          {},
          { icon: 'users', title: 'Card 3', body: 'z' },
        ],
      },
      { mode: 'edit' },
    );
    assert.equal(countCards(html, FILLED), 3);
    assert.match(html, /data-inline-field="items\.2\.title"/);
  });

  it('draws one empty cell per unused slot in the six-cell grid', () => {
    const html = render(
      {
        title: 'Deck',
        items: Array.from({ length: 5 }, (_, i) => ({
          icon: 'target',
          title: `Card ${i + 1}`,
          body: 'x',
        })),
      },
      { mode: 'edit' },
    );
    assert.equal(countCards(html, FILLED), 5);
    assert.equal(countCards(html, EMPTY), 1);
    assert.match(html, /data-card-count="5"/);
  });

  it('counts every filled item, with no separate count to fall out of step', () => {
    const html = render(
      {
        title: 'Deck',
        items: Array.from({ length: 4 }, (_, i) => ({
          icon: 'target',
          title: `Card ${i + 1}`,
          body: 'x',
        })),
      },
      { mode: 'edit' },
    );
    assert.equal(countCards(html, FILLED), 4);
    assert.match(html, /data-card-count="4"/);
  });

  it('ignores a stray legacy cardCount that survived on some import', () => {
    // The fold removes the key, but the renderer must not consult it either:
    // reading a count beside the array is exactly the drift this removed.
    const html = render(
      {
        title: 'Deck',
        cardCount: '6',
        items: [{ title: 'Only one', body: 'x' }],
      },
      { mode: 'present' },
    );
    assert.equal(countCards(html, FILLED), 1);
    assert.match(html, /data-card-count="1"/);
  });

  it('a bottom subheading still caps the cards layout at 4', () => {
    const html = render(
      {
        title: 'Deck',
        bottomSubheading: 'Bottom line',
        items: Array.from({ length: 6 }, (_, i) => ({
          icon: 'target',
          title: `Card ${i + 1}`,
          body: 'x',
        })),
      },
      { mode: 'present' },
    );
    assert.equal(countCards(html, FILLED), 4);
  });
});

// ensureIconCards is the inline editor's `ensure` knob: it materializes items[]
// so the canvas add/remove/reorder affordances have a stable array to write to
// (mirrors ensureMembers / ensureLogos). Folding a legacy numbered deck was its
// other job until the v7 -> v8 schema step took that over.
describe('ensureIconCards', () => {
  it('materializes an empty array when nothing is stored', () => {
    const content = { title: 'Deck' };
    ensureIconCards(content);
    assert.deepEqual(content.items, []);
  });

  it('leaves an existing items[] deck exactly as it was', () => {
    const content = {
      items: [{ icon: 'x', title: 'Keep', body: 'me', link: '' }],
    };
    ensureIconCards(content);
    assert.equal(content.items.length, 1);
    assert.equal(content.items[0].title, 'Keep');
  });

  it('caps an oversized items[] at the max of 6', () => {
    const content = {
      items: Array.from({ length: 9 }, (_, i) => ({
        title: `C${i}`,
        body: 'x',
      })),
    };
    ensureIconCards(content);
    assert.equal(content.items.length, 6);
  });
});
