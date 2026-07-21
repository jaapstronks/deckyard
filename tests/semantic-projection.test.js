/**
 * Unit tests for the field-driven semantic projection (PR 7, move 5a).
 * Synthetic slide-type defs give full control over field shapes.
 *
 * Run with: node --test tests/semantic-projection.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Real (non-escaping) sanitizer so markdown fields render as tags in Node.
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

const { slideHeading, renderSlideBodySemanticHtml } = await import(
  '../shared/slide-types/semantic-projection.js'
);

const body = (slide, def, opts) => renderSlideBodySemanticHtml(slide, def, opts);

describe('slideHeading resolution', () => {
  it('prefers an a11yTitle override', () => {
    const h = slideHeading({ content: { a11yTitle: 'Override', title: 'Title' } }, {});
    assert.deepEqual(h, { text: 'Override', key: null });
  });
  it('uses the def labelField next', () => {
    const h = slideHeading({ content: { name: 'Ada' } }, { labelField: 'name' });
    assert.deepEqual(h, { text: 'Ada', key: 'name' });
  });
  it('falls back to common title candidate keys', () => {
    assert.equal(slideHeading({ content: { question: 'Why?' } }, {}).text, 'Why?');
  });
  it('falls back to the type label, then a numbered default', () => {
    assert.equal(slideHeading({ content: {} }, { label: 'Quote' }).text, 'Quote');
    assert.equal(slideHeading({ type: '', content: {} }, {}, 4).text, 'Slide 5');
  });
});

describe('field-type projection', () => {
  const def = {
    fields: [
      { key: 'title', type: 'string' },
      { key: 'subtitle', type: 'string' },
      { key: 'body', type: 'markdown' },
      { key: 'layout', type: 'enum' },
      { key: 'size', type: 'number' },
    ],
  };
  const slide = {
    content: {
      title: 'The Title',
      subtitle: 'A subtitle',
      body: '## Heading\n\nA **bold** point.',
      layout: 'two-col',
      size: 3,
    },
  };

  it('renders string as <p>, markdown as prose, skips presentational fields', () => {
    const html = body(slide, def, { headingKey: 'title' });
    assert.ok(!html.includes('The Title'), 'heading field is not repeated');
    assert.ok(html.includes('<p>A subtitle</p>'), html);
    assert.ok(html.includes('<strong>bold</strong>'), html);
    assert.ok(html.includes('<h3'), 'markdown ## renders as h3');
    assert.ok(!html.includes('two-col'), 'enum skipped');
    assert.ok(!html.includes('>3<') && !html.includes('size'), 'number skipped');
  });

  it('renders the a11ySummary as an intro paragraph', () => {
    const html = body({ content: { a11ySummary: 'In short.' } }, { fields: [] });
    assert.ok(html.includes('class="reader-summary"'), html);
    assert.ok(html.includes('In short.'), html);
  });
});

describe('images and figures', () => {
  it('renders an image field as a <figure> with resolved alt + caption', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      { content: { image: '/uploads/x.png', alt: 'A chart', caption: 'Fig 1' } },
      def
    );
    assert.ok(html.includes('<figure'), html);
    assert.ok(html.includes('alt="A chart"'), html);
    assert.ok(html.includes('<figcaption>Fig 1</figcaption>'), html);
  });

  it('marks a decorative image with empty alt + aria-hidden', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      { content: { image: '/uploads/x.png', imageRole: 'decorative', alt: 'ignored' } },
      def
    );
    assert.ok(html.includes('alt=""'), html);
    assert.ok(html.includes('aria-hidden="true"'), html);
    assert.ok(!html.includes('ignored'), html);
  });

  it('does not also render the image sibling alt/caption as paragraphs', () => {
    // image-slide has image + sibling `alt` + `caption` string fields; those
    // fold into the <figure> and must not double-render as <p>.
    const def = {
      fields: [
        { key: 'image', type: 'image' },
        { key: 'alt', type: 'string' },
        { key: 'caption', type: 'string' },
        { key: 'subheading', type: 'string' },
      ],
    };
    const html = body(
      { content: { image: '/uploads/x.png', alt: 'Chart alt', caption: 'A caption', subheading: 'Keep me' } },
      def,
      { headingKey: 'subheading' }
    );
    assert.equal((html.match(/A caption/g) || []).length, 1, 'caption appears once (in figcaption)');
    assert.ok(!html.includes('<p>Chart alt</p>'), 'alt is not a standalone paragraph');
    assert.ok(html.includes('alt="Chart alt"'), 'alt still used on the img');
  });

  it('always emits an alt attribute even without explicit alt', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body({ content: { image: '/uploads/quarterly-report.png' } }, def);
    assert.ok(/<img[^>]*\balt="/.test(html), html);
  });

  it('renders an images gallery, each with alt', () => {
    const def = { fields: [{ key: 'gallery', type: 'images' }] };
    const html = body({ content: { gallery: ['/a.png', '/b.png'] } }, def);
    assert.ok(html.includes('reader-gallery'), html);
    assert.equal((html.match(/<img/g) || []).length, 2, html);
    assert.ok(!/<img(?![^>]*\balt=)/.test(html), 'every img has alt');
  });
});

describe('items and tables', () => {
  it('renders items as a list, first string field as <h3>', () => {
    const def = {
      fields: [
        {
          key: 'cards',
          type: 'items',
          itemFields: [
            { key: 'label', type: 'string' },
            { key: 'text', type: 'markdown' },
          ],
        },
      ],
    };
    const html = body(
      { content: { cards: [{ label: 'One', text: 'first' }, { label: 'Two', text: 'second' }] } },
      def
    );
    assert.ok(html.includes('<ul class="reader-items">'), html);
    assert.ok(html.includes('<h3>One</h3>'), html);
    assert.ok(html.includes('<h3>Two</h3>'), html);
    assert.ok(html.includes('first') && html.includes('second'), html);
  });

  it('renders a csv field as a semantic <table>', () => {
    const def = { fields: [{ key: 'data', type: 'csv' }] };
    const html = body({ content: { data: 'Q,Sales\nQ1,10\nQ2,20' } }, def);
    assert.ok(html.includes('<table'), html);
    assert.ok(html.includes('<th scope="col">Q</th>'), html);
    assert.ok(html.includes('<td>Q1</td>'), html);
  });
});

describe('background/logo global fields are excluded', () => {
  it('never renders slideBgImage or slideLogo as content', () => {
    const def = {
      fields: [
        { key: 'slideBgImage', type: 'image' },
        { key: 'slideLogo', type: 'enum' },
        { key: 'body', type: 'markdown' },
      ],
    };
    const html = body({ content: { slideBgImage: '/bg.png', slideLogo: 'top-right', body: 'x' } }, def);
    assert.ok(!html.includes('/bg.png'), html);
    assert.ok(!html.includes('<figure'), html);
    assert.ok(html.includes('x'), html);
  });
});
