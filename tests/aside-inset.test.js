/**
 * The aside inset — the admonition family's within-slide shape.
 *
 * A shared field pair (`asideVariant` + `asideText`) and one shared renderer,
 * spread into three host types. Almost every claim worth making about it is a
 * claim about what it does NOT do:
 *
 *  1. **A slide without an aside renders byte for byte what it always did.**
 *     This is the whole licence for putting a new field on three shipped
 *     types, and it is asserted per host rather than assumed — a stray
 *     whitespace-only `${asideHtml}` in one template would break it in exactly
 *     one of the three.
 *  2. **A kind chosen but nothing said is still no aside.** An empty box is a
 *     promise with nothing behind it, and every slide gets one the moment an
 *     author opens the dropdown to look.
 *  3. **An unknown kind degrades to no aside**, not to a class no stylesheet
 *     defines. The alternative is an unstyled box on a stranger's deck.
 *  4. **The vocabulary is one list.** The enum options, the CSS rules and the
 *     shared admonition table have to agree; each pair of them is a seam where
 *     a fourth kind could be added to one and forgotten in the others.
 *
 * Plus the two things it DOES: the eyebrow word follows the DECK's language
 * (slide-copy, not the `t()` UI layer — docs/reference/slide-copy-language.md),
 * and the body is markdown that goes through the sanitiser like every other
 * markdown field.
 *
 * Run with: node --test tests/aside-inset.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { SLIDE_COPY } from '../shared/slide-types/slide-copy.js';
import {
  ADMONITION_META,
  ADMONITION_VARIANTS,
} from '../shared/slide-types/admonitions.js';
import {
  ASIDE_FIELDS,
  ASIDE_NONE,
  ASIDE_VARIANTS,
  asideVariant,
  renderAsideHtml,
} from '../shared/slide-types/aside-field.js';

// The aside body is markdown, and markdownToSafeHtml falls back to escaping
// everything when no DOMPurify is present — which is what a bare `node --test`
// process has. The server calls this at boot.
await initSanitizer();

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The three host types, with content that exercises each one's layout. */
const HOSTS = {
  'content-slide': {
    title: 'What we found',
    subheading: 'Three months of logs',
    layout: 'one-column',
    density: 'auto',
    body: '- First point\n- Second point',
    background: 'lime',
    actions: [],
  },
  'list-slide': {
    title: 'Three points',
    subheading: '',
    variant: 'bullets',
    layout: 'auto',
    density: 'auto',
    items: [
      { title: 'First', text: 'One line' },
      { title: 'Second', text: 'Another line' },
    ],
    background: 'lime',
  },
  'image-text-slide': {
    images: [{ src: 'https://example.test/a.png', alt: 'A' }],
    caption: '',
    imageRole: 'content',
    imageSide: 'left',
    imageWidth: 'half',
    layout: 'split',
    title: 'Beside a picture',
    body: '- Point one',
    background: 'lime',
    actions: [],
  },
};

const render = (type, content, lang = 'en-GB') =>
  renderSlideHtml({ type, content }, { lang });

describe('the field pair is one declaration, spread by every host', () => {
  it('the pair is variant-then-text, and the text hangs off the variant', () => {
    assert.deepEqual(
      ASIDE_FIELDS.map((f) => f.key),
      ['asideVariant', 'asideText'],
    );
    // The gate on the second control. Without it an author sees an "Aside
    // text" box on a slide that has no aside, and typing in it does nothing.
    assert.deepEqual(ASIDE_FIELDS[1].visibleWhen, {
      field: 'asideVariant',
      in: [...ASIDE_VARIANTS],
    });
  });

  for (const type of Object.keys(HOSTS)) {
    it(`${type}: declares both keys, and defaults them to no aside`, () => {
      const def = SLIDE_TYPES[type];
      const keys = def.fields.map((f) => f.key);
      assert.ok(keys.includes('asideVariant'), 'no asideVariant field');
      assert.ok(keys.includes('asideText'), 'no asideText field');
      assert.equal(def.defaults.asideVariant, ASIDE_NONE);
      assert.equal(def.defaults.asideText, '');
      for (const byLang of Object.values(def.defaultsByLang)) {
        assert.equal(byLang.asideVariant, ASIDE_NONE);
        assert.equal(byLang.asideText, '');
      }
    });
  }
});

describe('a slide without an aside is untouched', () => {
  for (const [type, content] of Object.entries(HOSTS)) {
    it(`${type}: renders byte for byte what a pre-aside deck rendered`, () => {
      // The baseline is content with no aside keys at all — literally a deck
      // stored before the field existed.
      const baseline = render(type, content);
      assert.ok(!baseline.includes('slide-aside'));

      // Every way of saying "no aside" has to land on that same string.
      for (const asAbsent of [
        { asideVariant: ASIDE_NONE, asideText: '' },
        { asideVariant: ASIDE_NONE, asideText: 'written, then switched off' },
        { asideVariant: 'note', asideText: '' },
        { asideVariant: 'note', asideText: '   \n  ' },
        { asideVariant: '', asideText: 'orphaned text' },
        { asideVariant: 'shout', asideText: 'an unknown kind' },
      ]) {
        assert.equal(
          render(type, { ...content, ...asAbsent }),
          baseline,
          `${JSON.stringify(asAbsent)} produced markup`,
        );
      }
    });
  }
});

describe('an aside renders as one inset, inside its host', () => {
  for (const [type, content] of Object.entries(HOSTS)) {
    for (const variant of ASIDE_VARIANTS) {
      it(`${type}: ${variant} emits the inset with its variant class`, () => {
        const html = render(type, {
          ...content,
          asideVariant: variant,
          asideText: 'Only true for decks made after March.',
        });
        assert.ok(
          html.includes(`class="slide-aside slide-aside--${variant}"`),
          `no slide-aside--${variant}`,
        );
        // A real <aside>: the content is tangential to the body around it,
        // which is what the element means, and it is the part that survives
        // into a reader view.
        assert.ok(html.includes('<aside class="slide-aside'));
        assert.ok(html.includes('Only true for decks made after March.'));
        // Click-to-edit on the canvas comes from this attribute alone.
        assert.ok(html.includes('data-inline-field="asideText"'));
        // The glyph is derived from the kind, never authored.
        assert.ok(
          html.includes(`${ADMONITION_META[variant].icon}.svg`),
          `no ${ADMONITION_META[variant].icon} glyph`,
        );
      });
    }

    it(`${type}: the inset is all that is added`, () => {
      // The aside must not reshape its host. Strip the inset back out of the
      // rendered string and what is left has to be the untouched slide.
      //
      // Compared with whitespace collapsed, and only here: the templates are
      // indented literals, so removing an element leaves its indentation
      // behind. The byte-for-byte claim is the one above, on the slides that
      // have no aside at all — this test is about STRUCTURE, and collapsing
      // runs of space is what lets it say that and nothing more.
      const flat = (s) => s.replace(/\s+/g, ' ').trim();
      const baseline = render(type, content);
      const html = render(type, {
        ...content,
        asideVariant: 'tip',
        asideText: 'Press ? for the shortcut list.',
      });
      const stripped = html.replace(
        /<aside class="slide-aside[\s\S]*?<\/aside>/,
        '',
      );
      assert.equal(flat(stripped), flat(baseline));
    });
  }
});

describe('the eyebrow word follows the deck language', () => {
  it('an English deck says Warning, a Dutch deck says Let op', () => {
    const content = {
      ...HOSTS['content-slide'],
      asideVariant: 'warning',
      asideText: 'This changes the stored shape.',
    };
    assert.ok(
      render('content-slide', content, 'en-GB').includes(
        SLIDE_COPY['en-GB'].admonitionWarning,
      ),
    );
    assert.ok(
      render('content-slide', content, 'nl').includes(
        SLIDE_COPY.nl.admonitionWarning,
      ),
    );
  });

  it('the word rides in the shared eyebrow partial, not a fourth label class', () => {
    const html = renderAsideHtml(
      { asideVariant: 'note', asideText: 'Worth knowing.' },
      { lang: 'en-GB' },
    );
    assert.ok(html.includes('class="slide-eyebrow"'));
  });
});

describe('the aside body is markdown, sanitised like every other', () => {
  it('renders inline markdown and escapes a script tag', () => {
    const html = renderAsideHtml(
      {
        asideVariant: 'tip',
        asideText: '**bold** and <script>alert(1)</script>',
      },
      { lang: 'en-GB' },
    );
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(!html.includes('<script>'));
  });
});

describe('the vocabulary is one list', () => {
  it('the enum offers exactly the quiet kinds, plus none', () => {
    const values = ASIDE_FIELDS[0].options.map((o) =>
      typeof o === 'string' ? o : o.value,
    );
    assert.deepEqual(values, [ASIDE_NONE, ...ASIDE_VARIANTS]);
  });

  it('every kind an inset offers is a kind the callout family knows', () => {
    // The two shapes share a vocabulary on purpose: a warning that carries one
    // glyph on a slide and another in an inset is two systems wearing one name.
    for (const variant of ASIDE_VARIANTS) {
      assert.ok(
        ADMONITION_VARIANTS.includes(variant),
        `${variant} is not an admonition`,
      );
      assert.ok(ADMONITION_META[variant], `${variant} has no derived parts`);
    }
  });

  it('the loud kinds stay off the inset', () => {
    // An inset is no place for a key insight or a definition — those are the
    // point of a slide, not a footnote on one.
    for (const loud of ['insight', 'definition']) {
      assert.ok(!ASIDE_VARIANTS.includes(loud));
      assert.equal(asideVariant({ asideVariant: loud }), '');
    }
  });

  it('the resolver answers for junk without throwing', () => {
    for (const junk of [undefined, null, 42, {}, [], '  ', 'NOTE'])
      assert.equal(asideVariant({ asideVariant: junk }), '');
    assert.equal(asideVariant({ asideVariant: ' tip ' }), 'tip');
    assert.equal(asideVariant(undefined), '');
  });

  it('every kind the enum offers has CSS', () => {
    // An option with no rule is an affordance that lies: the author picks it
    // and nothing happens.
    const css = fs.readFileSync(
      path.join(
        repoRoot,
        'client/styles/slides/01-layout-and-title/33-aside-inset.css',
      ),
      'utf8',
    );
    for (const variant of ASIDE_VARIANTS) {
      assert.ok(
        css.includes(`.slide-aside--${variant}`),
        `the enum offers ${variant} but the stylesheet says nothing about it`,
      );
    }
    assert.ok(!css.includes(`.slide-aside--${ASIDE_NONE}`));
  });
});
