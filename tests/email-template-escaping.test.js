/**
 * HTML assembly for outgoing mail (B151).
 *
 * `email-template-resolver.js` merges **admin-supplied** template overrides with
 * code defaults, and `template-builder.js` assembles the result into the HTML
 * that leaves the building. Two kinds of untrusted string meet in there:
 *
 *   1. **placeholder values** — a deck title, a commenter's name, a comment
 *      body: authored by whoever could reach the deck, and interpolated into an
 *      admin's template;
 *   2. **the action URL** — a magic link, a password-reset link, an invite: it
 *      carries a token, so an assembly step that mangles it is an auth
 *      availability bug, and one that drops out of its attribute is worse.
 *
 * This file pins how each is handled, including the asymmetry: a template's
 * `body` is admin-authored HTML and goes in raw, while `greeting`,
 * `buttonLabel` and `footer` are escaped. Placeholder values are escaped in all
 * four, so the raw `body` is not a route in for anything a user typed.
 *
 * Run with: node --test tests/email-template-escaping.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { interpolatePlaceholders } =
  await import('../server/integrations/email-template-resolver.js');
const { buildFromResolvedTemplate } =
  await import('../server/integrations/email/template-builder.js');
const { stripTags } =
  await import('../server/integrations/email-templates/helpers.js');

/** A payload that is inert as text and live as markup. */
const XSS = '<img src=x onerror="alert(1)">';
/** A token URL with the characters an HTML attribute cares about. */
const TOKEN_URL =
  'https://deckyard.test/auth/magic?token=a&b=c&next=%2Fapp%2Fdeck-1';

/** The five fields a template carries, with a marker in each. */
function fields(overrides = {}) {
  return {
    subject: 'Subject {name}',
    greeting: 'Hi {name},',
    body: 'A message for {name}.',
    buttonLabel: 'Open {name}',
    footer: 'Sent to {name}.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// interpolatePlaceholders
// ---------------------------------------------------------------------------

test('a placeholder value is escaped by default', () => {
  const out = interpolatePlaceholders('Hello {name}', { name: XSS });

  assert.doesNotMatch(out, /<img/, 'no live tag survives');
  assert.match(out, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('the un-escaped mode is opt-in and stays opt-in', () => {
  // Only `generatePreview` passes `false`, and only with its own hardcoded
  // sample data — never with anything a user typed. Pinning the default here
  // is what makes that call site the exception rather than the precedent.
  const escaped = interpolatePlaceholders('{name}', { name: XSS });
  const raw = interpolatePlaceholders('{name}', { name: XSS }, false);

  assert.notEqual(escaped, XSS);
  assert.equal(raw, XSS);
});

test('an unknown placeholder is left standing, not blanked', () => {
  // A template that names a variable its sender does not supply should read as
  // an obviously-broken template, not silently lose a sentence.
  assert.equal(
    interpolatePlaceholders('Hi {name}, re {presTitle}', { name: 'Alex' }),
    'Hi Alex, re {presTitle}',
  );
});

test('a value that looks like a placeholder is not re-interpolated', () => {
  // One pass only: a deck titled "{name}" must not pull in the recipient.
  assert.equal(
    interpolatePlaceholders('re {presTitle}', {
      presTitle: '{name}',
      name: 'Alex',
    }),
    're {name}',
  );
});

// ---------------------------------------------------------------------------
// buildFromResolvedTemplate — placeholder values
// ---------------------------------------------------------------------------

test('user-authored values cannot inject markup into any template field', () => {
  const { htmlContent } = buildFromResolvedTemplate(
    fields(),
    { name: XSS },
    'https://deckyard.test/go',
  );

  assert.doesNotMatch(
    htmlContent,
    /<img/,
    'the payload appears nowhere as a tag',
  );
  // It does still appear, escaped, in every field that names it.
  assert.equal(
    htmlContent.split('&lt;img src=x').length - 1,
    4,
    'greeting, body, buttonLabel and footer each carry the escaped value',
  );
});

test('a value is escaped exactly once, never twice', () => {
  // `emailWrapper`, `emailButton` and the muted footer paragraph each escape
  // their whole string, so a pre-escaped value came out escaped twice and a
  // recipient called O'Brien read `O&#039;Brien` in the greeting of every
  // admin-customized mail. One escape, at the point of insertion.
  const { htmlContent, textContent } = buildFromResolvedTemplate(
    fields(),
    { name: "O'Brien & Co" },
    'https://deckyard.test/go',
  );

  assert.doesNotMatch(
    htmlContent,
    /&amp;(#039|amp|lt|gt|quot);/,
    'no entity is itself entity-escaped',
  );
  assert.equal(
    htmlContent.split('O&#039;Brien &amp; Co').length - 1,
    4,
    'greeting, body, buttonLabel and footer each escape it once',
  );
  assert.match(
    textContent,
    /Hi O'Brien & Co,/,
    'the text/plain half is not an HTML sink and carries the raw value',
  );
  assert.doesNotMatch(textContent, /&#039;|&amp;/, 'no entity in text/plain');
});

test('the escape survives the admin body being raw HTML', () => {
  // `body` is admin-authored markup and is inserted unescaped on purpose — but
  // the values interpolated into it are escaped first, so the raw field is not
  // a way in for anything a user typed.
  const { htmlContent } = buildFromResolvedTemplate(
    fields({ body: '<strong>Note:</strong> {name}' }),
    { name: XSS },
    'https://deckyard.test/go',
  );

  assert.match(htmlContent, /<strong>Note:<\/strong>/, 'admin markup renders');
  assert.doesNotMatch(htmlContent, /<img/, 'the interpolated value does not');
});

test('admin copy outside the body is escaped, so only the body carries markup', () => {
  const { htmlContent } = buildFromResolvedTemplate(
    fields({
      greeting: '<b>Hi</b>',
      buttonLabel: '<b>Open</b>',
      footer: '<b>Sent</b>',
      body: '<b>Body</b>',
    }),
    {},
    'https://deckyard.test/go',
  );

  assert.equal(
    htmlContent.split('<b>').length - 1,
    1,
    'exactly one field renders markup, and it is the body',
  );
  assert.equal(
    htmlContent.split('&lt;b&gt;').length - 1,
    3,
    'the other three are escaped',
  );
});

// ---------------------------------------------------------------------------
// buildFromResolvedTemplate — the token-bearing URL
// ---------------------------------------------------------------------------

test('the action URL leaves the href intact once decoded', () => {
  const { htmlContent } = buildFromResolvedTemplate(
    fields(),
    { name: 'Alex' },
    TOKEN_URL,
  );

  const href = /<a href="([^"]*)"/.exec(htmlContent)?.[1];
  assert.ok(href, 'the button renders an href');
  assert.match(href, /&amp;/, 'ampersands are entity-escaped in the attribute');
  assert.equal(
    href.replace(/&amp;/g, '&'),
    TOKEN_URL,
    'decoding the attribute yields the URL that was handed in',
  );
});

test('a URL with a quote in it cannot break out of the attribute', () => {
  const hostile = 'https://deckyard.test/x?t=1" onmouseover="alert(1)';
  const { htmlContent } = buildFromResolvedTemplate(fields(), {}, hostile);

  assert.doesNotMatch(
    htmlContent,
    /onmouseover="/,
    'the quote never closes the href, so no live attribute appears',
  );
  assert.match(
    htmlContent,
    /&quot; onmouseover=&quot;/,
    'it stays inside the attribute value, entity-escaped',
  );
});

test('the copy-paste footer shows the same URL as the button', () => {
  // The footer exists for clients that strip the button; a token that differs
  // between the two is a link that works in one mail client and not the other.
  const { htmlContent } = buildFromResolvedTemplate(fields(), {}, TOKEN_URL);

  const hrefs = [...htmlContent.matchAll(/&amp;/g)];
  assert.ok(hrefs.length >= 4, 'the URL appears at least twice, escaped');
  assert.equal(
    htmlContent.split(TOKEN_URL.replace(/&/g, '&amp;')).length - 1,
    2,
    'button href and copy-paste footer carry the identical URL',
  );
});

// ---------------------------------------------------------------------------
// The plain-text half
// ---------------------------------------------------------------------------

test('the text part carries the URL verbatim, entities and all left alone', () => {
  const { textContent } = buildFromResolvedTemplate(fields(), {}, TOKEN_URL);

  assert.ok(
    textContent.includes(TOKEN_URL),
    'a text/plain body is not an HTML sink, so the raw URL belongs there',
  );
});

test('the text part has no tag left in it', () => {
  const { textContent } = buildFromResolvedTemplate(
    fields({ body: '<p>Hello <b>world</b></p>' }),
    {},
    TOKEN_URL,
  );

  assert.doesNotMatch(textContent, /<[a-zA-Z/]/, 'no tag survives stripTags');
  assert.match(textContent, /Hello world/, 'the words do');
});

test('stripTags repeats until a re-forming tag is gone', () => {
  // Single-pass stripping leaves `<scr<script>ipt>` reassembled; this is the
  // reason helpers.js loops, so pin it here rather than trusting the comment.
  assert.doesNotMatch(
    stripTags('<scr<script>ipt>alert(1)</scr</script>ipt>'),
    /</,
  );
  assert.equal(stripTags('text <b'), 'text ');
});
