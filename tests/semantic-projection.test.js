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

const { slideHeading, renderSlideBodySemanticHtml } =
  await import('../shared/slide-types/semantic-projection.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { migratePresentation } =
  await import('../shared/slide-types/schema-version.js');

const body = (slide, def, opts) =>
  renderSlideBodySemanticHtml(slide, def, opts);

describe('slideHeading resolution', () => {
  it('prefers an a11yTitle override', () => {
    const h = slideHeading(
      { content: { a11yTitle: 'Override', title: 'Title' } },
      {},
    );
    assert.deepEqual(h, { text: 'Override', key: null });
  });
  it('uses the def labelField next', () => {
    const h = slideHeading(
      { content: { name: 'Ada' } },
      { labelField: 'name' },
    );
    assert.deepEqual(h, { text: 'Ada', key: 'name' });
  });
  it('falls back to common title candidate keys', () => {
    assert.equal(
      slideHeading({ content: { question: 'Why?' } }, {}).text,
      'Why?',
    );
  });
  it('falls back to the type label, then a numbered default', () => {
    assert.equal(
      slideHeading({ content: {} }, { label: 'Quote' }).text,
      'Quote',
    );
    assert.equal(
      slideHeading({ type: '', content: {} }, {}, 4).text,
      'Slide 5',
    );
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
      !html.includes('<p>Chart alt</p>'),
      'alt is not a standalone paragraph',
    );
    assert.ok(html.includes('alt="Chart alt"'), 'alt still used on the img');
  });

  it('always emits an alt attribute even without explicit alt', () => {
    const def = { fields: [{ key: 'image', type: 'image' }] };
    const html = body(
      { content: { image: '/uploads/quarterly-report.png' } },
      def,
    );
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
    assert.ok(/<ol class="reader-items">/.test(oh), oh);
    assert.ok(!/<ul/.test(oh), oh);
    const uh = body(val, unordered);
    assert.ok(/<ul class="reader-items">/.test(uh), uh);
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
        assert.match(html, /<ul class="reader-items">/);
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
    assert.ok(/^<ol class="reader-items">/.test(html), html);
    assert.ok(
      /class="reader-relation" data-relation="down">leads to</.test(html),
      html,
    );
    // nested blocks stay an unordered sub-list
    assert.ok(
      /<ul class="reader-items"><li class="reader-item"><h3>A<\/h3>/.test(html),
      html,
    );
    // the row heading is a heading, the arrow enum never renders as content
    assert.ok(/<h3>Phase 1<\/h3>/.test(html), html);
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
    assert.ok(/^<ul class="reader-items">/.test(html), html);
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
    assert.ok(/<table class="reader-table">/.test(html), html);
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
    assert.ok(!/<p>In thousands<\/p>/.test(html), html);
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
    assert.ok(!/<p>Year<\/p>/.test(html), html);
    assert.ok(!/<p>EUR<\/p>/.test(html), html);
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
    assert.ok(/<p>Revenue<\/p>/.test(html), html);
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
    assert.ok(html.includes('<p>Real text</p>'), html);
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
    assert.ok(html.includes('<h3>Speed</h3>'), html);
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
    assert.ok(html.includes('<h3>Ada Lovelace</h3>'), html);
    assert.ok(html.includes('alt="Ada at her desk"'), html);
    assert.ok(!html.includes('<p>Ada at her desk</p>'), html);
    assert.ok(!html.includes('<h3>Ada at her desk</h3>'), html);
    assert.ok(html.includes('<p>Engineer</p>'), html);
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
    assert.ok(!html.includes('<p>Sunrise over the bay</p>'), html);
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
