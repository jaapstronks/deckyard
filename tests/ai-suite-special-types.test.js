import test from 'node:test';
import assert from 'node:assert/strict';

import { specialTypeUsage } from '../test-suite/eval/metrics.js';

const expected = [
  { type: 'process-slide', because: 'five ordered steps' },
  { type: 'timeline-slide', because: 'dated milestones' },
  { type: 'kpi-metrics-slide', because: 'headline figures' },
];

const deckOf = (...types) => ({ slides: types.map((type) => ({ type, content: {} })) });

test('recall is 1 when every called-for layout is used', () => {
  const r = specialTypeUsage(
    deckOf('title-slide', 'process-slide', 'timeline-slide', 'kpi-metrics-slide'),
    expected
  );
  assert.equal(r.recall, 1);
  assert.equal(r.missing.length, 0);
  assert.deepEqual(r.substitutes, [], 'nothing was substituted');
});

test('a missed specialised type is reported with the reason it was expected', () => {
  const r = specialTypeUsage(deckOf('title-slide', 'list-slide', 'list-slide', 'kpi-metrics-slide'), expected);
  assert.equal(r.recall, 0.33);
  assert.deepEqual(r.missing.map((m) => m.type), ['process-slide', 'timeline-slide']);
  assert.equal(r.missing[0].because, 'five ordered steps', 'the reason travels with the miss');
});

test('the generic types the content fell back to are named', () => {
  // This is the failure mode worth seeing: an ordered process flattened into
  // bullets is a deck that did the easy part and skipped the valuable part.
  const r = specialTypeUsage(deckOf('title-slide', 'list-slide', 'content-slide'), expected);
  assert.ok(r.substitutes.includes('list-slide'));
  assert.ok(r.substitutes.includes('content-slide'));
});

test('a case declaring no expectations scores a full recall rather than zero', () => {
  assert.equal(specialTypeUsage(deckOf('title-slide'), []).recall, 1);
});

test('a declared acceptable alternative counts as a hit', () => {
  // Before/after figures are as legitimately tabular as they are KPI cards;
  // scoring the table as a miss would manufacture a defect.
  const withAlt = [
    { type: 'kpi-metrics-slide', acceptable: ['table-slide'], because: 'before/after pilot figures' },
  ];
  const r = specialTypeUsage(deckOf('title-slide', 'table-slide'), withAlt);
  assert.equal(r.recall, 1);
  assert.deepEqual(r.found, ['table-slide'], 'the alternative actually used is reported');
});

test('an alternative that was not declared is still a miss', () => {
  const strict = [{ type: 'kpi-metrics-slide', because: 'headline figures' }];
  const r = specialTypeUsage(deckOf('title-slide', 'text-blocks-slide'), strict);
  assert.equal(r.recall, 0);
});
