/**
 * comparison-slide — the four treatments.
 *
 * The `variant` field is STYLING over one fixed layout: the schema, the DOM
 * and the morph roles are identical for all four, and the only thing that
 * changes is one modifier class on the root. So the tests below are mostly
 * about that staying true — a treatment that quietly reshaped the markup would
 * break stepping, morph and every export that keys off `side-left`/`side-right`
 * while still looking right in a screenshot.
 *
 * Two invariants beyond the per-variant sweep:
 *
 *  1. `versus` emits NO modifier class. It is the look `.slide-comparison`
 *     already had, so a `--versus` class would be a second spelling for one
 *     meaning — and every deck written before this field existed would change
 *     its markup for a class that styles nothing.
 *  2. Every treatment the enum offers has CSS. An option with no rule is an
 *     affordance that lies: the author picks it and nothing happens.
 *
 * Run with: node --test tests/comparison-slide.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSanitizer } from '../shared/sanitize.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import {
  COMPARISON_VARIANTS,
  DEFAULT_COMPARISON_VARIANT,
  comparisonVariantClass,
} from '../shared/slide-types/types/comparison-slide.js';

// The bodies are markdown, and markdownToSafeHtml falls back to escaping
// everything when no DOMPurify is present — which is what a bare `node --test`
// process has. The server calls this at boot.
await initSanitizer();

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const DEF = SLIDE_TYPES['comparison-slide'];

/** The content a comparison slide carries, minus the treatment. */
const CONTENT = {
  title: 'Build or buy',
  leftTitle: 'Build',
  leftBody: '- Fits exactly\n- Six months',
  rightTitle: 'Buy',
  rightBody: '- Live in a month\n- Their roadmap',
  verdict: 'Buy now',
  background: 'mist',
};

/** Render a comparison slide the way the app does. */
const render = (content) =>
  renderSlideHtml({ type: 'comparison-slide', content }, { lang: 'en-GB' });

/** The `variant` field's declared option values, in order. */
const variantOptionValues = () =>
  DEF.fields
    .find((f) => f.key === 'variant')
    .options.map((o) => (typeof o === 'string' ? o : o.value));

describe('the treatment vocabulary is one list', () => {
  it('the enum options are exactly the declared variants, in order', () => {
    // The options are spelled out in the definition (an option only earns an
    // i18n key when it declares a label), so this is the seam where the two
    // copies of the vocabulary could drift apart.
    assert.deepEqual(variantOptionValues(), [...COMPARISON_VARIANTS]);
  });

  it('the default treatment is one of them, and is what defaults store', () => {
    assert.ok(COMPARISON_VARIANTS.includes(DEFAULT_COMPARISON_VARIANT));
    assert.equal(DEF.defaults.variant, DEFAULT_COMPARISON_VARIANT);
    for (const byLang of Object.values(DEF.defaultsByLang))
      assert.equal(byLang.variant, DEFAULT_COMPARISON_VARIANT);
  });
});

describe('the treatment is one modifier class on the root', () => {
  for (const variant of COMPARISON_VARIANTS.filter(
    (v) => v !== DEFAULT_COMPARISON_VARIANT,
  )) {
    it(`${variant}: the class rides beside the root class`, () => {
      const html = render({ ...CONTENT, variant });
      assert.ok(
        html.includes(`slide-comparison slide-comparison--${variant} `),
        `no slide-comparison--${variant} beside the root class`,
      );
    });
  }

  it('the class is all that changes — the markup is otherwise identical', () => {
    // The whole design claim of this field: same schema, same DOM, same morph
    // roles, only a style hook. Strip the hook back out and the two renders
    // have to be the same string.
    const baseline = render({ ...CONTENT, variant: 'versus' });
    for (const variant of COMPARISON_VARIANTS) {
      const html = render({ ...CONTENT, variant });
      assert.equal(
        html.replace(` slide-comparison--${variant}`, ''),
        baseline,
        `${variant} changed something other than the root class`,
      );
    }
  });
});

describe('the default treatment leaves old decks alone', () => {
  it('a deck written before the field existed renders byte for byte', () => {
    // `versus` IS `.slide-comparison`, so nothing is emitted for it and a
    // stored deck without the key renders exactly what it always did.
    const legacy = render(CONTENT);
    assert.ok(!legacy.includes('slide-comparison--'));
    assert.equal(render({ ...CONTENT, variant: 'versus' }), legacy);
    assert.equal(render({ ...CONTENT, variant: '' }), legacy);
  });

  it('an unknown treatment degrades to the default rather than emitting it', () => {
    const html = render({ ...CONTENT, variant: 'duel-to-the-death' });
    assert.ok(!html.includes('slide-comparison--'));
    assert.ok(!html.includes('duel-to-the-death'));
  });

  it('the class helper answers for junk without throwing', () => {
    for (const junk of [undefined, null, 42, {}, [], '  ', 'VERSUS'])
      assert.equal(comparisonVariantClass(junk), '');
    assert.equal(
      comparisonVariantClass(' pros-cons '),
      'slide-comparison--pros-cons',
    );
  });
});

describe('every treatment the enum offers has CSS', () => {
  const css = fs.readFileSync(
    path.join(
      repoRoot,
      'client/styles/slides/01-layout-and-title/82-comparison-slide.css',
    ),
    'utf8',
  );

  for (const variant of COMPARISON_VARIANTS.filter(
    (v) => v !== DEFAULT_COMPARISON_VARIANT,
  )) {
    it(`${variant}: the stylesheet has rules for it`, () => {
      assert.ok(
        css.includes(`.slide-comparison--${variant}`),
        `the enum offers ${variant} but the stylesheet says nothing about it`,
      );
    });
  }

  it('the default emits no class, so the stylesheet must not name one', () => {
    assert.ok(!css.includes('.slide-comparison--versus'));
  });
});
