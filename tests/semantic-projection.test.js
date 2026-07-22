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

describe('count-/order-aware collection projection', () => {
  it('projects an ordered items field to <ol>, an unordered one to <ul>', () => {
    const ordered = {
      fields: [{ key: 'items', type: 'items', ordered: true, itemFields: [{ key: 'title', type: 'string' }] }],
    };
    const unordered = {
      fields: [{ key: 'items', type: 'items', itemFields: [{ key: 'title', type: 'string' }] }],
    };
    const val = { content: { items: [{ title: 'A' }, { title: 'B' }] } };
    const oh = body(val, ordered);
    assert.ok(/<ol class="reader-items">/.test(oh), oh);
    assert.ok(!/<ul/.test(oh), oh);
    const uh = body(val, unordered);
    assert.ok(/<ul class="reader-items">/.test(uh), uh);
    assert.ok(!/<ol/.test(uh), uh);
  });

  it('projects a flat repeating group bounded by its count, grouped per slot', () => {
    const def = {
      repeatingGroups: [
        { countKey: 'cardCount', prefix: 'card', slotFields: ['Title', 'Body'], ordered: false },
      ],
      fields: [
        { key: 'cardCount', type: 'enum' },
        { key: 'card1Title', type: 'string' }, { key: 'card1Body', type: 'markdown' },
        { key: 'card2Title', type: 'string' }, { key: 'card2Body', type: 'markdown' },
        { key: 'card3Title', type: 'string' }, { key: 'card3Body', type: 'markdown' },
      ],
    };
    const html = body({ content: {
      cardCount: '2',
      card1Title: 'One', card1Body: 'first',
      card2Title: 'Two', card2Body: 'second',
      card3Title: 'LEAK', card3Body: 'should not appear',
    } }, def);
    // stale slot 3 (beyond cardCount=2) must not leak
    assert.ok(!/LEAK/.test(html), html);
    // title + body stay grouped in one <li>, title becomes the block heading
    assert.ok(/<li class="reader-item"><h3>One<\/h3>/.test(html), html);
    assert.ok(/first/.test(html) && /second/.test(html), html);
    // the raw count enum and numbered slot fields never render as loose nodes
    assert.ok(!/card1Title|cardCount/.test(html), html);
  });

  it('does not surface a hidden slot field (deprecated card label)', () => {
    const def = {
      repeatingGroups: [{ countKey: 'cardCount', prefix: 'card', slotFields: ['Title', 'Label', 'Body'] }],
      fields: [
        { key: 'cardCount', type: 'enum' },
        { key: 'card1Title', type: 'string' },
        { key: 'card1Label', type: 'string', hidden: true },
        { key: 'card1Body', type: 'markdown' },
      ],
    };
    const html = body({ content: { cardCount: '1', card1Title: 'T', card1Label: 'HIDDENLABEL', card1Body: 'b' } }, def);
    assert.ok(!/HIDDENLABEL/.test(html), html);
    assert.ok(/<h3>T<\/h3>/.test(html), html);
  });

  it('falls back to all declared slots when the count field is missing', () => {
    const def = {
      repeatingGroups: [{ countKey: 'cardCount', prefix: 'card', slotFields: ['Title'] }],
      fields: [
        { key: 'cardCount', type: 'enum' },
        { key: 'card1Title', type: 'string' },
        { key: 'card2Title', type: 'string' },
      ],
    };
    const html = body({ content: { card1Title: 'A', card2Title: 'B' } }, def);
    assert.ok(/A/.test(html) && /B/.test(html), html);
  });
});

describe('url field projection', () => {
  it('renders a safe url as an <a href>', () => {
    const def = { fields: [{ key: 'link', type: 'url' }] };
    const html = body({ content: { link: 'https://example.com/x' } }, def);
    assert.ok(/<a href="https:\/\/example\.com\/x">https:\/\/example\.com\/x<\/a>/.test(html), html);
  });
  it('drops an unsafe scheme instead of emitting a link', () => {
    const def = { fields: [{ key: 'link', type: 'url' }] };
    const html = body({ content: { link: 'javascript:alert(1)' } }, def);
    assert.ok(!/<a /.test(html), html);
    assert.ok(!/alert/.test(html), html);
  });
  it('allows a root-relative link', () => {
    const def = { fields: [{ key: 'link', type: 'url' }] };
    const html = body({ content: { link: '/p/deck/1' } }, def);
    assert.ok(/<a href="\/p\/deck\/1">/.test(html), html);
  });
});

describe('relation-aware collection projection (text-blocks arrows)', () => {
  const relDef = () => ({
    fields: [
      {
        key: 'rows',
        type: 'items',
        relationField: 'arrow',
        relationLabels: { down: 'leads to', up: 'follows from' },
        itemFields: [
          { key: 'title', type: 'string' },
          { key: 'arrow', type: 'enum' },
          {
            key: 'blocks',
            type: 'items',
            itemFields: [{ key: 'title', type: 'string' }, { key: 'body', type: 'markdown' }],
          },
        ],
      },
    ],
  });

  it('renders an ordered <ol> with a relation marker when rows carry an arrow', () => {
    const html = body({ content: { rows: [
      { title: 'Phase 1', arrow: 'down', blocks: [{ title: 'A', body: 'a' }] },
      { title: 'Phase 2', arrow: 'none', blocks: [{ title: 'B', body: 'b' }] },
    ] } }, relDef());
    assert.ok(/^<ol class="reader-items">/.test(html), html);
    assert.ok(/class="reader-relation" data-relation="down">leads to</.test(html), html);
    // nested blocks stay an unordered sub-list
    assert.ok(/<ul class="reader-items"><li class="reader-item"><h3>A<\/h3>/.test(html), html);
    // the row heading is a heading, the arrow enum never renders as content
    assert.ok(/<h3>Phase 1<\/h3>/.test(html), html);
    assert.ok(!/none/.test(html), html);
  });

  it('stays an unordered <ul> with no marker when no row has an arrow', () => {
    const html = body({ content: { rows: [
      { title: 'Only', arrow: 'none', blocks: [{ title: 'A', body: 'a' }] },
    ] } }, relDef());
    assert.ok(/^<ul class="reader-items">/.test(html), html);
    assert.ok(!/reader-relation/.test(html), html);
  });
});
