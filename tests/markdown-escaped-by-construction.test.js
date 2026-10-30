/**
 * The markdown generator is safe by construction, without a sanitizer pass.
 *
 * `shared/markdown.js` used to hand its output to DOMPurify. The frozen
 * renderer bundle has no DOM, so there the pass fell back to escaping and an
 * edition showed its own markup as text. The pass is gone; this file is the
 * proof that it removed nothing. For every input the parsed output may hold
 * only the tags and attributes the dialect emits, every `href` is http(s),
 * and DOMPurify with that same allowlist leaves the tree exactly as it is.
 *
 * Run with: node --test tests/markdown-escaped-by-construction.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

import {
  markdownToSafeHtml,
  inlineMarkdownToSafeHtml,
} from '../shared/markdown.js';

const { window } = new JSDOM('');
const purify = createDOMPurify(window);

/** `html` parsed as the children of one element, in the shared window. */
function fragment(html) {
  const host = window.document.createElement('div');
  host.innerHTML = html;
  return host;
}

/** Every tag the dialect emits, with the attributes it may carry. */
const ALLOWED = {
  p: ['dir'],
  h3: ['class', 'dir'],
  ul: ['dir'],
  ol: ['dir', 'start'],
  li: ['dir'],
  blockquote: ['dir'],
  pre: ['class', 'data-lang', 'dir'],
  code: ['class'],
  div: ['class', 'data-math'],
  table: ['class'],
  thead: [],
  tbody: [],
  tr: [],
  th: ['dir'],
  td: ['dir'],
  strong: [],
  em: [],
  a: ['href', 'target', 'rel'],
  span: ['class', 'data-math'],
};
const INLINE_TAGS = ['strong', 'em', 'a', 'span', 'code'];

const ALL_ATTRS = [...new Set(Object.values(ALLOWED).flat())];

/** Assert the parsed output stays inside the allowlist; return its HTML. */
function assertInsideDialect(html, input, tags = Object.keys(ALLOWED)) {
  // NUL delimits the generator's placeholders and is stripped from input, so
  // one in the output is a placeholder that was never restored.
  assert.ok(
    !html.includes('\x00'),
    `placeholder from ${JSON.stringify(input)}`,
  );
  const body = fragment(html);
  for (const el of body.querySelectorAll('*')) {
    const tag = el.localName;
    assert.ok(tags.includes(tag), `<${tag}> from ${JSON.stringify(input)}`);
    for (const { name, value } of el.attributes) {
      assert.ok(
        ALLOWED[tag].includes(name),
        `${tag}[${name}] from ${JSON.stringify(input)}`,
      );
      if (name === 'href') {
        assert.match(
          value,
          /^https?:\/\//,
          `href from ${JSON.stringify(input)}`,
        );
      }
      if (name === 'data-math') {
        assert.equal(
          value,
          el.textContent,
          `data-math from ${JSON.stringify(input)}`,
        );
      }
    }
  }
  return body.innerHTML;
}

/**
 * The tree an HTML parser builds from `html`, serialized one way, without
 * `data-math`. That attribute is the only one that carries author text, and
 * it carries exactly the element's own visible text
 * ({@link assertInsideDialect} checks that), which DOMPurify drops on value
 * heuristics meant for URLs (`data:…`, `javascript:…`) though KaTeX reads it
 * as TeX.
 */
const parse = (html) => {
  const body = fragment(html);
  for (const el of body.querySelectorAll('[data-math]')) {
    el.removeAttribute('data-math');
  }
  return body.innerHTML;
};

/**
 * DOMPurify with the dialect's own allowlist changes nothing. Both sides go
 * through the same parser, so the comparison is of trees, not of spellings
 * (DOMPurify writes a text `"` as `&quot;`, the generator as `&quot;` too, a
 * parse-and-serialize as `"`).
 */
function assertPurifyIsNoop(html, input, tags = Object.keys(ALLOWED)) {
  const purified = purify.sanitize(html, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: ALL_ATTRS,
    ALLOW_DATA_ATTR: false,
    // DOMPurify's XML guard drops an attribute whose decoded value holds
    // `-->`, `]>` or `</script` (a `data-math` an author typed). That guards a
    // reparse as XML; slide HTML is only ever parsed as HTML, where a quoted,
    // escaped value cannot leave its attribute.
    SAFE_FOR_XML: false,
  });
  assert.equal(
    parse(purified),
    parse(html),
    `DOMPurify changed ${JSON.stringify(input)}`,
  );
}

// Pieces of every construct the dialect knows, plus every way out of one.
const TOKENS = [
  'a',
  'word',
  ' ',
  '\n',
  '\n\n',
  '*',
  '**',
  '_',
  '__',
  '`',
  '```js\n',
  '\n```',
  '$',
  '$$',
  '[',
  ']',
  '](',
  '(',
  ')',
  'https://x.test/?a=1&b=2',
  'javascript:alert(1)',
  'data:text/html,x',
  '<',
  '>',
  '"',
  "'",
  '&',
  '&lt;',
  '\\',
  '\\*',
  '|',
  '| --- | --- |\n',
  '- ',
  '1. ',
  '3. ',
  '99999999999999999999. ',
  '  - ',
  '## ',
  '> ',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '" onmouseover="alert(1)',
  '\x00',
  '\x00IC\x000\x00IC\x00',
  '\x00LK\x000\x00LK\x00',
  '\x00CB\x000\x00CB\x00',
];

/** Small seeded PRNG so a failure reproduces. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function* cases(count, seed) {
  const rand = prng(seed);
  for (let n = 0; n < count; n += 1) {
    const len = 1 + Math.floor(rand() * 24);
    let s = '';
    for (let k = 0; k < len; k += 1) {
      s += TOKENS[Math.floor(rand() * TOKENS.length)];
    }
    yield s;
  }
}

const NAMED = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](JavaScript:alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)',
  '[x](https://a.test/" onmouseover="alert(1))',
  "[x](https://a.test/' onmouseover='alert(1))",
  '[x](https://a`"><script>alert(1)</script>`)',
  '[x](https://a$"><b>$)',
  '[a & b](https://x.test/?a=1&b=2)',
  '**a _b** c_',
  '```"><script>\nx\n```',
  '$$"><img src=x onerror=alert(1)>$$',
  '| <b> | "q" |\n| --- | --- |\n| [x](https://a.test) | `<i>` |',
  '1. a\n   - <b>\n3. c',
  '## <h1>x</h1>',
  '> <iframe src=x>',
  'a\x00IC\x000\x00IC\x00 `b`',
];

test('named injection attempts never land as markup', () => {
  for (const input of NAMED) {
    const html = markdownToSafeHtml(input);
    assertInsideDialect(html, input);
    assertPurifyIsNoop(html, input);
    const inline = inlineMarkdownToSafeHtml(input);
    assertInsideDialect(inline, input, INLINE_TAGS);
    assertPurifyIsNoop(inline, input, INLINE_TAGS);
  }
});

test('a non-http(s) link target stays text', () => {
  const html = markdownToSafeHtml('[x](javascript:alert(1))');
  assert.ok(!html.includes('<a'), html);
  assert.ok(html.includes('javascript:alert(1)'), html);
});

test('link text and href are escaped once, not twice', () => {
  const html = inlineMarkdownToSafeHtml('[a & b](https://x.test/?a=1&b=2)');
  assert.equal(
    html,
    '<a href="https://x.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">a &amp; b</a>',
  );
});

test('a code span in a link target wins over the link', () => {
  const html = inlineMarkdownToSafeHtml('[t](https://a`b`)');
  assert.equal(html, '[t](https://a<code class="md-code-inline">b</code>)');
});

test('a fence or $$ that is not a block of its own renders inline', () => {
  assert.equal(
    markdownToSafeHtml('text ```js\ncode\n``` more'),
    '<p dir="auto">text <code class="md-code-inline">code</code> more</p>',
  );
  assert.equal(
    markdownToSafeHtml('$$ ```js\na<b>\n``` $$'),
    '<p dir="auto">$$ <code class="md-code-inline">a&lt;b&gt;</code> $$</p>',
  );
  assert.equal(
    markdownToSafeHtml('- a $$x^2$$'),
    '<ul dir="auto"><li dir="auto">a <span class="md-math-inline" data-math="x^2">x^2</span></li></ul>',
  );
});

test('a stray code or math block in a link target wins over the link', () => {
  for (const input of ['[t](https://a```\nb```)', '[t](https://a$$b$$)']) {
    const html = markdownToSafeHtml(input);
    assert.ok(!html.includes('<a'), html);
    assertInsideDialect(html, input);
  }
});

test('an ordinal past the safe-integer range drops start', () => {
  const html = markdownToSafeHtml('99999999999999999999. x');
  assert.equal(html, '<ol dir="auto"><li dir="auto">x</li></ol>');
  assert.match(
    markdownToSafeHtml('9007199254740991. x'),
    /<ol dir="auto" start="9007199254740991">/,
  );
});

test('random markdown stays inside the dialect, block and inline', () => {
  for (const input of cases(3000, 0xb896)) {
    const html = markdownToSafeHtml(input);
    assertInsideDialect(html, input);
    assertPurifyIsNoop(html, input);
    const inline = inlineMarkdownToSafeHtml(input);
    assertInsideDialect(inline, input, INLINE_TAGS);
    assertPurifyIsNoop(inline, input, INLINE_TAGS);
  }
});
