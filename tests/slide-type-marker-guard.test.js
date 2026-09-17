/**
 * Every HTML surface marks its slide wrapper with the full type name (D132,
 * B292).
 *
 * Classes are style hooks and a stylesheet may shorten them (`slide-table`);
 * `data-slide-type` is the one addressable name for "which type is this", so a
 * reader, a stylesheet or an agent reading the HTML never has to reverse a
 * class. The wrappers:
 *
 *  - `section.deck-slide` — presenter (`deck-controller.js`), standalone and
 *    published export (`server/export/html.js`), embed;
 *  - `section.reader-slide` — the reader projection, which the print handout
 *    emits unchanged (D134): one wrapper for both documents.
 *
 * Two halves. The builders we can run server-side are run, so the marker is
 * proven in the output. The presenter builds its wrapper in the browser, so a
 * source guard covers it and every other place a wrapper literal appears: a
 * new surface that spells `deck-slide` without the marker fails here.
 *
 * Run with: node --test tests/slide-type-marker-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStandaloneHtml } from '../server/export/html.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';
import { buildPrintHtml } from '../server/export/print.js';
import { buildReaderHtml } from '../server/export/reader.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const deck = () => ({
  id: 'deck1',
  title: 'Marker deck',
  lang: 'en-GB',
  slides: [
    { id: 's1', type: 'content-slide', content: { title: 'One', body: 'x' } },
    { id: 's2', type: 'callout-slide', content: { variant: 'tip', body: 'y' } },
  ],
});

/** Every start tag of `section.<cls>` in `html`. */
const wrappers = (html, cls) =>
  html.match(new RegExp(`<section\\b[^>]*class="${cls}[\\s"][^>]*>`, 'g')) ||
  [];

const assertMarked = (html, cls) => {
  const tags = wrappers(html, cls);
  assert.equal(tags.length, 2, `${cls}: ${tags.length} wrappers`);
  assert.ok(tags[0].includes('data-slide-type="content-slide"'), tags[0]);
  assert.ok(tags[1].includes('data-slide-type="callout-slide"'), tags[1]);
};

test('export: section.deck-slide carries data-slide-type', async () => {
  assertMarked(await buildStandaloneHtml(repoRoot, deck()), 'deck-slide');
});

test('embed: section.deck-slide carries data-slide-type', () => {
  assertMarked(buildEmbedHtml(repoRoot, deck()), 'deck-slide');
});

test('print: section.reader-slide carries data-slide-type', async () => {
  assertMarked(await buildPrintHtml(repoRoot, deck()), 'reader-slide');
});

test('reader: section.reader-slide carries data-slide-type', () => {
  assertMarked(buildReaderHtml(repoRoot, deck()), 'reader-slide');
});

test('no source spells a slide wrapper without the type marker', () => {
  const roots = ['client', 'server', 'shared'].map((d) =>
    path.join(repoRoot, d),
  );
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) files.push(p);
    }
  };
  roots.forEach(walk);

  // A wrapper literal: an HTML attribute `class="deck-slide…"` or an h() prop
  // `class: 'deck-slide…'`. Selectors (`.deck-slide`) are not wrappers.
  const literal = /class(?:="|:\s*')(deck-slide|reader-slide)(?=[\s"'$])/g;
  const offenders = [];
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(literal)) {
      seen++;
      // The rest of the start tag (template) or of the props object (h()).
      const rest = src.slice(m.index, m.index + 400);
      const end = rest.search(m[0].includes('=') ? />(?![^{]*})/ : /\}\)/);
      const head = end === -1 ? rest : rest.slice(0, end);
      if (!/data-slide-type/.test(head))
        offenders.push(`${path.relative(repoRoot, file)}: ${m[1]}`);
    }
  }
  assert.ok(
    seen >= 4,
    `only ${seen} wrapper literals found; the scan is blind`,
  );
  assert.deepEqual(offenders, []);
});
