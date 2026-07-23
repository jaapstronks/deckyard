/**
 * Contract test for the semantic reflowable reader export (PR 7, move 5a).
 *
 * Asserts the accessibility/reflow contract on the produced document:
 * single <h1>, one <h2> per slide with matching ids + aria-labelledby,
 * <header>/<nav>/<main> landmarks, <html lang/dir>, every <img> has an alt,
 * no <script> (readable with JS off), and no fixed 1600x900 canvas geometry.
 *
 * Run with: node --test tests/semantic-reader.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Real (non-escaping) sanitizer so markdown bodies render as tags in Node.
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

const { buildReaderHtml } = await import('../server/export/reader.js');

const pres = {
  title: 'Quarterly Review',
  description: 'The Q3 story in a few slides.',
  lang: 'en-GB',
  slides: [
    {
      id: 'a',
      type: 'content-slide',
      content: { title: 'Where we are', body: '## Momentum\n\nRevenue is **up**.\n\n- one\n- two' },
    },
    {
      id: 'b',
      type: 'image-slide',
      content: { image: '/uploads/chart.png', alt: 'Revenue chart', caption: 'Q3 revenue' },
    },
    {
      id: 'c',
      type: 'content-slide',
      content: { a11yTitle: 'Accessible label', a11ySummary: 'A short summary.', body: 'Body text.' },
    },
  ],
};

const html = buildReaderHtml('/repo', pres, { context: 'published', canonicalUrl: '/p/abc-x' });

describe('document + landmarks', () => {
  it('is a full HTML document with lang and dir', () => {
    assert.ok(html.startsWith('<!doctype html>'), html.slice(0, 40));
    assert.ok(/<html lang="en-GB" dir="ltr">/.test(html), 'lang + dir set');
  });
  it('has header, nav (labelled), and main landmarks', () => {
    assert.ok(/<header class="reader-header">/.test(html));
    assert.ok(/<nav class="reader-toc" aria-label="Slides">/.test(html));
    assert.ok(/<main class="reader-main">/.test(html));
  });
  it('sets the document title and description', () => {
    assert.ok(html.includes('<title>Quarterly Review</title>'));
    assert.ok(html.includes('name="description" content="The Q3 story in a few slides."'));
  });
});

describe('heading hierarchy', () => {
  it('has exactly one <h1>', () => {
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  });
  it('the <h1> comes before any <h2>', () => {
    assert.ok(html.indexOf('<h1') < html.indexOf('<h2'), 'h1 precedes h2');
  });
  it('has one <h2> per slide, each with a stable id + aria-labelledby section', () => {
    assert.equal((html.match(/<h2 id="slide-\d+-title">/g) || []).length, 3);
    for (const n of [1, 2, 3]) {
      assert.ok(
        html.includes(`<section id="slide-${n}" class="reader-slide" aria-labelledby="slide-${n}-title">`),
        `section ${n}`
      );
    }
  });
  it('renders a navigable table of contents linking each slide', () => {
    for (const n of [1, 2, 3]) {
      assert.ok(html.includes(`href="#slide-${n}"`), `toc link ${n}`);
    }
  });
});

describe('accessibility + reflow contract', () => {
  it('every <img> carries an alt attribute', () => {
    assert.ok(!/<img(?![^>]*\balt=)/.test(html), 'an <img> is missing alt');
  });
  it('honours the a11yTitle override as the heading and renders a11ySummary', () => {
    assert.ok(html.includes('>Accessible label</h2>') || html.includes('Accessible label</h2>'), html);
    assert.ok(html.includes('class="reader-summary"') && html.includes('A short summary.'));
  });
  it('is readable with JavaScript off (no <script>)', () => {
    assert.ok(!/<script/i.test(html), 'reader must ship no script');
  });
  it('uses no fixed 1600x900 canvas geometry', () => {
    assert.ok(!/1600px/.test(html) && !/900px/.test(html), 'no canvas dimensions');
    assert.ok(!/position:\s*absolute/i.test(html), 'no absolute canvas positioning');
  });
  it('projects markdown bodies as real semantic elements', () => {
    assert.ok(html.includes('<h3'), 'markdown ## -> h3');
    assert.ok(html.includes('<ul') && html.includes('<li'), 'markdown list -> ul/li');
    assert.ok(html.includes('<strong>up</strong>'), 'inline emphasis preserved');
  });
});

describe('resilience', () => {
  it('handles an empty deck without throwing', () => {
    const out = buildReaderHtml('/repo', { title: 'Empty', slides: [] });
    assert.ok(out.includes('<main class="reader-main">'));
    assert.ok(out.includes('0 slides'));
  });
  it('marks an unknown slide type as having no readable content', () => {
    const out = buildReaderHtml('/repo', {
      title: 'X',
      slides: [{ id: 'z', type: 'no-such-slide', content: {} }],
    });
    assert.ok(out.includes('reader-empty'), out);
  });
});
