/**
 * Contract test for the semantic reflowable reader export (PR 7, move 5a).
 *
 * Asserts the accessibility/reflow contract on the produced document:
 * single <h1>, one <h2> per slide with matching ids + aria-labelledby,
 * <header>/<nav>/<main> landmarks, <html lang/dir>, every <img> has an alt,
 * no <script> (readable with JS off), no fixed 1600x900 canvas geometry, and
 * no `--t-*` — the reader shares neither selector nor variable vocabulary with
 * the canvas chain.
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
      content: {
        title: 'Where we are',
        body: '## Momentum\n\nRevenue is **up**.\n\n- one\n- two',
      },
    },
    {
      id: 'b',
      type: 'image-slide',
      content: {
        image: '/uploads/chart.png',
        alt: 'Revenue chart',
        caption: 'Q3 revenue',
      },
    },
    {
      id: 'c',
      type: 'content-slide',
      content: {
        a11yTitle: 'Accessible label',
        a11ySummary: 'A short summary.',
        body: 'Body text.',
      },
    },
  ],
};

const html = buildReaderHtml('/repo', pres, {
  context: 'published',
  canonicalUrl: '/p/abc-x',
});

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
    assert.ok(
      html.includes(
        'name="description" content="The Q3 story in a few slides."',
      ),
    );
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
    assert.equal(
      (
        html.match(
          /<h2 id="slide-\d+-title"(?: class="sr-only"| data-field="\w+")?>/g,
        ) || []
      ).length,
      3,
    );
    const types = ['content-slide', 'image-slide', 'content-slide'];
    for (const n of [1, 2, 3]) {
      assert.ok(
        html.includes(
          `<section id="slide-${n}" class="reader-slide" data-slide-type="${types[n - 1]}" aria-labelledby="slide-${n}-title">`,
        ),
        `section ${n}`,
      );
    }
  });
  it('shows the declared heading and hides a name (D129)', () => {
    // content-slide declares `role: 'heading'` on `title`: visible.
    assert.ok(
      html.includes(
        '<h2 id="slide-1-title" data-field="title">Where we are</h2>',
      ),
      html,
    );
    // image-slide without a title: hidden, named by its labelField (caption),
    // and the caption is still the figure's <figcaption>.
    assert.ok(
      html.includes('<h2 id="slide-2-title" class="sr-only">Q3 revenue</h2>'),
      html,
    );
    assert.ok(html.includes('<figcaption>Q3 revenue</figcaption>'), html);
  });
  it('numbers sections with CSS counters, never as heading text (D133)', () => {
    assert.ok(!html.includes('reader-num'), 'no number span in the markup');
    assert.match(html, /counter-increment: reader-slide/);
    assert.match(html, /h2::before/);
  });
  it('an a11yTitle beside a visible title names the section, not the heading', () => {
    const doc = buildReaderHtml('/repo', {
      title: 'T',
      slides: [
        {
          type: 'content-slide',
          content: { title: 'Visible title', a11yTitle: 'Spoken name' },
        },
      ],
    });
    assert.ok(
      doc.includes(
        '<section id="slide-1" class="reader-slide" data-slide-type="content-slide" aria-label="Spoken name">',
      ),
      doc,
    );
    assert.ok(
      doc.includes(
        '<h2 id="slide-1-title" data-field="title">Visible title</h2>',
      ),
      doc,
    );
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
    assert.ok(
      html.includes('>Accessible label</h2>') ||
        html.includes('Accessible label</h2>'),
      html,
    );
    assert.ok(
      html.includes('class="reader-summary"') &&
        html.includes('A short summary.'),
    );
  });
  it('is readable with JavaScript off (no <script>)', () => {
    assert.ok(!/<script/i.test(html), 'reader must ship no script');
  });
  it('uses no fixed 1600x900 canvas geometry', () => {
    assert.ok(
      !/1600px/.test(html) && !/900px/.test(html),
      'no canvas dimensions',
    );
    // The one exception is the shared visually-hidden rule (B447): a 1px
    // clipped box, not layout, read verbatim from the utility sheet.
    const withoutSrOnly = html.replace(/^\.sr-only\s*\{[^}]*\}/m, '');
    assert.ok(
      !/position:\s*absolute/i.test(withoutSrOnly),
      'no absolute canvas positioning',
    );
  });
  it('reads no --t-* theme variable', () => {
    // Not an oversight — a decision (D45). The reader is the reflow chain, and
    // it answers to the reading environment (`color-scheme: light dark`) and to
    // its own contrast and line-length obligations. A canvas theme is picked to
    // look right on a projector; inheriting its colours is how a reading view
    // quietly stops meeting the obligations it exists for. A fork that wants
    // its brand here writes `.reader-*` rules in `custom/styles/`, which lands
    // last on this chain too — see docs/reference/fork-setup.md § Two chains.
    assert.ok(
      !/--t-/.test(html),
      'the reader chain shares no variable vocabulary with the canvas',
    );
  });
  it('projects markdown bodies as real semantic elements', () => {
    assert.ok(html.includes('<h3'), 'markdown ## -> h3');
    assert.ok(
      html.includes('<ul') && html.includes('<li'),
      'markdown list -> ul/li',
    );
    assert.ok(
      html.includes('<strong>up</strong>'),
      'inline emphasis preserved',
    );
  });
});

describe('the chrome speaks the deck language (B312)', () => {
  // The words around the slides come from the slide copy in the document
  // language — the table every other word of this document is read from.
  const chrome = (lang, slides) => {
    const out = buildReaderHtml(
      '/repo',
      { title: '', lang, slides },
      { canonicalUrl: '/p/x' },
    );
    const text = (m) => m?.[1]?.replaceAll('&#039;', "'");
    return {
      kicker: text(out.match(/<p class="reader-kicker">([^<]*)</)),
      title: text(out.match(/<h1>([^<]*)</)),
      view: text(out.match(/class="reader-viewlink"><a [^>]*>([^<]*)</)),
      nav: text(out.match(/<nav class="reader-toc" aria-label="([^"]*)"/)),
      contents: text(out.match(/<nav[^>]*>\s*<h2>([^<]*)</)),
      count: text(out.match(/<footer class="reader-footer">\s*<p>([^<]*)</)),
    };
  };
  const one = [{ id: 'a', type: 'content-slide', content: { title: 'A' } }];
  const two = [
    ...one,
    { id: 'b', type: 'content-slide', content: { title: 'B' } },
  ];

  it('in Dutch', () => {
    assert.deepStrictEqual(chrome('nl', two), {
      kicker: 'Presentatie',
      title: 'Presentatie',
      view: "Bekijk de dia's",
      nav: "Dia's",
      contents: 'Inhoud',
      count: "2 dia's.",
    });
    assert.strictEqual(chrome('nl', one).count, '1 dia.');
  });

  it('in English', () => {
    assert.deepStrictEqual(chrome('en-GB', two), {
      kicker: 'Presentation',
      title: 'Presentation',
      view: 'View the slides',
      nav: 'Slides',
      contents: 'Contents',
      count: '2 slides.',
    });
    assert.strictEqual(chrome('en-GB', one).count, '1 slide.');
  });
});

describe('resilience', () => {
  it('handles an empty deck without throwing', () => {
    const out = buildReaderHtml('/repo', {
      title: 'Empty',
      lang: 'en-GB',
      slides: [],
    });
    assert.ok(out.includes('<main class="reader-main">'));
    assert.ok(out.includes('0 slides'));
  });
  it('projects an unresolvable slide type as an archived slide, content and all', () => {
    // The reader is the COMPLETE surface of the archived-slide contract: the
    // canvas placeholder is bounded by a fixed frame, this one is not, so it is
    // where an author recovers the content of a slide whose type is gone.
    const out = buildReaderHtml('/repo', {
      title: 'X',
      slides: [
        {
          id: 'z',
          type: 'no-such-slide',
          content: { title: 'Kept', tagline: 'Also kept' },
        },
      ],
    });
    assert.ok(out.includes('reader-archived'), 'renders the archived note');
    assert.ok(out.includes('no-such-slide'), 'names the missing type');
    assert.ok(
      out.includes('Also kept'),
      'stored content survives into the reader',
    );
  });
});
