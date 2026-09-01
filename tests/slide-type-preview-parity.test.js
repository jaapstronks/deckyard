/**
 * The Settings preview and the deck render the same definition the same way (B192).
 *
 * Until B192 `client/views/settings/slide-type-editor/preview.js` carried a
 * regex mini-implementation of the template language and injected the author
 * CSS unscoped into its iframe head, while the real path compiles through
 * `compileTemplate` and scopes the CSS under the slide root (B189). Two
 * renderers for one meaning: a maker could get `{{#if}}`, `{{#each}}` or a
 * `body { … }` rule right in Settings and wrong in a deck.
 *
 * There is now one renderer (`shared/slide-types/custom-type-runtime.js`) and
 * these tests are the pin: for one definition with a template, author CSS and
 * sample content, the preview's markup must be byte-identical to
 * `toRuntimeSlideType`'s, scoped `<style>` block included.
 *
 * Run with: node --test tests/slide-type-preview-parity.test.js
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { initSanitizer } from '../shared/sanitize.js';
import { toRuntimeSlideType } from '../server/utils/custom-slide-type-runtime.js';
import { renderPreviewSlide } from '../client/views/settings/slide-type-editor/preview.js';

// sanitizeSlideHtmlSync needs a pre-initialized DOMPurify, exactly as the
// server does at startup and the browser does in client/app.js. Without it both
// sides fall back to escaping and would agree on the wrong thing.
before(async () => {
  await initSanitizer();
});

/**
 * One definition that exercises every seam at once: the template uses `esc`,
 * `markdown`, `#if`/`else` and `#each` with `this.key` and `@index`; the CSS
 * carries a chrome-reaching selector that only the containment pass tames.
 */
const DEFINITION = {
  slug: 'partner-wall',
  label: 'Partner wall',
  template: [
    '<section class="slide is-lime">',
    '  <h2>{{esc title}}</h2>',
    '  {{#if intro}}<div class="intro">{{markdown intro}}</div>',
    '  {{else}}<p class="empty">No intro</p>{{/if}}',
    '  <ul>{{#each partners}}<li data-i="{{@index}}">{{esc this.name}}</li>{{/each}}</ul>',
    '</section>',
  ].join('\n'),
  css: [
    '.intro { color: rebeccapurple; }',
    'body { background: red; }',
    '.slide-inner, .presenter-shell { padding: 0; }',
  ].join('\n'),
  fields: [
    { key: 'title', type: 'string', label: 'Title' },
    { key: 'intro', type: 'markdown', label: 'Intro' },
    { key: 'partners', type: 'items', label: 'Partners' },
  ],
  defaults: {
    title: 'Our <partners>',
    intro: '**Bold** and [a link](https://example.com)',
    partners: [{ name: 'Acme & Co' }, { name: 'Wintermute' }],
  },
};

/** What the preview shows, given the editor's draft state. */
function previewHtml(def) {
  return renderPreviewSlide({
    template: def.template,
    css: def.css,
    slug: def.slug,
    fields: def.fields,
    defaults: def.defaults,
  });
}

/** What a deck renders, given the stored record and the same content. */
function deckHtml(def, content) {
  return toRuntimeSlideType(def).renderHtml(content, { id: 's1' }, {});
}

test('preview markup and CSS are identical to the deck render', () => {
  // The preview's content is the type's defaults, so that is the content the
  // deck side has to be handed for the comparison to mean anything.
  const expected = deckHtml(DEFINITION, DEFINITION.defaults);
  const actual = previewHtml(DEFINITION);

  assert.equal(actual, expected);
});

test('the shared parts are actually present, not two agreeing empties', () => {
  const html = previewHtml(DEFINITION);

  // Compiled through the real template language, not a regex stand-in.
  assert.match(html, /Our &lt;partners&gt;/, 'esc ran');
  assert.match(html, /<strong>Bold<\/strong>/, 'markdown ran');
  assert.match(html, /data-i="0"[^<]*>Acme &amp; Co/, 'each ran with @index');
  assert.match(html, /Wintermute/, 'each ran over every item');
  assert.doesNotMatch(html, /\{\{/, 'no template syntax survived');
  assert.doesNotMatch(html, /class="empty"/, '#if took the truthy branch');

  // The scope root is on the template's own outermost element, and the author
  // CSS travels inside it, contained.
  assert.match(
    html,
    /^<section class="slide is-lime slide-custom-partner-wall">/,
  );
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  assert.ok(css, 'the type ships CSS, so a style block must be rendered');
  assert.match(css, /\.slide-custom-partner-wall \.intro/);
  assert.doesNotMatch(
    css,
    /(^|\})\s*body\s*\{/,
    'a bare body selector would restyle the preview and the deck chrome alike',
  );
});

test('a type without CSS renders no style block on either side', () => {
  const bare = { ...DEFINITION, css: '' };

  assert.equal(previewHtml(bare), deckHtml(bare, bare.defaults));
  assert.doesNotMatch(previewHtml(bare), /<style>/);
});

test('an empty {{#each}} renders the same nothing on both sides', () => {
  const empty = {
    ...DEFINITION,
    defaults: { ...DEFINITION.defaults, partners: [] },
  };

  assert.equal(previewHtml(empty), deckHtml(empty, empty.defaults));
  assert.doesNotMatch(previewHtml(empty), /<li/);
});
