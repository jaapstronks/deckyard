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

const { slideHeading, renderSlideBodySemanticHtml, renderSlideSectionHtml } =
  await import('../shared/slide-types/semantic-projection.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { migratePresentation } =
  await import('../shared/slide-types/schema-version.js');

const body = (slide, def, opts) =>
  renderSlideBodySemanticHtml(slide, def, opts);

describe('slideHeading resolution (D129)', () => {
  const titled = {
    label: 'Text slide',
    labelField: 'name',
    fields: [
      { key: 'title', type: 'string', role: 'heading' },
      { key: 'name', type: 'string' },
    ],
  };
  it('the declared heading field is the visible heading and is consumed', () => {
    const h = slideHeading({ content: { title: 'Title' } }, titled);
    assert.deepEqual(h, {
      text: 'Title',
      visible: true,
      key: 'title',
      ariaLabel: '',
    });
  });
  it('an a11yTitle beside a visible title becomes the section name, not the heading', () => {
    const h = slideHeading(
      { content: { a11yTitle: 'Override', title: 'Title' } },
      titled,
    );
    assert.deepEqual(h, {
      text: 'Title',
      visible: true,
      key: 'title',
      ariaLabel: 'Override',
    });
  });
  it('without a filled heading field, the a11yTitle is a hidden name', () => {
    const h = slideHeading({ content: { a11yTitle: 'Override' } }, titled);
    assert.deepEqual(h, {
      text: 'Override',
      visible: false,
      key: null,
      ariaLabel: '',
    });
  });
  it('then the labelField value, hidden and consuming nothing', () => {
    const h = slideHeading({ content: { name: 'Ada' } }, titled);
    assert.deepEqual(h, {
      text: 'Ada',
      visible: false,
      key: null,
      ariaLabel: '',
    });
  });
  it('guesses no title from a key name: an undeclared `title` is not a heading', () => {
    const h = slideHeading(
      { content: { title: 'Looks like a title' } },
      { label: 'Fork type', fields: [{ key: 'title', type: 'string' }] },
    );
    assert.deepEqual(h, {
      text: 'Fork type',
      visible: false,
      key: null,
      ariaLabel: '',
    });
  });
  it('falls back to the type label, then a numbered default, both hidden', () => {
    const h = slideHeading({ content: {} }, { label: 'Quote' });
    assert.equal(h.text, 'Quote');
    assert.equal(h.visible, false);
    assert.equal(
      slideHeading({ type: '', content: {} }, {}, { index: 4 }).text,
      'Slide 5',
    );
  });
  it('an unresolved type shows its stored title, and hides its state name', () => {
    assert.deepEqual(
      slideHeading({ type: 'gone-slide', content: { title: 'Kept' } }, null),
      { text: 'Kept', visible: true, key: 'title', ariaLabel: '' },
    );
    const bare = slideHeading({ type: 'gone-slide', content: {} }, undefined);
    assert.equal(bare.visible, false);
    assert.equal(bare.key, null);
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
    assert.ok(html.includes('<p data-field="subtitle">A subtitle</p>'), html);
    assert.ok(html.includes('<strong>bold</strong>'), html);
    assert.ok(html.includes('<h3'), 'markdown ## renders as h3');
    assert.ok(!html.includes('two-col'), 'enum skipped');
    assert.ok(
      !html.includes('>3<') && !html.includes('size'),
      'number skipped',
    );
  });

  it('renders the a11ySummary as an intro paragraph', () => {
    const html = body(
      { content: { a11ySummary: 'In short.' } },
      { fields: [] },
    );
    assert.ok(html.includes('class="reader-summary"'), html);
    assert.ok(html.includes('In short.'), html);
  });
});

describe('images and figures', () => {
  it('renders an image field as a <figure> with resolved alt + caption', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      {
        content: { image: '/uploads/x.png', alt: 'A chart', caption: 'Fig 1' },
      },
      def,
    );
    assert.ok(html.includes('<figure'), html);
    assert.ok(html.includes('alt="A chart"'), html);
    assert.ok(html.includes('<figcaption>Fig 1</figcaption>'), html);
  });

  it('marks a decorative image with empty alt + aria-hidden', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      {
        content: {
          image: '/uploads/x.png',
          imageRole: 'decorative',
          alt: 'ignored',
        },
      },
      def,
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
      {
        content: {
          image: '/uploads/x.png',
          alt: 'Chart alt',
          caption: 'A caption',
          subheading: 'Keep me',
        },
      },
      def,
      { headingKey: 'subheading' },
    );
    assert.equal(
      (html.match(/A caption/g) || []).length,
      1,
      'caption appears once (in figcaption)',
    );
    assert.ok(
      !/<p[^>]*>Chart alt<\/p>/.test(html),
      'alt is not a standalone paragraph',
    );
    assert.ok(html.includes('alt="Chart alt"'), 'alt still used on the img');
  });

  it('always emits an alt attribute, and never guesses one from the filename', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      { content: { image: '/uploads/quarterly-report.png' } },
      def,
    );
    assert.ok(/<img[^>]*\balt=""/.test(html), html);
    assert.ok(!/Quarterly report/i.test(html), html);
  });

  it('renders an images array as one figure group, alt empty', () => {
    const def = { fields: [{ key: 'gallery', type: 'images' }] };
    const html = body({ content: { gallery: ['/a.png', '/b.png'] } }, def);
    assert.ok(
      html.startsWith(
        '<figure class="reader-gallery" role="group" data-field="gallery">',
      ),
      html,
    );
    assert.equal((html.match(/<img/g) || []).length, 2, html);
    assert.equal((html.match(/alt=""/g) || []).length, 2, html);
  });
});

describe('the reader alt ladder: explicit, a name, nothing (D135, B297)', () => {
  it('a caption is never the alt', () => {
    const def = {
      fields: [
        { key: 'image', type: 'image' },
        { key: 'caption', type: 'string' },
      ],
    };
    const html = body(
      { content: { image: '/x.png', caption: 'Project Alpha' } },
      def,
    );
    assert.ok(html.includes('alt=""'), html);
    assert.equal((html.match(/Project Alpha/g) || []).length, 1, html);
  });

  it("a slide's own heading does not name a picture on it", () => {
    const html = body(
      { content: { title: 'Full image', image: '/x.png' } },
      SLIDE_TYPES['image-slide'],
      { headingKey: 'title' },
    );
    assert.ok(html.includes('alt=""'), html);
  });

  it('a declared nameKey names the picture before the item heading', () => {
    const html = body(
      {
        content: {
          quote: 'Ship it.',
          authorName: 'Grace Hopper',
          authorImage1: '/grace.png',
        },
      },
      SLIDE_TYPES['quote-slide'],
    );
    assert.ok(html.includes('alt="Grace Hopper"'), html);
  });

  it('a byline is a caption, not a name: a card without a name gets no alt', () => {
    const html = body(
      {
        content: {
          members: [{ image: '/x.png', name: '', byline: 'CTO' }],
        },
      },
      SLIDE_TYPES['team-cards-slide'],
    );
    assert.ok(html.includes('alt=""'), html);
    assert.ok(
      html.includes('<figcaption data-field="byline">CTO</figcaption>'),
      html,
    );
  });

  it('an item picture reads its role from the set when it has none of its own', () => {
    const html = body(
      {
        content: {
          images: [
            { src: '/1.png', alt: 'One' },
            { src: '/2.png', alt: 'Two' },
          ],
          imageRole: 'decorative',
        },
      },
      SLIDE_TYPES['image-set-slide'],
    );
    assert.equal((html.match(/aria-hidden="true"/g) || []).length, 2, html);
    assert.ok(!html.includes('One'), html);
  });
});

describe('a set of pictures is one figure group (D135, B297)', () => {
  it('an image set: one group, one figcaption, no list and no loose caption', () => {
    const html = body(
      {
        content: {
          images: [
            { src: '/1.png', alt: 'One' },
            { src: '/2.png', alt: 'Two' },
          ],
          caption: 'Before and after',
        },
      },
      SLIDE_TYPES['image-set-slide'],
    );
    assert.ok(
      html.includes(
        '<figure class="reader-gallery" role="group" data-field="images"><figure class="reader-figure" data-field="src"><img src="/1.png" alt="One" loading="lazy" /></figure><figure class="reader-figure" data-field="src"><img src="/2.png" alt="Two" loading="lazy" /></figure><figcaption data-field="caption">Before and after</figcaption></figure>',
      ),
      html,
    );
    assert.ok(!html.includes('<ul'), html);
    assert.equal((html.match(/Before and after/g) || []).length, 1, html);
  });

  it('a gallery keeps a caption per picture inside the group', () => {
    const html = body(
      {
        content: {
          images: [
            { src: '/1.png', caption: 'Alpha', alt: 'A harbour' },
            { src: '/2.png', caption: 'Beta', alt: '' },
          ],
        },
      },
      SLIDE_TYPES['gallery-slide'],
    );
    assert.ok(html.includes('role="group"'), html);
    assert.ok(
      html.includes(
        'alt="A harbour" loading="lazy" /><figcaption>Alpha</figcaption>',
      ),
      html,
    );
    assert.ok(
      html.includes('alt="" loading="lazy" /><figcaption>Beta</figcaption>'),
      html,
    );
  });

  it('cards with more than a picture stay a list', () => {
    const html = body(
      {
        content: {
          logos: [{ image: '/a.png', name: 'Acme', link: 'https://acme.test' }],
        },
      },
      SLIDE_TYPES['logo-wall-slide'],
    );
    assert.ok(html.includes('<ul class="reader-items"'), html);
    assert.ok(!html.includes('role="group"'), html);
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
      {
        content: {
          cards: [
            { label: 'One', text: 'first' },
            { label: 'Two', text: 'second' },
          ],
        },
      },
      def,
    );
    assert.ok(
      html.includes('<ul class="reader-items" data-field="cards">'),
      html,
    );
    assert.ok(html.includes('<h3 data-field="label">One</h3>'), html);
    assert.ok(html.includes('<h3 data-field="label">Two</h3>'), html);
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
    const html = body(
      {
        content: { slideBgImage: '/bg.png', slideLogo: 'top-right', body: 'x' },
      },
      def,
    );
    assert.ok(!html.includes('/bg.png'), html);
    assert.ok(!html.includes('<figure'), html);
    assert.ok(html.includes('x'), html);
  });
});

describe('count-/order-aware collection projection', () => {
  it('projects an ordered items field to <ol>, an unordered one to <ul>', () => {
    const ordered = {
      fields: [
        {
          key: 'items',
          type: 'items',
          ordered: true,
          itemFields: [{ key: 'title', type: 'string' }],
        },
      ],
    };
    const unordered = {
      fields: [
        {
          key: 'items',
          type: 'items',
          itemFields: [{ key: 'title', type: 'string' }],
        },
      ],
    };
    const val = { content: { items: [{ title: 'A' }, { title: 'B' }] } };
    const oh = body(val, ordered);
    assert.ok(/<ol class="reader-items"[ >]/.test(oh), oh);
    assert.ok(!/<ul/.test(oh), oh);
    const uh = body(val, unordered);
    assert.ok(/<ul class="reader-items"[ >]/.test(uh), uh);
    assert.ok(!/<ol/.test(uh), uh);
  });

  it('projects no core type as a flat numbered slot family any more', () => {
    // The projection used to carry a migration bridge (`repeatingGroups`) for
    // the numbered `card1Title` / `logo1Image` families. No core type ever
    // declared it, and the v7 -> v8 schema fold moved the last three families
    // into their arrays, so the bridge went with them: a deck carrying BOTH
    // shapes would have projected its cards twice.
    for (const [name, def] of Object.entries(SLIDE_TYPES)) {
      assert.equal(
        'repeatingGroups' in def,
        false,
        `${name} declares repeatingGroups`,
      );
    }
  });
});

describe('the legacy numbered slot families project exactly once', () => {
  // The "done when" of the v7 -> v8 fold: a deck stored in the old numbered
  // form, one stored in the array form, and one carrying BOTH (which the
  // seeded defaults made common) must all read the same in the reader — one
  // block per card, no loose paragraphs, no doubling.
  const FAMILIES = [
    [
      'team-cards-slide',
      { cardCount: '2', card1Name: 'Ada', card1Byline: 'Eng', card2Name: 'Bo' },
      {
        members: [
          { name: 'Ada', byline: 'Eng' },
          { name: 'Bo', byline: '' },
        ],
      },
      ['Ada', 'Eng', 'Bo'],
    ],
    [
      'logo-wall-slide',
      { logoCount: '2', logo1Name: 'Acme', logo2Name: 'Beta' },
      { logos: [{ name: 'Acme' }, { name: 'Beta' }] },
      ['Acme', 'Beta'],
    ],
    [
      'icon-card-grid-slide',
      {
        cardCount: '2',
        card1Icon: 'rocket',
        card1Title: 'One',
        card1Body: 'first',
        card2Title: 'Two',
      },
      {
        items: [
          { icon: 'rocket', title: 'One', body: 'first' },
          { title: 'Two' },
        ],
      },
      ['One', 'first', 'Two'],
    ],
  ];

  const project = (type, content) => {
    const deck = migratePresentation({
      schemaVersion: 7,
      slides: [{ type, content }],
    });
    const slide = deck.slides[0];
    const def = SLIDE_TYPES[type];
    const { key: headingKey, text: headingText } = slideHeading(slide, def);
    return renderSlideBodySemanticHtml(slide, def, { headingKey, headingText });
  };
  const occurrences = (html, needle) => html.split(needle).length - 1;

  for (const [type, flat, array, probes] of FAMILIES) {
    it(`${type}: old form, array form and both-at-once all read the same`, () => {
      const shapes = {
        'old form': structuredClone(flat),
        'array form': structuredClone(array),
        'both forms': { ...structuredClone(flat), ...structuredClone(array) },
      };
      const rendered = Object.entries(shapes).map(([label, content]) => [
        label,
        project(type, content),
      ]);
      for (const [label, html] of rendered) {
        for (const probe of probes)
          assert.equal(
            occurrences(html, probe),
            1,
            `${type} (${label}) projects "${probe}" ${occurrences(html, probe)}x`,
          );
        // No count enum, no numbered slot key, no icon name as prose.
        assert.ok(
          !/card\d|logo\d|cardCount|logoCount|rocket/.test(html),
          `${type} (${label}) leaked a legacy key: ${html}`,
        );
        // One block per card, not loose paragraphs.
        assert.match(html, /<ul class="reader-items"[ >]/);
      }
      const [first, ...rest] = rendered.map(([, html]) => html);
      for (const html of rest) assert.equal(html, first);
    });
  }
});

describe('url field projection', () => {
  it('renders a safe url as an <a href>', () => {
    const def = { fields: [{ key: 'link', type: 'url' }] };
    const html = body({ content: { link: 'https://example.com/x' } }, def);
    assert.ok(
      /<a href="https:\/\/example\.com\/x">https:\/\/example\.com\/x<\/a>/.test(
        html,
      ),
      html,
    );
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
            itemFields: [
              { key: 'title', type: 'string' },
              { key: 'body', type: 'markdown' },
            ],
          },
        ],
      },
    ],
  });

  it('renders an ordered <ol> with a relation marker when rows carry an arrow', () => {
    const html = body(
      {
        content: {
          rows: [
            {
              title: 'Phase 1',
              arrow: 'down',
              blocks: [{ title: 'A', body: 'a' }],
            },
            {
              title: 'Phase 2',
              arrow: 'none',
              blocks: [{ title: 'B', body: 'b' }],
            },
          ],
        },
      },
      relDef(),
    );
    assert.ok(/^<ol class="reader-items" data-field="rows">/.test(html), html);
    assert.ok(
      /class="reader-relation" data-field="arrow" data-relation="down">leads to</.test(
        html,
      ),
      html,
    );
    // nested blocks stay an unordered sub-list
    assert.ok(
      /<ul class="reader-items" data-field="blocks"><li class="reader-item"><h3 data-field="title">A<\/h3>/.test(
        html,
      ),
      html,
    );
    // the row heading is a heading, the arrow enum never renders as content
    assert.ok(/<h3 data-field="title">Phase 1<\/h3>/.test(html), html);
    assert.ok(!/none/.test(html), html);
  });

  it('stays an unordered <ul> with no marker when no row has an arrow', () => {
    const html = body(
      {
        content: {
          rows: [
            {
              title: 'Only',
              arrow: 'none',
              blocks: [{ title: 'A', body: 'a' }],
            },
          ],
        },
      },
      relDef(),
    );
    assert.ok(/^<ul class="reader-items" data-field="rows">/.test(html), html);
    assert.ok(!/reader-relation/.test(html), html);
  });
});

describe('the structure contract: tabular projects to a real <table>', () => {
  // `SLIDE_STRUCTURE_CONTRACTS.tabular` promises a reader "read the item array
  // as rows and each item's keys as columns". Before this, the projection sent
  // a table slide out as a bullet list of rows with ten paragraphs under each —
  // a published contract made untrue by our own reference reader.
  const tabular = (fieldExtra = {}) => ({
    structure: 'tabular',
    defaults: { colCount: '3', headerRow: 'on' },
    fields: [
      { key: 'title', type: 'string' },
      { key: 'caption', type: 'string' },
      { key: 'headerRow', type: 'enum' },
      { key: 'colCount', type: 'enum', hidden: true },
      {
        key: 'rows',
        type: 'items',
        itemFields: [
          { key: 'c1', type: 'string' },
          { key: 'c2', type: 'string' },
          { key: 'c3', type: 'string' },
        ],
        ...fieldExtra,
      },
    ],
  });
  const rows = [
    { c1: 'Year', c2: 'Revenue', c3: 'Profit' },
    { c1: '2024', c2: '10', c3: '2' },
  ];

  it('renders rows as <tr> and the first row as <th scope="col">', () => {
    const html = body(
      { content: { title: 'T', rows } },
      tabular({ headerRowKey: 'headerRow' }),
      { headingKey: 'title' },
    );
    assert.ok(/<table class="reader-table"[ >]/.test(html), html);
    assert.ok(/<th scope="col">Year<\/th>/.test(html), html);
    assert.ok(/<tbody><tr><td>2024<\/td>/.test(html), html);
    assert.ok(!/reader-items/.test(html), html);
  });

  it('treats the first row as data when the header key says off', () => {
    const html = body(
      { content: { title: 'T', headerRow: 'off', rows } },
      tabular({ headerRowKey: 'headerRow' }),
      { headingKey: 'title' },
    );
    assert.ok(!/<thead/.test(html), html);
    assert.ok(/<td>Year<\/td>/.test(html), html);
  });

  it('bounds the columns by the declared count key, so stale cells stay out', () => {
    const stale = [
      { c1: 'A', c2: 'B', c3: 'LEAK' },
      { c1: 'C', c2: 'D', c3: 'LEAK' },
    ];
    const html = body(
      { content: { title: 'T', colCount: '2', rows: stale } },
      tabular({ columnCountKey: 'colCount' }),
      { headingKey: 'title' },
    );
    assert.ok(!/LEAK/.test(html), html);
    assert.ok(/<td>A<\/td><td>B<\/td>/.test(html), html);
  });

  it('uses the declared caption key as <caption>, not as a loose paragraph', () => {
    const html = body(
      { content: { title: 'T', caption: 'In thousands', rows } },
      tabular({ captionKey: 'caption', headerRowKey: 'headerRow' }),
      { headingKey: 'title' },
    );
    assert.ok(/<caption>In thousands<\/caption>/.test(html), html);
    assert.ok(!/<p[^>]*>In thousands<\/p>/.test(html), html);
  });

  it('renders a markdown cell inline, without a block <p> wrapper', () => {
    const def = tabular();
    def.fields[4].itemFields[0].type = 'markdown';
    const html = body(
      { content: { title: 'T', rows: [{ c1: '**bold**', c2: 'plain' }] } },
      def,
      { headingKey: 'title' },
    );
    assert.ok(/<td><strong>bold<\/strong><\/td>/.test(html), html);
    assert.ok(!/<td><p/.test(html), html);
  });

  it('rowHeader: \'first\' makes the first column <th scope="row">; the corner stays a column header', () => {
    const html = body(
      { content: { title: 'T', rows } },
      tabular({ headerRowKey: 'headerRow', rowHeader: 'first' }),
      { headingKey: 'title' },
    );
    assert.ok(
      html.includes(
        '<thead><tr><th scope="col">Year</th><th scope="col">Revenue</th>',
      ),
      html,
    );
    assert.ok(
      html.includes('<tbody><tr><th scope="row">2024</th><td>10</td>'),
      html,
    );
  });

  it('table-slide declares its first column the row header', () => {
    const def = SLIDE_TYPES['table-slide'];
    const html = body(
      {
        type: 'table-slide',
        content: { ...structuredClone(def.defaults), title: 'T' },
      },
      def,
      { headingKey: 'title' },
    );
    assert.ok(/<th scope="row">Row 1<\/th>/.test(html), html);
  });

  it('falls back to every declared column with no header when nothing is declared', () => {
    const html = body({ content: { title: 'T', rows } }, tabular(), {
      headingKey: 'title',
    });
    assert.ok(!/<thead/.test(html), html);
    assert.ok(
      /<td>Year<\/td><td>Revenue<\/td><td>Profit<\/td>/.test(html),
      html,
    );
  });
});

describe('the structure contract: a dataset names the encoding it drops', () => {
  // `SLIDE_STRUCTURE_CONTRACTS.dataset` tells a reader to decode the payload to
  // rows and lose "only the visual encoding" — honest only if that encoding is
  // named. The caption is built from the fields' own declared labels, so there
  // is no reader-side copy to drift.
  const dataset = {
    structure: 'dataset',
    fields: [
      { key: 'title', type: 'string' },
      { key: 'chartType', label: 'Chart type', type: 'enum' },
      {
        key: 'data',
        type: 'csv',
        encodingKeys: ['chartType', 'xLabel', 'yLabel'],
      },
      {
        key: 'xLabel',
        label: 'X label',
        type: 'string',
        visibleWhen: { field: 'chartType', in: ['bar'] },
      },
      { key: 'yLabel', label: 'Y label', type: 'string' },
    ],
  };

  it('captions the decoded table with the encoding fields', () => {
    const html = body(
      {
        content: {
          title: 'T',
          chartType: 'bar',
          data: 'Year,Rev\n2024,10',
          xLabel: 'Year',
          yLabel: 'EUR',
        },
      },
      dataset,
      { headingKey: 'title' },
    );
    assert.ok(
      /<caption>Chart type: bar\. X label: Year\. Y label: EUR\.<\/caption>/.test(
        html,
      ),
      html,
    );
    // …and never twice: the encoding fields are consumed by the caption.
    assert.ok(!/<p[^>]*>Year<\/p>/.test(html), html);
    assert.ok(!/<p[^>]*>EUR<\/p>/.test(html), html);
  });
});

describe('fields the type declares inactive do not project', () => {
  // The editor and the canvas both honour `visibleWhen`; a third surface that
  // did not was how a bar chart's legend labels reached the reader as prose.
  const def = {
    fields: [
      { key: 'title', type: 'string' },
      { key: 'chartType', type: 'enum' },
      {
        key: 'seriesLabel',
        type: 'string',
        visibleWhen: { field: 'chartType', in: ['line'] },
      },
    ],
  };

  it('skips a field whose condition is unmet', () => {
    const html = body(
      { content: { title: 'T', chartType: 'bar', seriesLabel: 'LEAK' } },
      def,
      { headingKey: 'title' },
    );
    assert.equal(html, '');
  });

  it('keeps it when the condition holds', () => {
    const html = body(
      { content: { title: 'T', chartType: 'line', seriesLabel: 'Revenue' } },
      def,
      { headingKey: 'title' },
    );
    assert.ok(/<p data-field="seriesLabel">Revenue<\/p>/.test(html), html);
  });

  it('resolves an unset driver against the type defaults', () => {
    const html = body(
      { content: { title: 'T', seriesLabel: 'LEAK' } },
      { ...def, defaults: { chartType: 'bar' } },
      { headingKey: 'title' },
    );
    assert.equal(html, '');
  });
});

describe('a field the type declares presentational is not document text', () => {
  // The type-level rule (enum/colour/number/boolean) cannot reach these: an
  // icon name, an infrastructure id and a serialized coordinate list are all
  // `string`, so only the field itself can say its value is machine data.
  it('skips a presentational string on the slide', () => {
    const def = {
      fields: [
        { key: 'title', type: 'string' },
        { key: 'libraryId', type: 'string', presentational: true },
        { key: 'note', type: 'string' },
      ],
    };
    const html = body(
      { content: { title: 'T', libraryId: '366590', note: 'Real text' } },
      def,
      { headingKey: 'title' },
    );
    assert.ok(!html.includes('366590'), html);
    assert.ok(html.includes('<p data-field="note">Real text</p>'), html);
  });

  it('skips a presentational item field, and never makes it the <h3>', () => {
    const def = {
      fields: [
        {
          key: 'items',
          type: 'items',
          itemFields: [
            { key: 'icon', type: 'string', presentational: true },
            { key: 'title', type: 'string' },
            { key: 'body', type: 'markdown' },
          ],
        },
      ],
    };
    const html = body(
      {
        content: { items: [{ icon: 'rocket', title: 'Speed', body: 'Fast.' }] },
      },
      def,
    );
    assert.ok(html.includes('<h3 data-field="title">Speed</h3>'), html);
    assert.ok(!html.includes('rocket'), html);
  });

  it('leaves a presentational column out of a tabular projection', () => {
    const def = {
      structure: 'tabular',
      fields: [
        {
          key: 'rows',
          type: 'items',
          itemFields: [
            { key: 'a', type: 'string' },
            { key: 'sortKey', type: 'string', presentational: true },
          ],
        },
      ],
    };
    const html = body({ content: { rows: [{ a: 'A', sortKey: '007' }] } }, def);
    assert.ok(html.includes('<table'), html);
    assert.ok(!html.includes('007'), html);
  });
});

describe('an item folds its own image siblings into the <figure>', () => {
  // Slide-level content has always done this; items did not, so a card's alt
  // text was both the figure's `alt` and — being the first declared string —
  // the card's own <h3>.
  const def = {
    fields: [
      {
        key: 'members',
        type: 'items',
        itemFields: [
          { key: 'image', type: 'image' },
          { key: 'alt', type: 'string' },
          { key: 'name', type: 'string' },
          { key: 'byline', type: 'string' },
        ],
      },
    ],
  };

  it('does not repeat the alt text as a paragraph or a heading', () => {
    const html = body(
      {
        content: {
          members: [
            {
              image: 'https://example.com/p.jpg',
              alt: 'Ada at her desk',
              name: 'Ada Lovelace',
              byline: 'Engineer',
            },
          ],
        },
      },
      def,
    );
    assert.ok(html.includes('<h3 data-field="name">Ada Lovelace</h3>'), html);
    assert.ok(html.includes('alt="Ada at her desk"'), html);
    assert.ok(!/<p[^>]*>Ada at her desk<\/p>/.test(html), html);
    assert.ok(!/<h3[^>]*>Ada at her desk<\/h3>/.test(html), html);
    assert.ok(html.includes('<p data-field="byline">Engineer</p>'), html);
  });

  it('folds an item caption into <figcaption> instead of beside the picture', () => {
    const galleryDef = {
      fields: [
        {
          key: 'images',
          type: 'items',
          itemFields: [
            { key: 'src', type: 'image' },
            { key: 'caption', type: 'string' },
            { key: 'alt', type: 'string' },
          ],
        },
      ],
    };
    const html = body(
      {
        content: {
          images: [
            {
              src: 'https://example.com/1.jpg',
              caption: 'Sunrise over the bay',
              alt: 'The bay at dawn',
            },
          ],
        },
      },
      galleryDef,
    );
    assert.ok(
      html.includes('<figcaption>Sunrise over the bay</figcaption>'),
      html,
    );
    assert.ok(!/<p[^>]*>Sunrise over the bay<\/p>/.test(html), html);
    assert.ok(!html.includes('<h3>'), html);
  });

  it("uses the item's own heading as the alt fallback", () => {
    const html = body(
      {
        content: {
          members: [
            { image: 'https://example.com/x9f2.jpg', name: 'Alan Turing' },
          ],
        },
      },
      def,
    );
    assert.ok(html.includes('alt="Alan Turing"'), html);
  });
});

describe('itemLabelField — an items field declares its own heading (D81)', () => {
  it('promotes the declared sub-field over the first readable string', () => {
    const def = {
      fields: [
        {
          key: 'metrics',
          type: 'items',
          itemLabelField: 'label',
          itemFields: [
            { key: 'value', type: 'string' },
            { key: 'unit', type: 'string' },
            { key: 'label', type: 'string' },
            { key: 'note', type: 'string' },
          ],
        },
      ],
    };
    const html = body(
      {
        content: {
          metrics: [{ value: '1.2', unit: 'M', label: 'Reach', note: '+12%' }],
        },
      },
      def,
    );
    assert.ok(html.includes('<h3 data-field="label">Reach</h3>'), html);
    assert.ok(!/<h3[^>]*>1\.2<\/h3>/.test(html), html);
    // The fields the heading did not consume still project, in declared order.
    assert.ok(html.includes('<p data-field="value">1.2</p>'), html);
    assert.ok(html.includes('<p data-field="unit">M</p>'), html);
    assert.ok(!/<p[^>]*>Reach<\/p>/.test(html), html);
  });

  it('falls back to the first readable string when nothing is declared', () => {
    const def = {
      fields: [
        {
          key: 'cards',
          type: 'items',
          itemFields: [
            { key: 'label', type: 'string' },
            { key: 'text', type: 'string' },
          ],
        },
      ],
    };
    const html = body(
      { content: { cards: [{ label: 'One', text: 'x' }] } },
      def,
    );
    assert.ok(html.includes('<h3 data-field="label">One</h3>'), html);
  });

  it('falls back when the declared field is empty on this item', () => {
    const def = {
      fields: [
        {
          key: 'metrics',
          type: 'items',
          itemLabelField: 'label',
          itemFields: [
            { key: 'value', type: 'string' },
            { key: 'label', type: 'string' },
            { key: 'note', type: 'string' },
          ],
        },
      ],
    };
    const html = body(
      { content: { metrics: [{ value: '42', label: '', note: 'Up' }] } },
      def,
    );
    assert.ok(html.includes('<h3 data-field="value">42</h3>'), html);
  });

  it('kpi-metrics projects its label as the heading, not its value', () => {
    const type = 'kpi-metrics-slide';
    const def = SLIDE_TYPES[type];
    const slide = { type, content: structuredClone(def.defaults) };
    const { key: headingKey, text: headingText } = slideHeading(slide, def);
    const html = renderSlideBodySemanticHtml(slide, def, {
      headingKey,
      headingText,
    });
    assert.ok(html.includes('<h3 data-field="label">Reach</h3>'), html);
    assert.ok(!/<h3[^>]*>1\.2M?<\/h3>/.test(html), html);
    // The value reads with its unit (D131).
    assert.ok(html.includes('<p data-field="value">1.2M</p>'), html);
  });
});

describe('mediaRef — a reference projects as a stand-in, never as an id (D82)', () => {
  const videoDef = () => ({
    label: 'Video',
    fields: [
      { key: 'title', type: 'string' },
      {
        key: 'source',
        type: 'string',
        mediaRef: { label: 'Video', linkKey: 'watchUrl' },
      },
      { key: 'watchUrl', type: 'string' },
      { key: 'bunnyLibraryId', type: 'string', presentational: true },
    ],
  });

  it('names the medium when the reference is a bare id', () => {
    const html = body(
      { content: { source: '3045cc09-605c-40d9-aa76-9ace93e7f637' } },
      videoDef(),
    );
    assert.ok(html.includes('<p class="reader-media"'), html);
    assert.ok(html.includes('>Video</p>'), html);
    assert.ok(!html.includes('3045cc09'), html);
  });

  it('links the reference when it is a URL, named by the medium', () => {
    const html = body(
      { content: { title: 'Our launch film', source: 'https://youtu.be/abc' } },
      videoDef(),
      { headingKey: 'title', headingText: 'Our launch film' },
    );
    assert.ok(html.includes('<a href="https://youtu.be/abc">Video</a>'), html);
    // The section heading carries the title; the stand-in must not say it
    // again right underneath.
    assert.ok(!html.includes('Our launch film'), html);
  });

  it("the author's linkKey wins over the reference, and does not repeat", () => {
    const html = body(
      {
        content: {
          title: 'Our launch film',
          source: '3045cc09-605c-40d9-aa76-9ace93e7f637',
          watchUrl: 'go.example.nl/film',
        },
      },
      videoDef(),
      { headingKey: 'title', headingText: 'Our launch film' },
    );
    // Scheme-less author input is normalised the same way the PDF ladder does.
    assert.ok(
      html.includes('<a href="https://go.example.nl/film">Video</a>'),
      html,
    );
    // Folded in, not projected a second time as a loose paragraph.
    assert.equal(html.match(/go\.example\.nl/g).length, 1, html);
    assert.ok(!html.includes('3045cc09'), html);
  });

  it('rejects an unsafe reference rather than linking it', () => {
    const html = body(
      // eslint-disable-next-line no-script-url
      { content: { source: 'javascript:alert(1)' } },
      videoDef(),
    );
    assert.ok(!html.includes('<a '), html);
    assert.ok(!html.includes('javascript:'), html);
    assert.ok(html.includes('>Video</p>'), html);
  });

  it('projects nothing when the reference is empty', () => {
    assert.equal(body({ content: { source: '' } }, videoDef()), '');
  });

  it('suppresses the raw reference even when the declaration is malformed', () => {
    const html = body(
      { content: { source: '3045cc09-605c-40d9-aa76-9ace93e7f637' } },
      { fields: [{ key: 'source', type: 'string', mediaRef: {} }] },
    );
    assert.ok(!html.includes('3045cc09'), html);
    assert.ok(html.includes('>Media</p>'), html);
  });

  it('video-slide projects its default Bunny UUID as heading + stand-in', () => {
    const type = 'video-slide';
    const def = SLIDE_TYPES[type];
    const slide = { type, content: structuredClone(def.defaults) };
    const { key: headingKey, text: headingText } = slideHeading(slide, def);
    const html = renderSlideBodySemanticHtml(slide, def, {
      headingKey,
      headingText,
    });
    // The default deck has no title, so the section heading is the type label.
    assert.equal(headingText, 'Video');
    assert.ok(html.includes('<p class="reader-media"'), html);
    assert.ok(html.includes('>Video</p>'), html);
    assert.ok(!html.includes(def.defaults.source), html);
    // The library id was already presentational and stays out.
    assert.ok(!html.includes('366590'), html);
  });
});

describe('role — the projection reads what a text field is (D128)', () => {
  const quoteDef = SLIDE_TYPES['quote-slide'];
  const calloutDef = SLIDE_TYPES['callout-slide'];

  it('a quote is a <blockquote>, its name and role one <footer> beside it', () => {
    const html = body(
      {
        content: {
          quote: 'Ship it.',
          authorName: 'Ada',
          authorTitle: 'Engineer',
        },
      },
      quoteDef,
    );
    assert.ok(
      html.includes(
        '<blockquote data-field="quote"><p>Ship it.</p></blockquote>\n<footer><p data-field="authorName">Ada</p>\n<p data-field="authorTitle">Engineer</p></footer>',
      ),
      html,
    );
    assert.ok(!/<blockquote[^]*<footer[^]*<\/blockquote>/.test(html), html);
  });

  it('an empty attribution leaves no <footer>, a half-filled one keeps its line', () => {
    const none = body({ content: { quote: 'Ship it.' } }, quoteDef);
    assert.ok(!none.includes('<footer'), none);
    const half = body(
      { content: { quote: 'Ship it.', authorTitle: 'Engineer' } },
      quoteDef,
    );
    assert.ok(
      half.includes(
        '<footer><p data-field="authorTitle">Engineer</p></footer>',
      ),
      half,
    );
  });

  it('extra quotes get the same table inside their item, and no <h3>', () => {
    const html = body(
      {
        content: {
          quote: 'One.',
          quotes: [{ quote: 'Two.', authorName: 'Grace' }],
        },
      },
      quoteDef,
    );
    assert.ok(
      html.includes(
        '<li class="reader-item"><blockquote data-field="quote"><p>Two.</p></blockquote>\n<footer><p data-field="authorName">Grace</p></footer></li>',
      ),
      html,
    );
    assert.ok(!html.includes('<h3'), 'a quote never heads its item');
  });

  it('a callout source is the footer, its label the eyebrow', () => {
    const html = body(
      {
        content: {
          variant: 'tip',
          label: 'Pro tip',
          body: 'Write tests.',
          source: 'Folklore',
        },
      },
      calloutDef,
    );
    assert.ok(
      html.includes('<p class="reader-label" data-field="label">Pro tip</p>'),
      html,
    );
    assert.ok(!html.includes('<dfn>'), 'only a definition defines a term');
    assert.ok(
      html.includes('<footer><p data-field="source">Folklore</p></footer>'),
      html,
    );
  });

  it('a definition wraps its label in <dfn>, read through termWhen', () => {
    const html = body(
      { content: { variant: 'definition', label: 'Latency', body: 'Delay.' } },
      calloutDef,
    );
    assert.ok(
      html.includes(
        '<p class="reader-label" data-field="label"><dfn>Latency</dfn></p>',
      ),
      html,
    );
  });

  it('a caption beside one figure is its <figcaption>, else a caption line', () => {
    const def = {
      fields: [
        {
          key: 'members',
          type: 'items',
          itemFields: [
            { key: 'image', type: 'image' },
            { key: 'name', type: 'string' },
            { key: 'byline', type: 'string', role: 'caption' },
          ],
        },
      ],
    };
    const html = body(
      {
        content: {
          members: [
            { image: 'https://example.com/a.png', name: 'Ada', byline: 'CEO' },
            { name: 'Grace', byline: 'CTO' },
          ],
        },
      },
      def,
    );
    assert.ok(
      html.includes(
        '<img src="https://example.com/a.png" alt="Ada" loading="lazy" /><figcaption data-field="byline">CEO</figcaption></figure>',
      ),
      html,
    );
    assert.equal((html.match(/CEO/g) || []).length, 1, 'not repeated');
    assert.ok(
      html.includes('<p class="reader-caption" data-field="byline">CTO</p>'),
      html,
    );
  });

  it('a logo named only by its caption keeps that name as alt', () => {
    const html = body(
      {
        content: {
          logos: [{ image: 'https://example.com/acme-logo.png', name: 'Acme' }],
        },
      },
      SLIDE_TYPES['logo-wall-slide'],
    );
    assert.ok(
      html.includes(
        'alt="Acme" loading="lazy" /><figcaption data-field="name">Acme</figcaption>',
      ),
      html,
    );
  });

  it('a markdown quote wraps its own blocks, not a second paragraph', () => {
    const html = body(
      { content: { said: 'One.\n\nTwo.' } },
      { fields: [{ key: 'said', type: 'markdown', role: 'quote' }] },
    );
    assert.match(
      html,
      /^<blockquote data-field="said"><p>One\.<\/p>\s*<p>Two\.<\/p>\s*<\/blockquote>$/,
    );
  });
});

describe('the deck language reaches the projection (B294, D130c)', () => {
  const callout = SLIDE_TYPES['callout-slide'];
  const chart = SLIDE_TYPES['chart-slide'];
  const section = (slide, def, lang) =>
    renderSlideSectionHtml(slide, def, { index: 0, lang });

  it('a blank callout label is the kind word, in eyebrow and hidden heading', () => {
    const slide = {
      type: 'callout-slide',
      content: { variant: 'insight', label: '', body: 'One idea.' },
    };
    for (const [lang, word] of [
      ['nl', 'Kernpunt'],
      ['en-GB', 'Key insight'],
    ]) {
      const html = section(slide, callout, lang);
      assert.ok(
        html.includes(
          `<h2 id="slide-1-title" class="reader-sr-only">${word}</h2>`,
        ),
        html,
      );
      assert.ok(
        html.includes(`<p class="reader-label" data-field="label">${word}</p>`),
        html,
      );
    }
  });

  it('the canvas and the reader say the same eyebrow word', () => {
    for (const lang of ['nl', 'en-GB']) {
      const content = { variant: 'warning', body: 'Careful.' };
      const canvas = callout.renderHtml(content, null, { lang });
      const word = canvas.match(/class="callout-label"[^>]*>([^<]*)</)[1];
      assert.ok(
        section({ type: 'callout-slide', content }, callout, lang).includes(
          `data-field="label">${word}</p>`,
        ),
      );
    }
  });

  it('an authored label wins, and only an authored definition is a <dfn>', () => {
    const authored = section(
      {
        type: 'callout-slide',
        content: { variant: 'definition', label: 'Latency', body: 'Delay.' },
      },
      callout,
      'nl',
    );
    assert.ok(authored.includes('<dfn>Latency</dfn>'), authored);
    assert.ok(!authored.includes('Definitie'), authored);
    const blank = section(
      { type: 'callout-slide', content: { variant: 'definition', body: 'x' } },
      callout,
      'nl',
    );
    assert.ok(
      blank.includes(
        '<p class="reader-label" data-field="label">Definitie</p>',
      ),
      blank,
    );
    assert.ok(!blank.includes('<dfn>'), blank);
  });

  it('without a copyKey on the option, a blank stays blank', () => {
    const def = {
      label: 'Kinds',
      labelField: 'label',
      fields: [
        { key: 'kind', type: 'enum', options: [{ value: 'a', label: 'A' }] },
        {
          key: 'label',
          type: 'string',
          role: 'label',
          defaultFromOption: 'kind',
        },
      ],
    };
    const html = section({ type: 'x', content: { kind: 'a' } }, def, 'nl');
    assert.ok(html.includes('class="reader-sr-only">Kinds</h2>'), html);
    assert.ok(!html.includes('reader-label'), html);
  });

  it('on a markdown field the declaration is ignored, as the walk says', () => {
    const def = {
      label: 'Kinds',
      fields: [
        {
          key: 'kind',
          type: 'enum',
          options: [{ value: 'a', label: 'A', copyKey: 'admonitionTip' }],
        },
        { key: 'body', type: 'markdown', defaultFromOption: 'kind' },
      ],
    };
    const html = section({ type: 'x', content: { kind: 'a' } }, def, 'nl');
    assert.ok(!html.includes('Tip'), html);
    assert.ok(!html.includes('data-field="body"'), html);
  });

  it('a line chart names its series and captions the data with its summary', () => {
    const content = {
      title: 'Growth',
      chartType: 'line',
      data: 'Month,Sales,Target\nJan,30,25\nFeb,45,40',
      series1Label: 'Sales',
      series2Label: 'Target',
    };
    const nl = section({ type: 'chart-slide', content }, chart, 'nl');
    assert.match(
      nl,
      /<caption>Lijndiagram met 2 punten\. Min: 25\. Max: 45\. Chart type: line\. Series 1 label \(legend\): Sales\. Series 2 label \(legend\): Target\.<\/caption>/,
    );
    // Consumed by the caption, never loose paragraphs too.
    assert.ok(!/<p[^>]*>Sales<\/p>/.test(nl), nl);
    const en = section({ type: 'chart-slide', content }, chart, 'en-GB');
    assert.match(en, /<caption>Line chart with 2 points\. Min: 25\. Max: 45\./);
    // The canvas gives assistive tech the same sentence.
    const canvas = chart.renderHtml(content, null, { lang: 'nl' });
    assert.ok(canvas.includes('Lijndiagram met 2 punten. Min: 25. Max: 45.'));
  });

  it('a bar chart names no series, and its summary names the highest point', () => {
    const content = {
      title: 'Revenue',
      chartType: 'bar',
      data: 'Year,Revenue\n2024,10\n2025,14',
      series1Label: 'Ignored',
    };
    const html = section({ type: 'chart-slide', content }, chart, 'en-GB');
    assert.match(
      html,
      /<caption>Bar chart with 2 points\. Highest: 2025 \(14\)\. Chart type: bar\.<\/caption>/,
    );
    assert.ok(!html.includes('Ignored'), html);
  });
});

describe('list structure is a declaration (B295, D130a)', () => {
  const listDef = {
    defaults: { variant: 'bullets' },
    fields: [
      { key: 'variant', type: 'enum', options: ['bullets', 'numbers'] },
      {
        key: 'items',
        type: 'items',
        orderedWhen: { field: 'variant', in: ['numbers'] },
        itemFields: [
          { key: 'title', type: 'string' },
          { key: 'text', type: 'string' },
        ],
      },
    ],
  };
  const items = [
    { title: 'One', text: 'First' },
    { title: 'Two', text: 'Second' },
  ];

  it('orderedWhen: an <ol> while the predicate holds, a <ul> otherwise', () => {
    const numbered = body({ content: { variant: 'numbers', items } }, listDef);
    assert.ok(/<ol class="reader-items" data-field="items">/.test(numbered));
    const bulleted = body({ content: { items } }, listDef);
    assert.ok(/<ul class="reader-items" data-field="items">/.test(bulleted));
  });

  it('list-slide is numbered in the reader exactly where its canvas is', () => {
    const def = SLIDE_TYPES['list-slide'];
    for (const variant of ['bullets', 'numbers']) {
      const content = { ...structuredClone(def.defaults), variant };
      const canvas = def.renderHtml(content, { content }, {});
      const reader = body({ type: 'list-slide', content }, def);
      const tag = variant === 'numbers' ? 'ol' : 'ul';
      assert.ok(new RegExp(`<${tag}[ >]`).test(canvas), canvas);
      assert.ok(
        new RegExp(`<${tag} class="reader-items"`).test(reader),
        reader,
      );
    }
  });

  it('an item with nothing under its heading string is the <li> text', () => {
    const html = body(
      {
        content: {
          items: [{ title: 'Alone' }, { title: 'Head', text: 'Body' }],
        },
      },
      listDef,
    );
    assert.ok(
      html.includes('<li class="reader-item" data-field="title">Alone</li>'),
      html,
    );
    assert.ok(html.includes('<h3 data-field="title">Head</h3>'), html);
    assert.ok(!html.includes('<h3 data-field="title">Alone</h3>'), html);
  });

  it('poll and likert options are list lines, not headings', () => {
    for (const type of ['poll-slide', 'likert-slide']) {
      const def = SLIDE_TYPES[type];
      const html = body({ type, content: structuredClone(def.defaults) }, def);
      assert.ok(!/<h3/.test(html), `${type}: ${html}`);
      assert.ok(/<li class="reader-item" data-field="text">/.test(html), html);
    }
  });
});

describe('pairs stay pairs (D131)', () => {
  it('a value and its unit are one block, with no space invented', () => {
    const def = {
      fields: [
        {
          key: 'metrics',
          type: 'items',
          itemLabelField: 'label',
          itemFields: [
            { key: 'value', type: 'string', unitKey: 'unit' },
            { key: 'unit', type: 'string' },
            { key: 'label', type: 'string' },
          ],
        },
      ],
    };
    const html = body(
      {
        content: {
          metrics: [
            { value: '98', unit: '%', label: 'Satisfaction' },
            { value: '3', unit: '', label: 'Offices' },
          ],
        },
      },
      def,
    );
    assert.ok(html.includes('<p data-field="value">98%</p>'), html);
    assert.ok(html.includes('<p data-field="value">3</p>'), html);
    assert.ok(!html.includes('data-field="unit"'), html);
  });

  it('a link text links to its target, and without one projects nothing', () => {
    const def = {
      fields: [
        { key: 'social1Label', type: 'string', hrefKey: 'social1Url' },
        { key: 'social1Url', type: 'url' },
        { key: 'social2Label', type: 'string', hrefKey: 'social2Url' },
        { key: 'social2Url', type: 'url' },
      ],
    };
    const html = body(
      {
        content: {
          social1Label: 'LinkedIn',
          social1Url: 'https://www.linkedin.com/in/x',
          social2Label: 'Mastodon',
          social2Url: '',
        },
      },
      def,
    );
    assert.equal(
      html,
      '<p data-field="social1Label"><a href="https://www.linkedin.com/in/x">LinkedIn</a></p>',
    );
  });

  it('an action button label is the link, not a heading over it', () => {
    const def = SLIDE_TYPES['content-slide'];
    const html = body(
      {
        content: {
          title: 'T',
          actions: [{ label: 'Start', url: 'https://example.com/start' }],
        },
      },
      def,
      { headingKey: 'title' },
    );
    assert.ok(
      html.includes(
        '<li class="reader-item"><p data-field="label"><a href="https://example.com/start">Start</a></p></li>',
      ),
      html,
    );
  });

  it('a slide jump links to that section of the reader, or not at all', () => {
    const def = { fields: [{ key: 'link', type: 'url' }] };
    const project = (link, opts) =>
      body({ content: { link } }, def, { lang: 'en-GB', ...opts });
    assert.equal(
      project('#2'),
      '<p data-field="link"><a href="#slide-2">Slide 2</a></p>',
    );
    assert.equal(
      project('#slide:b', { slideIds: ['a', 'b', 'c'], lang: 'nl' }),
      '<p data-field="link"><a href="#slide-2">Dia 2</a></p>',
    );
    // A jump past the end of the document, or to a slide it does not hold.
    assert.equal(project('#4', { slideIds: ['a', 'b'] }), '');
    assert.equal(project('#slide:gone', { slideIds: ['a'] }), '');
    assert.equal(project('#slide:a'), '');
    assert.equal(project('javascript:alert(1)'), '');
  });

  it('an email address is a mailto link; anything else is nothing', () => {
    const def = { fields: [{ key: 'contactEmail', type: 'email' }] };
    assert.equal(
      body({ content: { contactEmail: 'robin@example.com' } }, def),
      '<p data-field="contactEmail"><a href="mailto:robin@example.com">robin@example.com</a></p>',
    );
    assert.equal(body({ content: { contactEmail: 'robin' } }, def), '');
  });

  it('a block headed by a sibling gets that sibling as its <h3>', () => {
    const def = SLIDE_TYPES['comparison-slide'];
    const html = body(
      {
        content: {
          leftTitle: 'Build',
          leftBody: 'Own it',
          rightTitle: 'Buy',
          rightBody: '',
        },
      },
      def,
    );
    assert.ok(
      html.includes(
        '<h3 data-field="leftTitle">Build</h3>\n<div data-field="leftBody"><p>Own it</p></div>',
      ),
      html,
    );
    // Nothing under it: the title is its own line, not a heading over nothing.
    assert.ok(html.includes('<p data-field="rightTitle">Buy</p>'), html);
    assert.ok(!html.includes('<h3 data-field="rightTitle">'), html);
  });

  it('a duration is one <time>, resolved by the rule the canvas counts down from', () => {
    const def = SLIDE_TYPES['countdown-slide'];
    const time = (content) =>
      body({ content }, def).match(/<time[^>]*>[^<]*<\/time>/)?.[0];
    assert.equal(
      time({ durationMinutes: 1, durationSeconds: 30 }),
      '<time datetime="PT1M30S">1:30</time>',
    );
    assert.equal(
      time({ durationMinutes: 0, durationSeconds: 45 }),
      '<time datetime="PT45S">0:45</time>',
    );
    // Clamped to the declared max; a zero length takes the declared defaults.
    assert.equal(
      time({ durationMinutes: 90, durationSeconds: 0 }),
      '<time datetime="PT60M">60:00</time>',
    );
    assert.equal(
      time({ durationMinutes: 0, durationSeconds: 0 }),
      '<time datetime="PT5M">5:00</time>',
    );
    assert.ok(!body({ content: {} }, def).includes('durationSeconds'));
  });

  it('a type-level scale projects its two ends as a <dl>', () => {
    const def = SLIDE_TYPES['likert-slider-slide'];
    assert.equal(
      body({ content: { minLabel: 'Low', maxLabel: '' } }, def),
      '<dl class="reader-fields"><div class="reader-field"><dt>1</dt><dd data-field="minLabel">Low</dd></div></dl>',
    );
  });

  it('the feedback placeholder is the input hint, not document text', () => {
    const def = SLIDE_TYPES['feedback-slide'];
    const html = body(
      { content: { question: 'Q', placeholder: 'Type here' } },
      def,
      { headingKey: 'question' },
    );
    assert.equal(html, '');
  });
});
