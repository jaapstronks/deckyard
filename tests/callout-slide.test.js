/**
 * callout-slide — the admonition family.
 *
 * The type is one definition with a `variant` enum, and every visible
 * difference between the five kinds is DERIVED from that enum: the modifier
 * class, the icon, and the eyebrow an author has not overridden. So the tests
 * below are mostly about derivation staying derivation — a hand-set icon or a
 * hardcoded English eyebrow would pass a render test and fail a deck.
 *
 * Two invariants beyond the per-variant sweep:
 *
 *  1. `definition` marks the TERM as a `<dfn>`, not the explanation. The
 *     element means "this is the word being defined"; putting it round the body
 *     asserts the opposite of what the slide says.
 *  2. The eyebrow fallback follows the DECK's language, not the UI's. It comes
 *     from slide-copy.js for the same reason every other renderer-emitted
 *     string does (docs/reference/slide-copy-language.md).
 *
 * Run with: node --test tests/callout-slide.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { initSanitizer } from '../shared/sanitize.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { SLIDE_COPY } from '../shared/slide-types/slide-copy.js';
import {
  CALLOUT_VARIANTS,
  DEFAULT_CALLOUT_VARIANT,
} from '../shared/slide-types/types/callout-slide/variants.js';
import { calloutBodyBand } from '../shared/slide-types/types/callout-slide/render.js';

// The body is markdown, and markdownToSafeHtml falls back to escaping
// everything when no DOMPurify is present — which is what a bare `node --test`
// process has. The server calls this at boot; without it the markdown
// assertion below would be testing the fallback path instead of the real one.
await initSanitizer();

const DEF = SLIDE_TYPES['callout-slide'];

/** Render a callout slide the way the app does, with a deck language. */
const render = (content, lang = 'en-GB') =>
  renderSlideHtml({ type: 'callout-slide', content }, { lang });

/** The `variant` field's declared option values, in order. */
const variantOptionValues = () =>
  DEF.fields
    .find((f) => f.key === 'variant')
    .options.map((o) => (typeof o === 'string' ? o : o.value));

/** variant → the Lucide glyph the eyebrow is expected to carry. */
const EXPECTED_ICON = {
  insight: 'lightbulb',
  warning: 'circle-alert',
  definition: 'book',
  note: 'info',
  tip: 'sparkles',
};

describe('the variant vocabulary is one list', () => {
  it('the enum options are exactly the declared variants, in order', () => {
    // The options are spelled out in index.js (an option only earns an i18n key
    // when it declares a label), so this is the seam where the two copies of
    // the vocabulary could drift apart.
    assert.deepEqual(variantOptionValues(), [...CALLOUT_VARIANTS]);
  });

  it('the default variant is one of them, and is what defaults store', () => {
    assert.ok(CALLOUT_VARIANTS.includes(DEFAULT_CALLOUT_VARIANT));
    assert.equal(DEF.defaults.variant, DEFAULT_CALLOUT_VARIANT);
  });

  it('every variant has an eyebrow fallback in every language slide copy carries', () => {
    for (const lang of Object.keys(SLIDE_COPY)) {
      for (const variant of CALLOUT_VARIANTS) {
        const html = render({ variant, body: 'Body.' }, lang);
        // Non-empty, and not the raw storage token leaking into the slide.
        const label = html.match(/class="callout-label"[^>]*>([^<]*)</)?.[1];
        assert.ok(label && label.trim(), `${lang}/${variant}: empty eyebrow`);
        assert.notEqual(label.trim(), variant, `${lang}/${variant}: raw token`);
      }
    }
  });
});

describe('each variant renders its own accent and glyph', () => {
  for (const variant of CALLOUT_VARIANTS) {
    it(`${variant}: modifier class and derived icon`, () => {
      const html = render({ variant, body: 'One idea.' });
      assert.match(html, /class="slide slide-callout slide-callout--/);
      assert.ok(
        html.includes(`slide-callout--${variant}`),
        `no slide-callout--${variant} class`,
      );
      assert.ok(
        html.includes(
          `/client/vendor/lucide-icons/${EXPECTED_ICON[variant]}.svg`,
        ),
        `expected the ${EXPECTED_ICON[variant]} glyph`,
      );
    });
  }

  it('an unknown variant degrades to the default rather than emitting it', () => {
    const html = render({ variant: 'catastrophe', body: 'One idea.' });
    assert.ok(html.includes(`slide-callout--${DEFAULT_CALLOUT_VARIANT}`));
    assert.ok(!html.includes('catastrophe'));
  });
});

describe('the eyebrow', () => {
  it('falls back to the per-variant copy in the deck language', () => {
    assert.ok(
      render({ variant: 'warning', body: 'Mind the queue.' }, 'en-GB').includes(
        SLIDE_COPY['en-GB'].admonitionWarning,
      ),
    );
    assert.ok(
      render(
        { variant: 'warning', body: 'Let op de wachtrij.' },
        'nl',
      ).includes(SLIDE_COPY.nl.admonitionWarning),
    );
  });

  it('an authored label wins over the fallback', () => {
    const html = render({
      variant: 'warning',
      label: 'Do not do this',
      body: 'x',
    });
    assert.ok(html.includes('Do not do this'));
    assert.ok(!html.includes(SLIDE_COPY['en-GB'].admonitionWarning));
  });

  it('a whitespace-only label is not an override', () => {
    const html = render({ variant: 'tip', label: '   ', body: 'x' });
    assert.ok(html.includes(SLIDE_COPY['en-GB'].admonitionTip));
  });
});

describe('the definition variant is real HTML semantics', () => {
  it('marks the term as a <dfn>, and the body is not one', () => {
    const html = render({
      variant: 'definition',
      label: 'Lead time',
      body: 'Commit to production.',
    });
    assert.match(html, /<dfn class="callout-label"[^>]*>Lead time<\/dfn>/);
    assert.equal(html.match(/<dfn/g).length, 1);
  });

  it('no other variant emits a <dfn>', () => {
    for (const variant of CALLOUT_VARIANTS.filter((v) => v !== 'definition')) {
      const html = render({ variant, label: 'Term', body: 'x' });
      assert.ok(!html.includes('<dfn'), `${variant} emitted a <dfn>`);
      assert.match(html, /<span class="callout-label"/);
    }
  });
});

describe('content handling', () => {
  it('renders the body as markdown', () => {
    const html = render({ body: 'Ships **six times** earlier.' });
    assert.ok(html.includes('<strong>six times</strong>'));
  });

  it('escapes HTML in the label, the body and the source', () => {
    const html = render({
      variant: 'note',
      label: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(1)>',
      source: '<b>not bold</b>',
    });
    // No authored markup survives as a TAG. (`onerror=` still occurs as inert
    // text inside the escaped body, so the assertion is about tags, not
    // substrings.)
    assert.ok(!/<script/i.test(html));
    assert.ok(!/<img/i.test(html));
    assert.ok(!html.includes('<b>not bold</b>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('omits the source line entirely when it is empty', () => {
    assert.ok(!render({ body: 'x' }).includes('callout-source'));
    assert.ok(!render({ body: 'x', source: '  ' }).includes('callout-source'));
    assert.ok(
      render({ body: 'x', source: 'DORA 2024' }).includes('callout-source'),
    );
  });
});

describe('the body size band', () => {
  it('steps down as the body grows, and covers the field maximum', () => {
    assert.equal(calloutBodyBand('A short takeaway.'), 'lg');
    assert.equal(calloutBodyBand('x'.repeat(110)), 'lg');
    assert.equal(calloutBodyBand('x'.repeat(111)), 'md');
    assert.equal(calloutBodyBand('x'.repeat(210)), 'md');
    assert.equal(calloutBodyBand('x'.repeat(211)), 'sm');
    // The schema caps the body at 600 characters; the smallest band has to
    // hold that, or a legal slide clips.
    const maxLength = DEF.fields.find((f) => f.key === 'body').maxLength;
    assert.equal(calloutBodyBand('x'.repeat(maxLength)), 'sm');
  });

  it('an empty or missing body is the largest band, not a crash', () => {
    assert.equal(calloutBodyBand(undefined), 'lg');
    assert.equal(calloutBodyBand(''), 'lg');
    assert.ok(render({}).includes('is-body-lg'));
  });
});
