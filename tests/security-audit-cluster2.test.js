/**
 * Security-audit cluster 2 regression tests (H5, M1).
 *
 * H5 — stored XSS via a custom slide-type template `{{raw}}` token. The
 *      compiled render output was injected without sanitization, so a benign
 *      `{{raw description}}` turned any editor's content into stored XSS
 *      reaching present mode, follow-along, the public /p/ viewer and the
 *      server-side Puppeteer export. Fixed by wrapping the compiled output in
 *      sanitizeSlideHtmlSync() inside toRuntimeSlideType.
 * M1 — `javascript:` URL injection in the `{{markdown}}` template helper. The
 *      link helper emitted `<a href="…">` with no protocol allow-list. Fixed by
 *      restricting to http(s)/mailto (and closed downstream by H5's sanitize).
 *
 * Run with: node --test tests/security-audit-cluster2.test.js
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { initSanitizer } from '../shared/sanitize.js';
import { toRuntimeSlideType } from '../server/utils/custom-slide-type-runtime.js';
import { renderTemplate } from '../server/utils/slide-template-compiler.js';

// sanitizeSlideHtmlSync needs a pre-initialized DOMPurify (server does this at
// startup via initSanitizer). Without it the fix falls back to escaping, which
// is still safe but wouldn't exercise the real DOMPurify path these tests want.
before(async () => {
  await initSanitizer();
});

function renderCustom(ct, content, slide = { id: 's1' }) {
  return toRuntimeSlideType(ct).renderHtml(content || {}, slide, {});
}

// ============================================================================
// H5 — {{raw}} stored XSS
// ============================================================================

test('H5: {{raw}} content is sanitized (script + event handlers stripped)', () => {
  const ct = {
    label: 'Raw',
    template: '<div class="slide"><div class="slide-inner">{{raw body}}</div></div>',
  };
  const out = renderCustom(ct, {
    body: '<img src=x onerror=alert(1)><script>alert(2)</script>hello',
  });

  assert.doesNotMatch(out, /<script/i, 'script tag must be stripped');
  assert.doesNotMatch(out, /onerror/i, 'inline event handler must be stripped');
  assert.ok(out.includes('hello'), 'benign text content survives');
});

test('H5: a raw <a href="javascript:"> is neutralized in {{raw}}', () => {
  const ct = {
    label: 'Raw',
    template: '<div class="slide">{{raw body}}</div>',
  };
  const out = renderCustom(ct, {
    body: '<a href="javascript:alert(document.cookie)">x</a>',
  });
  assert.doesNotMatch(out, /href="javascript:/i);
});

test('H5: custom CSS block is preserved (not sanitized away)', () => {
  const ct = {
    label: 'Styled',
    css: '.demo { color: red; }',
    template: '<div class="slide"><div class="slide-inner">{{esc title}}</div></div>',
  };
  const out = renderCustom(ct, { title: 'Keep me' });
  assert.ok(out.includes('<style>'), 'CSS <style> block still injected');
  assert.ok(out.includes('.demo'), 'CSS rules survive');
  assert.ok(out.includes('Keep me'), 'escaped content renders');
});

test('H5: benign structural markup survives sanitization', () => {
  const ct = {
    label: 'Ok',
    template:
      '<div class="slide is-lime"><div class="slide-inner"><h2 class="heading">{{esc title}}</h2><div class="body">{{raw body}}</div></div></div>',
  };
  const out = renderCustom(ct, {
    title: 'Title',
    body: '<p>Para</p><ul><li>one</li><li>two</li></ul>',
  });
  assert.ok(out.includes('<h2'), 'heading survives');
  assert.ok(out.includes('<ul>') && out.includes('<li>one</li>'), 'list survives');
  assert.ok(out.includes('class="slide'), 'slide wrapper class survives');
});

// ============================================================================
// M1 — {{markdown}} javascript: URL injection
// ============================================================================

test('M1: {{markdown}} javascript: link is dropped to plain text', () => {
  const ct = {
    label: 'Md',
    template: '<div class="slide">{{markdown body}}</div>',
  };
  const out = renderCustom(ct, {
    body: '[click me](javascript:alert(document.cookie))',
  });
  assert.doesNotMatch(out, /javascript:/i, 'no javascript: URL survives');
  assert.doesNotMatch(out, /<a\s+href="javascript/i);
  assert.ok(out.includes('click me'), 'link text is preserved');
});

test('M1: legit http(s) links in {{markdown}} still render as anchors', () => {
  const ct = {
    label: 'Md',
    template: '<div class="slide">{{markdown body}}</div>',
  };
  const out = renderCustom(ct, { body: '[site](https://example.com/page)' });
  assert.match(out, /href="https:\/\/example\.com\/page"/);
  assert.ok(out.includes('site'));
});

test('M1: the markdown helper is safe on its own (independent of the wrap)', () => {
  // Exercises simpleMarkdownToHtml directly via renderTemplate — no DOMPurify
  // wrap — to prove the protocol allow-list is a real second layer.
  const jsLink = renderTemplate('{{markdown x}}', {
    x: '[x](javascript:alert(1))',
  });
  assert.doesNotMatch(jsLink, /javascript:/i);
  assert.doesNotMatch(jsLink, /<a\s/i, 'unsafe link becomes text, not an anchor');
  assert.ok(jsLink.includes('x'));

  const httpLink = renderTemplate('{{markdown x}}', {
    x: '[ok](https://example.com)',
  });
  assert.match(httpLink, /<a href="https:\/\/example\.com">ok<\/a>/);
});
