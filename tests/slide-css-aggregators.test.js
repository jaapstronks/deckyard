import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CORE_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import {
  TIERS,
  TYPE_CSS,
  SHARED_CSS,
  typeCssEntries,
  cascadeOrder,
  tierEntries,
  buildAllAggregators,
  aggregatorAbsPath,
  REPO_ROOT,
} from '../scripts/generate-slide-css-aggregators.js';

/**
 * The `@import` aggregators under client/styles/slides/ are derived from the
 * manifest in scripts/generate-slide-css-aggregators.js, not hand-maintained.
 * These tests are the gate that keeps the two honest — and, crucially, that the
 * derivation preserves cascade order (the numeric prefixes are cascade order,
 * not a sort key; see the script header).
 */

test('every committed aggregator is byte-identical to the generated output', () => {
  for (const [rel, expected] of buildAllAggregators()) {
    const actual = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.equal(
      actual,
      expected,
      `${rel} is out of date — run \`node scripts/generate-slide-css-aggregators.js\``
    );
  }
});

test('every type-owned CSS entry names a real core type', () => {
  const core = new Set(CORE_SLIDE_TYPE_NAMES);
  for (const type of Object.keys(TYPE_CSS)) {
    assert.ok(
      core.has(type),
      `TYPE_CSS has "${type}" but it is not a registered core type — ` +
        `rename or remove the entry (it would emit a dead @import)`
    );
  }
});

test('every CSS file on disk is claimed exactly once (no orphans, no drift)', () => {
  for (const tier of TIERS) {
    const dir = aggregatorAbsPath(tier).replace(/\.css$/, '');
    const onDisk = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .sort();
    const claimed = tierEntries(tier.dir)
      .map((e) => e.file)
      .sort();
    assert.deepEqual(
      claimed,
      onDisk,
      `tier ${tier.dir}: the files on disk and the declared imports disagree — ` +
        `a new stylesheet must be declared (on a type via TYPE_CSS, or in SHARED_CSS), ` +
        `and a removed one un-declared`
    );
  }
});

test('cascade order is unique within each tier (no ambiguous winner)', () => {
  for (const tier of TIERS) {
    const orders = tierEntries(tier.dir).map((e) => e.order);
    assert.equal(
      new Set(orders).size,
      orders.length,
      `tier ${tier.dir}: two imports share a cascade order — the winner is undefined`
    );
  }
});

test('no CSS file is declared twice (type and shared, or across tiers)', () => {
  const seen = new Map();
  const all = [
    ...typeCssEntries().map((e) => ({ tier: e.tier, file: e.file })),
    ...SHARED_CSS.map((e) => ({ tier: e.tier, file: e.file })),
  ];
  for (const { tier, file } of all) {
    const key = `${tier}/${file}`;
    assert.ok(!seen.has(key), `${key} is declared more than once`);
    seen.set(key, true);
  }
});

test('poll keeps its documented out-of-cascade position after countdown', () => {
  // The one anomaly the manifest encodes explicitly: guard it so a future edit
  // that "tidies" poll back to its filename prefix trips here first.
  const order = tierEntries('03-components');
  const idx = (file) => order.findIndex((e) => e.file === file);
  assert.ok(idx('10-poll.css') > idx('18-countdown.css'), 'poll loads after countdown');
  assert.ok(idx('10-poll.css') < idx('20-chart.css'), 'poll loads before chart');
  assert.equal(cascadeOrder(TYPE_CSS['poll-slide'][0]), 19);
});
