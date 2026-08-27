/**
 * The shared inline-element partials (`shared/slide-types/partials.js`).
 *
 * Three guards, in order of what they protect:
 *
 * 1. **The contract each partial makes to a caller** — `''` on empty, escaping
 *    on every text value, `data-inline-field` only when asked for. A type drops
 *    these straight into a template literal with no branch of its own, so a
 *    partial that returned `<p></p>` for an empty field would put an empty
 *    element on every slide that left the field blank.
 * 2. **The tone vocabulary is the semantic role family**, not a set of colours
 *    this module invented. If someone adds a tone here without a token behind
 *    it, that is the per-type colour family `slide-roles.md` removed.
 * 3. **Every class a partial emits has a CSS rule.** `slide-type-css-contract`
 *    walks CORE_SLIDE_TYPE_DEFS, so it never sees a partial rendered by the
 *    unresolved placeholder or by a fork type. That is exactly the gap the
 *    partials open — a shared class whose stylesheet is somewhere else — so it
 *    gets its own half of the same check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PARTIAL_TONES,
  badgeHtml,
  eyebrowHtml,
  highlightHtml,
} from '../shared/slide-types/partials.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const PATTERNS_CSS = path.join(
  REPO_ROOT,
  'client/styles/slides/00-patterns.css',
);
const TOKENS_CSS = path.join(REPO_ROOT, 'client/styles/slides/00-tokens.css');

/** Every partial, uniformly callable as `fn(text, options)`. */
const PARTIALS = [
  { name: 'eyebrowHtml', fn: eyebrowHtml, inlineField: true },
  { name: 'badgeHtml', fn: badgeHtml, inlineField: true },
  { name: 'highlightHtml', fn: highlightHtml, inlineField: false },
];

test('every partial returns the empty string for empty input', () => {
  for (const { name, fn } of PARTIALS) {
    for (const empty of [undefined, null, '', '   ', '\n\t']) {
      assert.equal(
        fn(empty, { field: 'x' }),
        '',
        `${name} rendered markup for ${JSON.stringify(empty)}`,
      );
    }
  }
});

test('every partial escapes its text', () => {
  const raw = '<script>alert("x")</script> & \'quoted\'';
  for (const { name, fn } of PARTIALS) {
    const html = fn(raw);
    assert.ok(!html.includes('<script'), `${name} let a tag through`);
    assert.ok(
      html.includes('&lt;script&gt;') && html.includes('&amp;'),
      `${name} did not escape: ${html}`,
    );
  }
});

test('a field path becomes data-inline-field, and nothing does otherwise', () => {
  for (const { name, fn, inlineField } of PARTIALS) {
    if (!inlineField) continue;
    assert.match(
      fn('Text', { field: 'metrics.0.note' }),
      /data-inline-field="metrics\.0\.note"/,
      `${name} dropped the field path`,
    );
    assert.ok(
      !fn('Text').includes('data-inline-field'),
      `${name} emitted an inline-field hook nobody asked for`,
    );
  }
});

test('the field path is escaped too — it reaches an attribute', () => {
  assert.ok(!eyebrowHtml('T', { field: 'a"b' }).includes('a"b'));
  assert.match(
    eyebrowHtml('T', { field: 'a"b' }),
    /data-inline-field="a&quot;b"/,
  );
});

test('eyebrow emits a morph role only when given one', () => {
  assert.match(
    eyebrowHtml('Chapter', { morphRole: 'subtitle' }),
    /data-morph-role="subtitle"/,
  );
  assert.ok(!eyebrowHtml('Chapter').includes('data-morph-role'));
});

test('a tone adds its modifier class; `default` and an unknown tone do not', () => {
  assert.match(
    badgeHtml('Ship it', { tone: 'positive' }),
    /class="slide-badge slide-badge--positive"/,
  );
  assert.match(
    highlightHtml('-4%', { tone: 'danger' }),
    /class="slide-highlight slide-highlight--danger"/,
  );
  for (const tone of ['default', undefined, '', 'best', 'risk', 'chartreuse']) {
    assert.equal(
      badgeHtml('x', { tone }).includes('slide-badge--'),
      false,
      `tone ${JSON.stringify(tone)} minted a modifier class`,
    );
  }
});

test('the tone vocabulary is the semantic status role family', () => {
  const tokens = fs.readFileSync(TOKENS_CSS, 'utf8');
  const roles = PARTIAL_TONES.filter((t) => t !== 'default');
  assert.ok(roles.length > 0);
  for (const role of roles) {
    assert.ok(
      tokens.includes(`--slide-color-${role}:`),
      `tone "${role}" has no --slide-color-${role} token: partials must not mint colours`,
    );
  }
});

test('every class a partial emits is styled in 00-patterns.css', () => {
  const css = fs.readFileSync(PATTERNS_CSS, 'utf8');
  const emitted = new Set();
  for (const { fn } of PARTIALS) {
    for (const tone of PARTIAL_TONES) {
      const html = fn('sample', { tone, field: 'f' });
      for (const m of html.matchAll(/class="([^"]+)"/g)) {
        for (const cls of m[1].split(/\s+/)) if (cls) emitted.add(cls);
      }
    }
  }
  assert.ok(emitted.size >= 3);
  for (const cls of emitted) {
    assert.ok(
      new RegExp(`\\.${cls.replace(/-/g, '\\-')}(?![\\w-])`).test(css),
      `.${cls} is emitted by a partial but has no rule in 00-patterns.css`,
    );
  }
});

/**
 * The migrated core sites, pinned.
 *
 * Each of these used to be a per-type spelling of one of the partials
 * (`.badge`, `.kpi-delta`, `.unresolved-kicker`). Asserting the *rendered*
 * markup is what stops a later edit quietly re-inlining one: the partial would
 * still exist and still be tested, and the type would simply have stopped
 * calling it.
 */

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { renderUnresolvedSlideHtml } from '../shared/slide-types/unresolved.js';

test('comparison-slide renders its verdict as the shared badge', () => {
  const html = renderSlideHtml({
    id: 's1',
    type: 'comparison-slide',
    content: { leftTitle: 'A', rightTitle: 'B', verdict: 'Buy' },
  });
  assert.match(html, /<span class="slide-badge" data-inline-field="verdict"/);
  assert.ok(
    !/class="badge"/.test(html),
    'the per-type `.badge` spelling is back',
  );
});

test('kpi-metrics-slide renders its delta as the shared highlight, toned', () => {
  const html = renderSlideHtml({
    id: 's2',
    type: 'kpi-metrics-slide',
    content: {
      metrics: [
        { value: '42', label: 'Up', note: '+12% vs last quarter' },
        { value: '7', label: 'Down', note: '-3% churn' },
        { value: '1', label: 'Flat', note: 'steady all year' },
      ],
    },
  });
  assert.match(html, /class="slide-highlight slide-highlight--positive"/);
  assert.match(html, /class="slide-highlight slide-highlight--danger"/);
  // A note with no +/- prefix has no highlight run at all: the whole note is
  // the remainder, and nothing gets wrapped in a `.slide-highlight`.
  assert.ok(!/class="slide-highlight[^"]*"[^>]*>steady all year/.test(html));
  assert.ok(
    !/kpi-delta/.test(html),
    'the per-type `.kpi-delta` spelling is back',
  );
});

test('the unresolved-slide placeholder renders the shared eyebrow', () => {
  const html = renderUnresolvedSlideHtml({
    id: 's3',
    type: 'no-such-type',
    content: { title: 'Kept' },
  });
  assert.match(
    html,
    /<p class="slide-eyebrow" dir="auto">Unavailable slide type<\/p>/,
  );
  assert.ok(!/unresolved-kicker/.test(html));
});
