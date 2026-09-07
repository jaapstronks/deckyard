/**
 * Every bindable target names a field the slide type actually declares.
 *
 * `chart-slide` offered `csvData` while the field is called `data`, so the
 * mapping UI let an author bind a live CSV to a key no renderer reads: the
 * binding applied, `applyBindings` reported success, and the chart kept its
 * old data (B196). Nothing caught it because the two lists — the bindable
 * fields here and the type's `fields[]` — were only ever compared by hand.
 *
 * Run with: node --test tests/data-source-binding-targets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BINDABLE_SLIDE_TYPES } from '../shared/data-source.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { applyBindings } from '../server/utils/data-source/bindings.js';

/** `metrics[*].value` → `metrics`; `rows[*].c*` → `rows`; `title` → `title`. */
function headField(target) {
  return String(target).split(/[.[]/)[0];
}

test('every bindable slide type exists', () => {
  for (const name of Object.keys(BINDABLE_SLIDE_TYPES)) {
    assert.ok(SLIDE_TYPES[name], `BINDABLE_SLIDE_TYPES names unknown ${name}`);
  }
});

test('every binding target starts at a declared field', () => {
  for (const [name, info] of Object.entries(BINDABLE_SLIDE_TYPES)) {
    const keys = new Set((SLIDE_TYPES[name]?.fields || []).map((f) => f.key));
    for (const field of info.fields || []) {
      const head = headField(field.target);
      assert.ok(
        keys.has(head),
        `${name}: binding target "${field.target}" writes to "${head}", ` +
          `which is not a field of the type (${[...keys].join(', ')})`,
      );
    }
  }
});

test('a chart binding replaces the data the renderer reads', () => {
  const target = BINDABLE_SLIDE_TYPES['chart-slide'].fields.find(
    (f) => f.label === 'Chart data (CSV)',
  ).target;
  const { content, applied, errors } = applyBindings(
    { chartType: 'bar', data: 'Label,Value\nA,1\nB,2' },
    [{ target, source: 'A1:B3' }],
    { 'A1:B3': 'Label,Value\nC,30\nD,40' },
  );
  assert.deepEqual(errors, []);
  assert.equal(applied, 1);
  assert.equal(content.data, 'Label,Value\nC,30\nD,40');
});
