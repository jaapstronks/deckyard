import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import {
  REPO_ROOT,
  INVENTORY_DOC,
  COUNT_MARKER_FILES,
  TABLE_REGION_FILES,
  applyRegions,
  coreCount,
  buildAllDocs,
} from '../scripts/generate-slide-type-docs.js';
import { DECLARED_SLIDE_TYPE_NAMES } from '../shared/slide-types/tiers.js';
import {
  condenseKeys,
  coverageFor,
  coverageRows,
  familyPattern,
} from '../scripts/lib/slide-type-doc-tables.js';

/**
 * The slide-type inventory doc, the type counts in prose and the two per-type
 * editing-surface tables are generated from the registry
 * (scripts/generate-slide-type-docs.js). These tests gate all three so nothing
 * about a type stays hand-tracked and goes stale. They iterate the registry
 * rather than enumerating type names, so adding or removing a type is covered
 * for free — which is the point of these docs existing.
 */

test('every generated doc is byte-identical to the committed file', async () => {
  for (const [rel, expected] of await buildAllDocs()) {
    const actual = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(
      actual,
      expected,
      `${rel} is out of date — run \`node scripts/generate-slide-type-docs.js\``,
    );
  }
});

/**
 * The doc holds two tables: the registry inventory, and the "declared, not
 * built" names that are part of the published format with nothing rendering them
 * yet. Only the first one is the registry, so the split is on the heading rather
 * than on the row shape — scraping every row would silently fold reserved names
 * into the registry assertion.
 */
function inventoryTable(doc) {
  return doc.split('\n## Declared, not built')[0];
}

test('the inventory lists exactly the core registry, in registration order', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, INVENTORY_DOC), 'utf8');
  const listed = [...inventoryTable(doc).matchAll(/^\| `([^`]+)` \|/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    listed,
    CORE_SLIDE_TYPE_NAMES,
    'the inventory table must match CORE_SLIDE_TYPE_NAMES exactly',
  );
});

test('the declared-not-built table lists exactly the reserved names', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, INVENTORY_DOC), 'utf8');
  const section = doc.split('\n## Declared, not built')[1] || '';
  const listed = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, DECLARED_SLIDE_TYPE_NAMES);
  for (const name of listed) {
    assert.equal(
      CORE_SLIDE_TYPE_NAMES.includes(name),
      false,
      `${name} is registered — it belongs in the inventory table, not here`,
    );
  }
});

test('the stated count equals the real core type count (fork-stable)', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, INVENTORY_DOC), 'utf8');
  const m = /ships \*\*(\d+)\*\* built-in slide types/.exec(doc);
  assert.ok(m, 'inventory doc states a count');
  assert.equal(Number(m[1]), CORE_SLIDE_TYPE_NAMES.length);
  // Custom types (a fork's custom/slide-types/) must not inflate the count.
  assert.ok(
    Object.keys(SLIDE_TYPES).length >= CORE_SLIDE_TYPE_NAMES.length,
    'SLIDE_TYPES is core plus any custom',
  );
});

test('every prose count marker holds the current core count', () => {
  for (const rel of COUNT_MARKER_FILES) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const nums = [
      ...text.matchAll(
        /<!--gen:slide-type-count-->(\d+)<!--\/gen:slide-type-count-->/g,
      ),
    ].map((m) => Number(m[1]));
    assert.ok(nums.length > 0, `${rel}: expected at least one count marker`);
    for (const n of nums) {
      assert.equal(
        n,
        coreCount(),
        `${rel}: stale count marker (${n} ≠ ${coreCount()})`,
      );
    }
  }
});

/**
 * The per-type editing-surface tables (editor-inspector.md, wysiwyg-inline-
 * editing.md). The byte-gate above already fails on any drift; these add the
 * two properties the byte comparison cannot state on its own — that a table
 * covers the whole registry, and that a type leaving the registry takes its row
 * with it rather than leaving an orphan behind.
 */

/** Rows of a generated region, as the type name in the first cell. */
function regionTypes(rel, region) {
  const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const body =
    text.split(`<!--gen:${region}-->`)[1]?.split(`<!--/gen:${region}-->`)[0] ??
    '';
  return [...body.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

test('both per-type tables cover exactly the core registry, in registration order', () => {
  for (const [rel, regions] of Object.entries(TABLE_REGION_FILES)) {
    for (const region of Object.keys(regions)) {
      assert.deepEqual(
        regionTypes(rel, region),
        CORE_SLIDE_TYPE_NAMES,
        `${rel} (${region}): rows must be exactly CORE_SLIDE_TYPE_NAMES`,
      );
    }
  }
});

test('a missing generated region is an error, not a silent skip', () => {
  assert.throws(
    () =>
      applyRegions(
        '# doc\n\nno markers here\n',
        { 'slide-type-coverage': () => 'x' },
        'x.md',
      ),
    /missing generated region/,
  );
});

/**
 * The keep-list column IS the declaration, condensed. Stated separately from
 * the byte-gate because it is the column a reader trusts most: it answers
 * "which settings does the rail still render for this type".
 */
test('the inspector-keeps column restates the declaration', () => {
  const text = fs.readFileSync(
    path.join(REPO_ROOT, 'docs/reference/editor-inspector.md'),
    'utf8',
  );
  for (const row of coverageRows()) {
    const line = text
      .split('\n')
      .find((l) => l.startsWith(`| \`${row.type}\` |`));
    assert.ok(line, `${row.type}: no row in the coverage table`);
    const cell = line.split('|')[4].trim();
    const expected = condenseKeys(row.keeps || []);
    assert.equal(
      cell,
      expected.length ? expected.map((k) => `\`${k}\``).join(', ') : '–',
      `${row.type}: keeps column does not match inspectorKeeps`,
    );
  }
});

/**
 * The parity invariant, as a property rather than a paragraph: a field the user
 * cannot point at on the canvas may not have the bulk modal as its only home
 * (editor-inspector.md, tightened 2026-07-21). Every key the derivation leaves
 * in that column today is a repeatable content collection, so the check is that
 * nothing SETTINGS-shaped joins them — enums, booleans and numbers are exactly
 * the field types with no canvas affordance.
 */
test('no settings-shaped field relies on the bulk modal alone', () => {
  const SETTINGS_TYPES = new Set([
    'enum',
    'boolean',
    'number',
    'color',
    'icon',
  ]);
  /**
   * Keys the inspector genuinely renders, through a per-type widget in
   * `renderInspectorExtrasByType` rather than through the keep-list. That
   * routing is imperative JS, so no declaration says so and the derivation
   * cannot see it — the entry is the honest cost of that, not an exemption from
   * the invariant. Keep it SHORT: an entry here is a standing argument for
   * making the widget's coverage declarative.
   */
  const WIDGET_RENDERED = new Set([]);
  const offenders = [];
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    const row = coverageFor(type);
    const byKey = new Map((row.def.fields || []).map((f) => [f.key, f]));
    for (const key of row.bulkOnly) {
      const field = byKey.get(key);
      if (!field || !SETTINGS_TYPES.has(field.type)) continue;
      if (WIDGET_RENDERED.has(`${type}.${familyPattern(key)}`)) continue;
      offenders.push(`${type}.${key} (${field.type})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'parity violation — a settings field must render in the inspector (or be ' +
      'claimed by the Layout chip / an element knob), never in the bulk modal only:\n' +
      offenders.join('\n'),
  );
});

/**
 * Condensing is what keeps a large numbered `col{n}*`-style schema readable
 * in one cell. The load-bearing half is the refusal: a lone key that merely
 * contains a digit must survive verbatim, or `a11yTitle` would print as
 * `a{n}yTitle`.
 */
test('condenseKeys collapses families and leaves lone keys alone', () => {
  assert.deepEqual(
    condenseKeys(['col1Title', 'col1Text', 'col2Title', 'col2Text']),
    ['col{n}Title', 'col{n}Text'],
  );
  assert.deepEqual(condenseKeys(['col1Block1Body', 'col2Block3Body']), [
    'col{n}Block{m}Body',
  ]);
  assert.deepEqual(condenseKeys(['a11yTitle', 'bunnyLibraryId']), [
    'a11yTitle',
    'bunnyLibraryId',
  ]);
  assert.deepEqual(condenseKeys([]), []);
});
