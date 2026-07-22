/**
 * Tests for how icon-card-grid-slide derives its card count.
 *
 * When items[] is in use it is the source of truth: cardCount is a stale
 * legacy mirror there (inline add/remove only mutates the array). Counting
 * cardCount kept rendering an empty ghost card after an inline card removal.
 * Without items[], cardCount still drives the legacy numbered fields.
 *
 * Run with: node --test tests/icon-card-grid-count.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { ensureIconCards } from '../shared/slide-types/types/icon-card-grid-slide.js';

function render(content, ctx = {}) {
  return renderSlideHtml({ type: 'icon-card-grid-slide', content }, ctx);
}

const countCards = (html, re) => (html.match(re) || []).length;
const FILLED = /<div class="icon-card(?:\s(?!is-empty)[^"]*)?"/g;
const EMPTY = /<div class="icon-card is-empty/g;

describe('icon-card-grid card count', () => {
  it('ignores trailing blank items[] entries (padded external data)', () => {
    const html = render({
      title: 'Deck',
      items: [
        { icon: 'target', title: 'Card 1', body: 'x' },
        { icon: 'users', title: 'Card 2', body: 'y' },
        {},
        {},
        { icon: '', title: '   ', body: '' },
        {},
      ],
    }, { mode: 'edit' });
    assert.equal(countCards(html, FILLED), 2);
    assert.equal(countCards(html, EMPTY), 4);
    assert.match(html, /data-card-count="2"/);
  });

  it('keeps a blank item that sits between filled ones (indices stay editable)', () => {
    const html = render({
      title: 'Deck',
      items: [
        { icon: 'target', title: 'Card 1', body: 'x' },
        {},
        { icon: 'users', title: 'Card 3', body: 'z' },
      ],
    }, { mode: 'edit' });
    assert.equal(countCards(html, FILLED), 3);
    assert.match(html, /data-inline-field="items\.2\.title"/);
  });

  it('items[] wins over a stale higher cardCount (post-removal state)', () => {
    const html = render({
      title: 'Deck',
      cardCount: '6',
      items: Array.from({ length: 5 }, (_, i) => ({
        icon: 'target',
        title: `Card ${i + 1}`,
        body: 'x',
      })),
    }, { mode: 'edit' });
    assert.equal(countCards(html, FILLED), 5);
    assert.equal(countCards(html, EMPTY), 1);
    assert.match(html, /data-card-count="5"/);
  });

  it('items[] wins over a stale lower cardCount (post-add state)', () => {
    const html = render({
      title: 'Deck',
      cardCount: '2',
      items: Array.from({ length: 4 }, (_, i) => ({
        icon: 'target',
        title: `Card ${i + 1}`,
        body: 'x',
      })),
    }, { mode: 'edit' });
    assert.equal(countCards(html, FILLED), 4);
    assert.match(html, /data-card-count="4"/);
  });

  it('legacy numbered content still follows cardCount', () => {
    const html = render({
      title: 'Deck',
      cardCount: '3',
      card1Icon: 'target', card1Title: 'A', card1Body: 'x',
      card2Icon: 'target', card2Title: 'B', card2Body: 'x',
      card3Icon: 'target', card3Title: 'C', card3Body: 'x',
    }, { mode: 'present' });
    assert.equal(countCards(html, FILLED), 3);
    assert.equal(countCards(html, EMPTY), 3);
  });

  it('a bottom subheading still caps the cards layout at 4', () => {
    const html = render({
      title: 'Deck',
      bottomSubheading: 'Bottom line',
      items: Array.from({ length: 6 }, (_, i) => ({
        icon: 'target',
        title: `Card ${i + 1}`,
        body: 'x',
      })),
    }, { mode: 'present' });
    assert.equal(countCards(html, FILLED), 4);
  });
});

// ensureIconCards is the inline editor's `ensure` knob: it materializes items[]
// from a legacy numbered deck so the canvas add/remove/reorder affordances have
// a stable array to write to (mirrors ensureMembers / ensureLogos).
describe('ensureIconCards migration', () => {
  it('folds legacy numbered fields into items[], bounded by cardCount', () => {
    const content = {
      cardCount: '3',
      card1Icon: 'a', card1Title: 'One', card1Body: 'first', card1Link: '#2',
      card2Icon: 'b', card2Title: 'Two', card2Body: 'second',
      card3Icon: 'c', card3Title: 'Three', card3Body: 'third',
      // beyond cardCount: must not leak into items[]
      card4Title: 'LEAK',
    };
    ensureIconCards(content);
    assert.equal(content.items.length, 3);
    assert.deepEqual(content.items[0], { icon: 'a', title: 'One', body: 'first', link: '#2' });
    assert.equal(content.items[2].title, 'Three');
    assert.ok(!content.items.some((c) => c.title === 'LEAK'), 'stale slot leaked');
  });

  it('trims trailing blank slots so no invisible orphan items are seeded', () => {
    const content = {
      cardCount: '6',
      card1Title: 'Only one', card1Body: 'x',
    };
    ensureIconCards(content);
    assert.equal(content.items.length, 1);
  });

  it('leaves an empty array when there is genuinely nothing to fold', () => {
    const content = { cardCount: '6' };
    ensureIconCards(content);
    assert.deepEqual(content.items, []);
  });

  it('is idempotent and never overwrites an existing items[] deck', () => {
    const content = { items: [{ icon: 'x', title: 'Keep', body: 'me', link: '' }], card1Title: 'IGNORED' };
    ensureIconCards(content);
    assert.equal(content.items.length, 1);
    assert.equal(content.items[0].title, 'Keep');
  });

  it('caps an oversized items[] at the max of 6', () => {
    const content = { items: Array.from({ length: 9 }, (_, i) => ({ title: `C${i}`, body: 'x' })) };
    ensureIconCards(content);
    assert.equal(content.items.length, 6);
  });
});
