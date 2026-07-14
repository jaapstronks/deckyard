/**
 * Tests for optional per-card links on icon-card-grid-slide.
 *
 * Covers: external URLs render a sanitized new-tab anchor; `#N` renders an
 * in-deck nav anchor (presenter mode only); unsafe/relative links are ignored;
 * cards without a link are unchanged (backcompat); thumbnails omit links.
 *
 * Run with: node --test tests/icon-card-grid-links.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';

function render(cards, ctx = {}) {
  return renderSlideHtml(
    {
      type: 'icon-card-grid-slide',
      content: {
        title: 'Deck',
        cardCount: String(cards.length),
        items: cards,
      },
    },
    ctx
  );
}

describe('icon-card-grid per-card links', () => {
  it('renders an external URL as a sanitized new-tab anchor', () => {
    const html = render([{ title: 'Docs', body: 'x', link: 'https://example.com/a?b=1' }], {
      mode: 'present',
    });
    assert.match(html, /<a class="card-link" href="https:\/\/example\.com\/a\?b=1"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /class="icon-card has-link"/);
  });

  it('renders mailto links', () => {
    const html = render([{ title: 'Mail', body: 'x', link: 'mailto:hi@example.com' }], {
      mode: 'follow',
    });
    assert.match(html, /href="mailto:hi@example\.com"/);
  });

  it('renders #slide:<id> as a stable in-deck nav anchor in presenter mode', () => {
    const html = render([{ title: 'Go', body: 'x', link: '#slide:abc-123' }], { mode: 'present' });
    assert.match(html, /<a class="card-link" data-card-nav-id="abc-123" href="#"/);
    assert.doesNotMatch(html, /target="_blank"/);
  });

  it('ignores #slide:<id> navigation outside presenter mode', () => {
    const html = render([{ title: 'Go', body: 'x', link: '#slide:abc-123' }], { mode: 'follow' });
    assert.doesNotMatch(html, /card-link/);
  });

  it('renders #N as an in-deck nav anchor in presenter mode', () => {
    const html = render([{ title: 'Go', body: 'x', link: '#3' }], { mode: 'present' });
    assert.match(html, /<a class="card-link" data-card-nav="3" href="#"/);
    assert.doesNotMatch(html, /target="_blank"/);
  });

  it('ignores #N navigation outside presenter mode', () => {
    const html = render([{ title: 'Go', body: 'x', link: '#3' }], { mode: 'follow' });
    assert.doesNotMatch(html, /data-card-nav/);
    assert.doesNotMatch(html, /card-link/);
  });

  it('ignores javascript: and other unsafe/relative schemes', () => {
    for (const link of ['javascript:alert(1)', '/relative', 'ftp://x', 'notaurl']) {
      const html = render([{ title: 'X', body: 'x', link }], { mode: 'present' });
      assert.doesNotMatch(html, /card-link/, `should reject "${link}"`);
    }
  });

  it('omits links in thumbnail previews', () => {
    const html = render([{ title: 'Docs', body: 'x', link: 'https://example.com' }], {
      mode: 'thumb',
    });
    assert.doesNotMatch(html, /card-link/);
  });

  it('omits links in the inline-edit canvas (mode: edit) so click-to-edit is not blocked', () => {
    for (const link of ['https://example.com', '#3']) {
      const html = render([{ title: 'Docs', body: 'x', link }], { mode: 'edit' });
      assert.doesNotMatch(html, /card-link/, `edit mode should omit "${link}"`);
    }
  });

  it('keeps external links in exports (mode undefined)', () => {
    const html = render([{ title: 'Docs', body: 'x', link: 'https://example.com' }]);
    assert.match(html, /href="https:\/\/example\.com"/);
  });

  it('renders unchanged when no link is set (backcompat)', () => {
    const html = render([{ title: 'Plain', body: 'x' }], { mode: 'present' });
    assert.doesNotMatch(html, /card-link/);
    assert.doesNotMatch(html, /has-link/);
  });

  it('reads the link from legacy numbered fields', () => {
    const html = renderSlideHtml(
      {
        type: 'icon-card-grid-slide',
        content: {
          title: 'Deck',
          cardCount: '1',
          card1Title: 'Legacy',
          card1Body: 'x',
          card1Link: 'https://legacy.example',
        },
      },
      { mode: 'present' }
    );
    assert.match(html, /href="https:\/\/legacy\.example"/);
  });
});
