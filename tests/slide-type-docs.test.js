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
import { initSanitizer } from '../shared/sanitize.js';
import {
  condenseKeys,
  coverageFor,
  coverageRows,
} from '../scripts/lib/slide-type-doc-tables.js';
import { familyPattern } from '../shared/slide-types/field-homes.js';
import { isSettingsField } from '../shared/slide-types/settings-fields.js';

// The item-level coverage renders every core type once to read the canvas's
// `data-inline-field` paths; without DOMPurify the markdown fields would warn.
await initSanitizer();

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
  const listed = [...inventoryTable(doc).matchAll(/^\| `([^`]+)`\s*\|/gm)].map(
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
  const listed = [...section.matchAll(/^\| `([^`]+)`\s*\|/gm)].map((m) => m[1]);
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
  return [...body.matchAll(/^\| `([^`]+)`\s*\|/gm)].map((m) => m[1]);
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
    // Prettier pads table cells to the column width, hence the `\s*`.
    const line = text
      .split('\n')
      .find((l) => new RegExp(`^\\| \`${row.type}\`\\s*\\|`).test(l));
    assert.ok(line, `${row.type}: no row in the coverage table`);
    const cell = line.split('|')[3].trim();
    const expected = condenseKeys(row.keeps || []);
    assert.equal(
      cell,
      expected.length ? expected.map((k) => `\`${k}\``).join(', ') : '–',
      `${row.type}: keeps column does not match inspectorKeeps`,
    );
  }
});

/**
 * The Fields rule (D335), as a property of the schema rather than a paragraph:
 * content has two postures (canvas and the Fields form), a setting one home,
 * and the Fields form beside the inspector renders no setting. So a setting
 * (`isSettingsField`: enum, boolean, number, color, icon, or a widget that
 * picks one) whose only home would be the Fields form renders nowhere in the
 * deck editor. The Fields-only column may hold content - a gap in the canvas
 * posture, not a lost field - but never a setting. Its runtime half, that the
 * form indeed renders none, is `tests/editor-form-surfaces.test.js`.
 */
test('the Fields form holds no setting: no setting has it as its only home', () => {
  /**
   * Keys the inspector genuinely renders, through a per-type widget in
   * `renderInspectorExtrasByType` rather than through the keep-list. That
   * routing is imperative JS, so no declaration says so and the derivation
   * cannot see it — the entry is the honest cost of that, not an exemption from
   * the rule. Keep it SHORT: an entry here is a standing argument for making
   * the widget's coverage declarative.
   */
  const WIDGET_RENDERED = new Set([]);
  const offenders = [];
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    const row = coverageFor(type);
    const byKey = new Map((row.def.fields || []).map((f) => [f.key, f]));
    for (const key of row.fieldsOnly) {
      const field = byKey.get(key);
      if (!isSettingsField(field)) continue;
      if (WIDGET_RENDERED.has(`${type}.${familyPattern(key)}`)) continue;
      offenders.push(`${type}.${key} (${field.type})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a setting must render in the inspector (or be claimed by the Layout row / ' +
      'an element knob); the Fields form renders none, so these render nowhere:\n' +
      offenders.join('\n'),
  );
});

/**
 * The same rule one level down (B450): an ITEM field whose only home is the
 * Fields form. The list-level check above counts a collection as homed once
 * the list is, which is how text-blocks' row arrows and colours once stayed
 * form-only. The ratchet that pinned the leftovers reached zero with B599, so
 * any entry fails, content included: give the field a home - canvas for
 * content, the "This card" tab or the inspector for settings.
 */
test('no item field has the Fields form as its only home', () => {
  const actual = coverageRows().flatMap((r) =>
    r.itemFieldsOnly.map((p) => `${r.type}.${p}`),
  );
  assert.deepEqual(
    actual,
    [],
    'these item fields render nowhere but the Fields form - give each a home ' +
      '(docs/reference/editing-surfaces.md):\n' +
      actual.join('\n'),
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
