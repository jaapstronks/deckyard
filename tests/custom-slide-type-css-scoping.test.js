/**
 * Author CSS is contained to its own slide — both custom-CSS paths (B189).
 *
 * Two surfaces let a human paste a stylesheet into a deck: the custom-html
 * slide and the Settings > Slide Types builder. Until B189 only the first one
 * scoped it; the DB path ran `filterCssText` (a *security* filter — no
 * `@import`, no `expression()`) and injected the result raw, so a published
 * custom type could restyle the presenter chrome of every deck in the org.
 *
 * These tests pin the containment half for both, and the shared implementation
 * that makes them agree: one `scopeCss`, one meaning of "scoped".
 *
 * Run with: node --test tests/custom-slide-type-css-scoping.test.js
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { initSanitizer } from '../shared/sanitize.js';
import { toRuntimeSlideType } from '../server/utils/custom-slide-type-runtime.js';
import { scopeCss } from '../shared/slide-types/scope-css.js';
import { SLIDE_TYPES } from '../shared/slide-types.js';

// sanitizeSlideHtmlSync needs a pre-initialized DOMPurify, exactly as the
// server does at startup; without it the template output is escaped and the
// markup assertions below would be testing the fallback, not the real path.
before(async () => {
  await initSanitizer();
});

const CHROME_CSS = [
  '.deck-stage { display: none; }',
  'body { background: red; }',
  ':root { --slide-padding: 0; }',
  '.slide-inner, .presenter-shell { padding: 0; }',
].join('\n');

function renderDbType(ct, content = {}, slide = { id: 's1' }) {
  return toRuntimeSlideType(ct).renderHtml(content, slide, {});
}

/** The `<style>` block of a rendered slide, or '' when it has none. */
function styleOf(html) {
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

// ============================================================================
// The DB path: Settings > Slide Types
// ============================================================================

test('a DB type cannot reach deck chrome: every selector sits under its root', () => {
  const out = renderDbType({
    slug: 'hero',
    label: 'Hero',
    template: '<div class="slide is-lime"><h2>{{esc title}}</h2></div>',
    css: CHROME_CSS,
  });
  const css = styleOf(out);

  assert.ok(css, 'the type ships CSS, so a style block must be rendered');
  for (const line of css.split('\n')) {
    const selector = line.split('{')[0].trim();
    if (!selector || selector.startsWith('@')) continue;
    for (const part of selector.split(',')) {
      assert.match(
        part.trim(),
        /^\.slide-custom-hero\b/,
        `selector escapes the slide root: ${part.trim()}`,
      );
    }
  }
  // `body` / `:root` are the one shape a prefix cannot fix: they must be
  // *remapped* onto the scope, not nested under it, or the rule matches nothing.
  assert.ok(
    css.includes('.slide-custom-hero { background: red; }'),
    'body is remapped onto the slide root itself',
  );
  assert.ok(
    css.includes('.slide-custom-hero { --slide-padding: 0; }'),
    ':root is remapped onto the slide root itself',
  );
});

test('the scope root is on the rendered markup, so the scoped CSS matches', () => {
  const out = renderDbType({
    slug: 'hero',
    label: 'Hero',
    template: '<div class="slide is-lime"><h2>{{esc title}}</h2></div>',
    css: '.foo { color: red; }',
  });

  // The template's own root carries it — no extra wrapper, so the type keeps
  // the .slide it rendered and stays a single-rooted slide.
  assert.match(out, /^<div class="slide is-lime slide-custom-hero">/);
  assert.match(styleOf(out), /^\.slide-custom-hero \.foo/);
});

test('the style block is inside the slide root, not a sibling before it', () => {
  // renderSlideElement() mounts wrap.firstElementChild and copies its class
  // list. When the <style> came first it *was* that element, so a DB type with
  // CSS mounted its stylesheet instead of its slide.
  const out = renderDbType({
    slug: 'hero',
    label: 'Hero',
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
    css: '.foo { color: red; }',
  });

  assert.doesNotMatch(
    out,
    /^\s*<style>/,
    '<style> must not be the root element',
  );
  assert.match(out, /^<div class="slide slide-custom-hero"><style>/);
});

test('markup with no element root of its own gets a real .slide wrapper', () => {
  const out = renderDbType(
    {
      slug: 'bare',
      label: 'Bare',
      template: '{{esc title}}',
      css: '.foo { color: red; }',
    },
    { title: 'Hello' },
  );

  assert.match(out, /^<div class="slide slide-custom-bare"><style>/);
  assert.ok(out.includes('Hello'), 'the rendered content survives the wrap');
});

test('a type without CSS renders no style block but still carries the root class', () => {
  const out = renderDbType({
    slug: 'hero',
    label: 'Hero',
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
  });

  assert.doesNotMatch(out, /<style>/);
  assert.match(out, /^<div class="slide slide-custom-hero">/);
});

test('the security filter still runs: no @import or </style> breakout', () => {
  const out = renderDbType({
    slug: 'hero',
    label: 'Hero',
    template: '<div class="slide"></div>',
    css: '@import url("//evil.example/x.css"); .a { b: c }',
  });

  assert.doesNotMatch(out, /@import/i, '@import must be stripped, not scoped');
});

// ============================================================================
// The custom-html path: unchanged, and now sharing the implementation
// ============================================================================

test('custom-html still scopes to its per-slide root', () => {
  const out = SLIDE_TYPES['custom-html-slide'].renderHtml(
    { html: '<p class="x">hi</p>', css: CHROME_CSS, background: 'lime' },
    { id: 'abc' },
    {},
  );
  const css = styleOf(out);

  assert.ok(css, 'author CSS produces a style block');
  for (const line of css.split('\n')) {
    const selector = line.split('{')[0].trim();
    if (!selector || selector.startsWith('@')) continue;
    for (const part of selector.split(',')) {
      assert.match(part.trim(), /^\.custom-html-root\[data-chr="abc"\]/);
    }
  }
});

// ============================================================================
// The shared mechanism
// ============================================================================

test('scopeCss recurses into conditional groups and leaves resource at-rules alone', () => {
  const out = scopeCss(
    '@media (min-width: 1px) { .a { c: d } } @keyframes spin { from { x: 0 } }',
    '.s',
  );

  assert.match(out, /@media \(min-width: 1px\) \{\n\.s \.a \{ c: d \}\n\}/);
  assert.ok(
    out.includes('@keyframes spin { from { x: 0 } }'),
    'a @keyframes body is not a selector list and is passed through',
  );
});

test('scopeCss does not double-prefix a selector already inside the scope', () => {
  assert.equal(scopeCss('.s .a { c: d }', '.s'), '.s .a { c: d }');
});

test('a selector that merely extends the scope class is contained, not passed through', () => {
  // `.s-extra` is a different class than the scope `.s` — with real root
  // classes that is another type's root, so a bare prefix match must not
  // count as "already scoped".
  assert.equal(scopeCss('.s-extra { c: d }', '.s'), '.s .s-extra { c: d }');
  // A true boundary (compound or descendant on the scope itself) stays put.
  assert.equal(scopeCss('.s.foo { c: d }', '.s'), '.s.foo { c: d }');
  assert.equal(scopeCss('.s:hover { c: d }', '.s'), '.s:hover { c: d }');
});
