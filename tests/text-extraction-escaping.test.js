/**
 * Entity decoding and tag stripping do not un-escape what an author escaped.
 *
 * Two families out of the B100 CodeQL triage live here:
 *
 * - **double-escaping**: decoding `&amp;` *before* the other entities turns
 *   `&amp;lt;` into `&lt;` and the next replacement into `<`, so text an author
 *   deliberately escaped comes back as markup. `&amp;` therefore goes last in
 *   every decoder (shared/sanitize.js, docx-parser.js, pptx-parser.js).
 * - **incomplete multi-character sanitization**: `replace(/<[^>]*>/g, '')`
 *   leaves an unterminated `<script` (one with no closing `>`) standing, so the
 *   plain-text half of a multipart email goes through one `stripTags()` that
 *   drops that remnant too.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { initSanitizer, stripHtml } from '../shared/sanitize.js';
import { stripTags } from '../server/integrations/email-templates/helpers.js';

await initSanitizer();

test('stripHtml decodes &amp; last, so escaped markup stays text', async () => {
  // The author wrote `&amp;lt;b&amp;gt;` — i.e. the visible text `&lt;b&gt;`.
  assert.equal(await stripHtml('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  // A single level still decodes normally.
  assert.equal(await stripHtml('a &amp; b'), 'a & b');
  assert.equal(await stripHtml('&lt;b&gt;'), '<b>');
  assert.equal(await stripHtml('<p>plain</p>'), 'plain');
});

test('stripTags leaves no tag, terminated or not', () => {
  assert.equal(stripTags('<p>hallo</p> wereld'), 'hallo wereld');
  // The remnant the plain `<[^>]*>` pass leaves behind.
  assert.equal(stripTags('lees dit <script src=x'), 'lees dit ');
  assert.equal(stripTags('<b>vet</b> en <script'), 'vet en ');
  assert.equal(stripTags(''), '');
  assert.equal(stripTags(null), '');
  // The input is HTML: literal text arrives escaped, and stays escaped here —
  // the plain-text part is not an HTML sink, so nothing decodes it back.
  assert.equal(stripTags('1 &lt; 2'), '1 &lt; 2');
});
