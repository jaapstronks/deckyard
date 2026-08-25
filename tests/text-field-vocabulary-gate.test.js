/**
 * The text-field vocabulary gate.
 *
 * "Which slide-type fields hold prose" had eight implementations: the collab
 * codec, the server translate pipeline, the translation-status reader, the
 * storage i18n facade, the deck coercion pass, the AI description builder and
 * two editor modules. They disagreed on `hidden`, on `csv` inside items, and
 * on whether items were walked at all — and the collab codec's disagreement
 * silently destroyed the non-dominant language of any deck holding a
 * `text-blocks-slide` (reported by the CIIIC fork, 2026-08-25).
 *
 * `shared/slide-types/text-fields.js` is now the one place that enumerates the
 * three text types. This gate keeps copy nine from growing back: no other
 * module may spell out the whole set in a single expression. Comparing a field
 * type to ONE of them stays fine — a markdown editor legitimately asks "is
 * this markdown", which is a rendering question, not a vocabulary question.
 *
 * Run with: node --test tests/text-field-vocabulary-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The one module allowed to enumerate the vocabulary. */
const CANONICAL = 'shared/slide-types/text-fields.js';

const SCAN_DIRS = ['shared', 'server', 'client', 'scripts'];
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  '.git',
  'data',
  'uploads',
]);

/**
 * A single `type === '<text type>'` comparison. Only an expression covering
 * all THREE text types enumerates the vocabulary; covering two of them is a
 * narrower question (`string || markdown` asks "does this field have a
 * maxLength", `string || markdown || number` asks which widget to render) and
 * stays allowed.
 */
const COMPARISON = /type===(['"])(string|markdown|csv)\1/g;

function enumeratesVocabulary(squashed) {
  // Statement/block delimiters bound one expression well enough: the copies
  // all lived in a single `filter` predicate or a single `if` condition.
  for (const segment of squashed.split(/[;{}]/)) {
    const types = new Set([...segment.matchAll(COMPARISON)].map((m) => m[2]));
    if (types.size === 3) return true;
  }
  return false;
}

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

function offenders() {
  const found = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of jsFiles(abs)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      if (rel === CANONICAL) continue;
      const squashed = fs.readFileSync(file, 'utf8').replace(/\s+/g, '');
      if (enumeratesVocabulary(squashed)) found.push(rel);
    }
  }
  return found;
}

test('only text-fields.js enumerates the text-field types', () => {
  assert.deepEqual(
    offenders(),
    [],
    'These modules spell out the text-field vocabulary themselves. Import ' +
      `isTextField / textFieldSpec from ${CANONICAL} instead.`,
  );
});

test('the gate catches the shape it is meant to catch', () => {
  const copy =
    "fields.filter((f) => f.type === 'string' || f.type === 'markdown' || f.type === 'csv')";
  assert.ok(
    enumeratesVocabulary(copy.replace(/\s+/g, '')),
    'the classic three-way copy must trip the gate',
  );
});

test('narrower type questions are not enumerations', () => {
  const allowed = [
    ['a rendering question', "if (field.type === 'markdown') return md(v);"],
    [
      'a maxLength question',
      "if (field.type === 'string' || field.type === 'markdown') addMax();",
    ],
    [
      'a widget question',
      "if (f.type === 'string' || f.type === 'markdown' || f.type === 'number') input();",
    ],
  ];
  for (const [label, code] of allowed)
    assert.ok(
      !enumeratesVocabulary(code.replace(/\s+/g, '')),
      `${label} must stay allowed`,
    );
});

test('the canonical module is the one that holds the vocabulary', () => {
  const src = fs.readFileSync(path.join(repoRoot, CANONICAL), 'utf8');
  assert.match(src, /TEXT_FIELD_TYPES/);
  for (const type of ['string', 'markdown', 'csv'])
    assert.ok(src.includes(`'${type}'`), `${type} must be listed`);
});
