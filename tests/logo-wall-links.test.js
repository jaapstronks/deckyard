/**
 * Tests for optional per-logo links on logo-wall-slide.
 *
 * Mirrors the icon-card-grid link tests: external URLs render a sanitized
 * new-tab anchor; `#N` renders an in-deck nav anchor (presenter only);
 * unsafe/relative links are ignored; logos without a link are unchanged;
 * thumbnails and the inline-edit canvas omit links.
 *
 * Run with: node --test tests/logo-wall-links.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';

function render(logos, ctx = {}) {
  return renderSlideHtml(
    { type: 'logo-wall-slide', content: { title: 'Partners', logos } },
    ctx
  );
}

describe('logo-wall per-logo links', () => {
  it('renders an external URL as a sanitized new-tab anchor', () => {
    const html = render([{ name: 'Acme', link: 'https://acme.example' }], { mode: 'present' });
    assert.match(html, /<a class="card-link" href="https:\/\/acme\.example"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /class="logo-wall-item has-link"/);
  });

  it('renders #N as an in-deck nav anchor in presenter mode', () => {
    const html = render([{ name: 'Go', link: '#2' }], { mode: 'present' });
    assert.match(html, /<a class="card-link" data-card-nav="2" href="#"/);
  });

  it('ignores #N navigation outside presenter mode', () => {
    const html = render([{ name: 'Go', link: '#2' }], { mode: 'follow' });
    assert.doesNotMatch(html, /card-link/);
  });

  it('ignores javascript: and other unsafe/relative schemes', () => {
    for (const link of ['javascript:alert(1)', '/relative', 'ftp://x', 'notaurl']) {
      const html = render([{ name: 'X', link }], { mode: 'present' });
      assert.doesNotMatch(html, /card-link/, `should reject "${link}"`);
    }
  });

  it('omits links in thumbnail and inline-edit previews', () => {
    for (const mode of ['thumb', 'edit']) {
      const html = render([{ name: 'Acme', link: 'https://acme.example' }], { mode });
      assert.doesNotMatch(html, /card-link/, `${mode} should omit the link`);
    }
  });

  it('keeps external links in exports (mode undefined)', () => {
    const html = render([{ name: 'Acme', link: 'https://acme.example' }]);
    assert.match(html, /href="https:\/\/acme\.example"/);
  });

  it('renders unchanged when no link is set (backcompat)', () => {
    const html = render([{ name: 'Plain' }], { mode: 'present' });
    assert.doesNotMatch(html, /card-link/);
    assert.doesNotMatch(html, /has-link/);
  });

  it('reads the link from legacy numbered fields', () => {
    const html = renderSlideHtml(
      {
        type: 'logo-wall-slide',
        content: {
          title: 'Partners',
          logoCount: '1',
          logo1Name: 'Legacy',
          logo1Link: 'https://legacy.example',
        },
      },
      { mode: 'present' }
    );
    assert.match(html, /href="https:\/\/legacy\.example"/);
  });
});
