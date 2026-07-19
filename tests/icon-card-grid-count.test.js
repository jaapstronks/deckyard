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
