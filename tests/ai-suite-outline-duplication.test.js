import test from 'node:test';
import assert from 'node:assert/strict';

import { outlineDuplication, outlineMetrics } from '../test-suite/eval/judge-outline.js';

const outline = (roughContents) => ({
  slides: roughContents.map((roughContent, i) => ({
    roughContent,
    intent: 'content',
    groupId: `group-${Math.floor(i / 2) + 1}`,
  })),
});

test('two slides restating the same figures are flagged', () => {
  const result = outlineDuplication(
    outline([
      'Q4 bookings reached EUR 7.1bn with EUV at EUR 3.0bn',
      'Something entirely unrelated about hiring',
      'Bookings recap: EUR 7.1bn total, EUV EUR 3.0bn',
      'Another unrelated topic on logistics',
    ])
  );
  assert.ok(result.duplicatePairs >= 1, 'the restating pair is caught');
  assert.ok(result.examples[0].includes('1+3'), `expected slides 1+3, got ${result.examples[0]}`);
});

test('tokens recurring across the whole deck are discounted', () => {
  // "2024" and "Revenue" appear on every slide: topic vocabulary, not
  // restatement. Without the document-frequency discount every pair matched.
  const result = outlineDuplication(
    outline([
      'Revenue in 2024 grew in the Americas region',
      'Revenue in 2024 fell in the Asia region',
      'Revenue in 2024 was flat in the Europe region',
      'Revenue in 2024 outlook for the Africa region',
    ])
  );
  assert.equal(result.duplicatePairs, 0, 'shared topic vocabulary is not duplication');
});

test('an outline with nothing in common reports no duplication', () => {
  const result = outlineDuplication(
    outline(['Hiring plans for the new team', 'Warehouse logistics in Rotterdam'])
  );
  assert.equal(result.duplicatePairs, 0);
  assert.equal(result.duplicateRate, 0);
});

test('outlineMetrics reports section shape and divider share', () => {
  const plan = {
    slides: [
      { intent: 'chapter', roughContent: 'Part one' },
      { intent: 'content', roughContent: 'a', groupId: 'g1' },
      { intent: 'content', roughContent: 'b', groupId: 'g1' },
      { intent: 'chapter', roughContent: 'Part two' },
      { intent: 'content', roughContent: 'c', groupId: 'g2' },
    ],
  };
  const m = outlineMetrics(plan);
  assert.equal(m.plannedSlides, 5);
  assert.equal(m.sectionCount, 2);
  assert.equal(m.singleSlideSections, 1, 'g2 holds a single slide');
  assert.equal(m.dividerShare, 0.4);
});
