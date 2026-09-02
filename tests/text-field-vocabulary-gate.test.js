/**
 * The text-field vocabulary gate.
 *
 * "Which slide-type fields hold prose" was spelled out in eight modules, in
 * eleven separate predicate expressions: the collab codec, the server
 * translate pipeline, the translation-status reader, the storage i18n facade,
 * the deck coercion pass, the AI description builder and two editor modules.
 * They disagreed on `hidden`, on `csv` inside items, and
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

import {
  isPerLanguageKey,
  perLanguageKeys,
  textFieldSpec,
} from '../shared/slide-types/text-fields.js';

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
 * One text-type string literal. Matching the LITERAL rather than a particular
 * operator is what makes the gate hold: an earlier draft keyed on
 * `type === '…'` and missed five idiomatic ways to write the same set —
 * `['string','markdown','csv'].includes(f.type)`, a `Set(...).has(...)`, a
 * three-`case` switch, the negated `!==` chain (literally the shape that lived
 * in `description.js` before this was consolidated), and a chain over a local
 * alias of `f.type`.
 */
const TEXT_TYPE_LITERAL = /(['"])(string|markdown|csv)\1/g;

/**
 * Whether one expression names all three text types. Two of them is a
 * narrower question — `string || markdown` asks "does this field have a
 * maxLength", `string || markdown || number` asks which widget to render —
 * and stays allowed.
 * @param {string} squashed - Source with whitespace removed
 * @returns {boolean}
 */
function enumeratesVocabulary(squashed) {
  // Statement/block delimiters bound one expression well enough: every copy
  // lived in a single `filter` predicate, `if` condition or switch body.
  for (const segment of squashed.split(/[;{}]/)) {
    const types = new Set(
      [...segment.matchAll(TEXT_TYPE_LITERAL)].map((m) => m[2]),
    );
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

test('the gate catches every idiomatic way to rewrite the set', () => {
  const copies = [
    [
      'the classic || chain',
      "fields.filter((f) => f.type === 'string' || f.type === 'markdown' || f.type === 'csv')",
    ],
    [
      'an array includes',
      "if (['string', 'markdown', 'csv'].includes(f.type)) keep(f);",
    ],
    [
      'a Set has',
      "const TEXT = new Set(['string', 'markdown', 'csv']); if (TEXT.has(f.type)) keep(f);",
    ],
    [
      'the negated chain',
      "if (f.type !== 'string' && f.type !== 'markdown' && f.type !== 'csv') continue;",
    ],
    [
      'a chain over a local alias',
      "const t = f.type; if (t === 'string' || t === 'markdown' || t === 'csv') keep(f);",
    ],
    [
      'a three-case switch',
      "switch (f.type) { case 'string': case 'markdown': case 'csv': keep(f); }",
    ],
  ];
  for (const [label, code] of copies)
    assert.ok(
      enumeratesVocabulary(code.replace(/\s+/g, '')),
      `${label} must trip the gate`,
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

// ── the value rule (D79) ───────────────────────────────────────────────────
//
// The second half of the vocabulary: what an *undeclared* content key is. The
// type cannot answer for a key it never declared, so the stored value does —
// a string is prose, anything else is a machine value. Only this module may
// spell that out, for the same reason the type set lives in one place: the
// collab codec and the editor's save sync each carried their own answer, and
// both answered "machine value", which emptied 465 translated strings on the
// CIIIC fork (#1040).

/**
 * The spec members a re-implementation of the rule would have to read. A
 * faithful copy needs `declaredKeys`; a sloppy one gets by on `textKeys` plus
 * a `typeof` — and calls a declared enum's string prose. Since this rule
 * landed, no module outside the canonical one reads either, so both are
 * gated: a consumer asks `isPerLanguageKey` / `perLanguageKeys` and walks
 * `spec.items`, nothing else.
 */
const RULE_MEMBERS = /\b(declaredKeys|textKeys)\b/;

test('only text-fields.js decides what a content key is', () => {
  const found = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of jsFiles(abs)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      if (rel === CANONICAL) continue;
      const m = fs.readFileSync(file, 'utf8').match(RULE_MEMBERS);
      if (m) found.push(`${rel} (${m[1]})`);
    }
  }
  assert.deepEqual(
    found,
    [],
    "These modules read the spec's key sets themselves, which is how a " +
      'second answer to "is this content key prose" gets written. Call ' +
      `isPerLanguageKey / perLanguageKeys from ${CANONICAL} instead.`,
  );
});

test('the value rule: declared answers by type, undeclared by value', () => {
  const spec = textFieldSpec([
    { key: 'title', type: 'string' },
    { key: 'body', type: 'markdown' },
    { key: 'accent', type: 'enum' },
    { key: 'image', type: 'image' },
    { key: 'items', type: 'items', itemFields: [{ key: 'text', type: 'csv' }] },
  ]);

  assert.equal(isPerLanguageKey(spec, 'title', 'Hallo'), true, 'declared text');
  assert.equal(
    isPerLanguageKey(spec, 'title', 42),
    true,
    'a declared text key stays text whatever it happens to hold',
  );
  assert.equal(
    isPerLanguageKey(spec, 'accent', 'lime'),
    false,
    'declared enum',
  );
  assert.equal(
    isPerLanguageKey(spec, 'items', []),
    false,
    'a declared items field is walked, not classified here',
  );
  assert.equal(
    isPerLanguageKey(spec, 'legacyTagline', 'Zo doen wij dat'),
    true,
    'undeclared string is prose',
  );
  assert.equal(
    isPerLanguageKey(spec, 'legacyColumns', 3),
    false,
    'undeclared number is a machine value',
  );
  assert.equal(
    isPerLanguageKey(spec, 'legacyBlob', { a: 1 }),
    false,
    "undeclared object is a machine value: structure is the dominant version's",
  );
  assert.equal(
    isPerLanguageKey(spec, 'legacyMixed', 'text', 7),
    false,
    'versions disagreeing on the kind of value make it a machine value',
  );
  assert.equal(
    isPerLanguageKey(spec, 'ghost'),
    false,
    'a key no version holds is nothing at all',
  );
});

test('perLanguageKeys reads every version, so a peer-only string survives', () => {
  const spec = textFieldSpec([
    { key: 'title', type: 'string' },
    { key: 'accent', type: 'enum' },
  ]);
  const dominant = { title: 'Hallo', accent: 'lime', legacyColumns: 3 };
  const peer = { title: 'Hello', accent: 'lime', legacyTagline: 'Our way' };

  assert.deepEqual(
    [...perLanguageKeys(spec, dominant, peer)].sort(),
    ['legacyTagline', 'title'],
    'the peer-only undeclared string counts, the number does not',
  );
  assert.deepEqual(
    [...perLanguageKeys(spec)],
    ['title'],
    'with no content at all, the declared text keys are the answer',
  );
});
