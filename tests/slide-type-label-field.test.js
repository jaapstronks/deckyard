/**
 * labelField — the declared slide-list label driver (A7.13 done-gate pass) —
 * and its per-items mirror `itemLabelField` (D81, A2.1).
 *
 * The editor resolves a slide's list label as labelField → title → type
 * label, with no per-type branches; that only holds if every declaration
 * names a field the type actually carries. A typo'd or stale labelField
 * would degrade silently to the title fallback, which is exactly the kind
 * of quiet drift this pins.
 *
 * `itemLabelField` earns the same pin for the same reason: naming a sub-field
 * the item does not carry degrades silently to the first-readable-string
 * default, which is exactly the projection the declaration exists to correct.
 *
 * `mediaRef` (D82, A2.2) is the third: it is what keeps a reference — a video
 * source that may be a bare provider id — out of the reader as text, and a
 * half-declared one degrades just as quietly (an unnamed medium, an ignored
 * author link).
 *
 * The item-level pins hold at every depth of `itemFields`, the walk the
 * validator makes (B233); a fixture proves they can fail below the top level.
 *
 * Run with: node --test tests/slide-type-label-field.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/**
 * Every `fields[]` level of a type, top-level first, then each `itemFields[]`
 * at every depth — the same walk the validator makes (#1111), so a nested
 * repeater (`text-blocks-slide` `rows[].blocks`) earns the same pins as a
 * top-level one (B233).
 *
 * @param {unknown[]} fields
 * @param {string} [path]
 * @returns {Generator<{ fields: any[], path: string }>}
 */
function* fieldLevels(fields, path = '') {
  const level = Array.isArray(fields) ? fields : [];
  yield { fields: level, path };
  for (const field of level) {
    if (field?.type !== 'items') continue;
    yield* fieldLevels(field.itemFields, `${path}${field.key}[].`);
  }
}

/**
 * What is wrong with the `itemLabelField` declarations at any depth.
 *
 * @param {string} name
 * @param {unknown[]} fields
 * @returns {string[]}
 */
function itemLabelFieldProblems(name, fields) {
  const problems = [];
  for (const { fields: level, path } of fieldLevels(fields)) {
    for (const field of level) {
      if (field?.type !== 'items') continue;
      if (field.itemLabelField === undefined) continue;
      const where = `${name}.${path}${field.key}`;
      if (typeof field.itemLabelField !== 'string') {
        problems.push(`${where}: itemLabelField must be a string`);
        continue;
      }
      // Readable, not merely present: a hidden or presentational sub-field is
      // never a heading, so declaring one is the same silent no-op as a typo.
      const headable = (field.itemFields || [])
        .filter((f) => f?.type === 'string' && !f.hidden && !f.presentational)
        .map((f) => f.key);
      if (!headable.includes(field.itemLabelField)) {
        problems.push(
          `${where}: itemLabelField '${field.itemLabelField}' is not ` +
            `a readable string sub-field (${headable.join(', ') || 'none'})`,
        );
      }
    }
  }
  return problems;
}

/**
 * What is wrong with the `mediaRef` declarations at any depth; `linkKey` names
 * a sibling on the same level.
 *
 * @param {string} name
 * @param {unknown[]} fields
 * @returns {string[]}
 */
function mediaRefProblems(name, fields) {
  const problems = [];
  for (const { fields: level, path } of fieldLevels(fields)) {
    const keys = level.map((f) => f?.key);
    for (const field of level) {
      const ref = field?.mediaRef;
      if (ref === undefined) continue;
      const where = `${name}.${path}${field.key}`;
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        problems.push(`${where}: mediaRef must be an object`);
        continue;
      }
      if (field.type !== 'string') {
        problems.push(`${where}: mediaRef belongs on a string reference`);
      }
      if (!(typeof ref.label === 'string' && ref.label.trim())) {
        problems.push(
          `${where}: mediaRef needs a label — without it the reader ` +
            `calls the medium "Media"`,
        );
      }
      if (ref.linkKey !== undefined && !keys.includes(ref.linkKey)) {
        problems.push(
          `${where}: mediaRef.linkKey '${ref.linkKey}' is not one ` +
            `of its fields (${keys.join(', ')})`,
        );
      }
    }
  }
  return problems;
}

test('every declared labelField names a field on its own type', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    if (def.labelField === undefined) continue;
    assert.equal(
      typeof def.labelField,
      'string',
      `${name}: labelField must be a string`,
    );
    const keys = (def.fields || []).map((f) => f.key);
    assert.ok(
      keys.includes(def.labelField),
      `${name}: labelField '${def.labelField}' is not one of its fields (${keys.join(', ')})`,
    );
  }
});

test('every declared itemLabelField, at any depth, names a readable string sub-field', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    assert.deepEqual(itemLabelFieldProblems(name, def.fields), []);
  }
});

test('every declared mediaRef, at any depth, is complete and names its own siblings', () => {
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    assert.deepEqual(mediaRefProblems(name, def.fields), []);
  }
});

// The guards above only prove something if they can fail below the top level:
// no registry type declares a nested itemLabelField or mediaRef today, so a
// fixture shaped like `text-blocks-slide` `rows[].blocks` stands in for one.
const nested = (blockDecl, subDecl = {}) => [
  {
    key: 'rows',
    type: 'items',
    itemFields: [
      {
        key: 'blocks',
        type: 'items',
        ...blockDecl,
        itemFields: [
          { key: 'title', type: 'string' },
          { key: 'note', type: 'string', hidden: true },
          { key: 'src', type: 'string', ...subDecl },
          { key: 'href', type: 'string' },
        ],
      },
    ],
  },
];

test('the itemLabelField guard catches a wrong declaration on a nested repeater', () => {
  assert.deepEqual(
    itemLabelFieldProblems('fixture', nested({ itemLabelField: 'title' })),
    [],
  );
  for (const declared of ['titel', 'note']) {
    const problems = itemLabelFieldProblems(
      'fixture',
      nested({ itemLabelField: declared }),
    );
    assert.equal(problems.length, 1, `'${declared}' should be refused`);
    assert.match(problems[0], /^fixture\.rows\[\]\.blocks: itemLabelField /);
  }
});

test('the mediaRef guard catches a wrong declaration on a nested sub-field', () => {
  assert.deepEqual(
    mediaRefProblems(
      'fixture',
      nested({}, { mediaRef: { label: 'Video', linkKey: 'href' } }),
    ),
    [],
  );
  const problems = mediaRefProblems(
    'fixture',
    nested({}, { mediaRef: { label: '', linkKey: 'url' } }),
  );
  assert.equal(problems.length, 2);
  assert.ok(
    problems.every((p) => p.startsWith('fixture.rows[].blocks[].src: ')),
  );
});
