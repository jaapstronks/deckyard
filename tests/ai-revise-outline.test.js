import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRevisionOperations } from '../server/utils/ai/revise-outline.js';

const outline = () => ({
  title: 'Deck',
  slides: [
    { index: 0, intent: 'chapter', roughContent: 'Part one' },
    { index: 1, intent: 'content', roughContent: 'Bookings EUR 7.1bn', presenterNotes: 'A', hints: ['has-numeric-data'] },
    { index: 2, intent: 'content', roughContent: 'Hiring plans', presenterNotes: 'B', hints: ['has-4-items'] },
    { index: 3, intent: 'content', roughContent: 'Bookings recap EUR 7.1bn', presenterNotes: 'C', hints: ['is-list'] },
    { index: 4, intent: 'content', roughContent: 'Company boilerplate' },
    { index: 5, intent: 'closing', roughContent: 'Thanks' },
  ],
});

test('merge combines two slides into the earlier position', () => {
  const { outline: revised, applied } = applyRevisionOperations(outline(), [
    { type: 'merge', slides: [2, 4], roughContent: 'Bookings EUR 7.1bn, incl. recap', reason: 'restatement' },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(revised.slides.length, 5, 'one slide fewer');
  const merged = revised.slides.find((s) => s.roughContent.includes('incl. recap'));
  assert.ok(merged, 'merged content is present');
  assert.equal(merged.presenterNotes, 'A C', 'notes from both slides are kept');
  assert.deepEqual(merged.hints, ['has-numeric-data', 'is-list'], 'hints are unioned');
});

test('merge without combined content is rejected, so nothing is lost', () => {
  // This is the failure mode that matters: a merge that silently drops the
  // second slide's substance.
  const { outline: revised, applied, rejected } = applyRevisionOperations(outline(), [
    { type: 'merge', slides: [2, 4], reason: 'restatement' },
  ]);
  assert.equal(applied.length, 0);
  assert.equal(rejected[0].why, 'merge must supply the combined content');
  assert.equal(revised.slides.length, 6, 'outline is untouched');
});

test('drops are capped so a revision cannot gut the deck', () => {
  // 4 content slides -> floor(4 * 0.25) = 1 permitted drop.
  const { applied, rejected } = applyRevisionOperations(outline(), [
    { type: 'drop', slide: 5, reason: 'boilerplate' },
    { type: 'drop', slide: 3, reason: 'thin' },
    { type: 'drop', slide: 2, reason: 'thin' },
  ]);
  assert.equal(applied.length, 1, 'only the first drop is allowed');
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].why, /drop cap reached/);
});

test('structural slides cannot be revised', () => {
  const { applied, rejected } = applyRevisionOperations(outline(), [
    { type: 'drop', slide: 1, reason: 'chapter divider' },
    { type: 'drop', slide: 6, reason: 'closing' },
  ]);
  assert.equal(applied.length, 0);
  assert.equal(rejected.length, 2);
  for (const r of rejected) assert.equal(r.why, 'only content slides may be revised');
});

test('a slide may appear in only one operation', () => {
  const { applied, rejected } = applyRevisionOperations(outline(), [
    { type: 'merge', slides: [2, 4], roughContent: 'merged' },
    { type: 'drop', slide: 2, reason: 'also drop it' },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(rejected[0].why, 'a slide may appear in only one operation');
});

test('out-of-range and unknown operations are rejected without touching the outline', () => {
  const { outline: revised, rejected } = applyRevisionOperations(outline(), [
    { type: 'drop', slide: 99, reason: 'nonexistent' },
    { type: 'rewrite', slide: 2, reason: 'not a supported operation' },
  ]);
  assert.equal(revised.slides.length, 6);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].why, /does not exist/);
  assert.match(rejected[1].why, /unknown operation/);
});

test('reorder moves a slide after its anchor', () => {
  const { outline: revised } = applyRevisionOperations(outline(), [
    { type: 'reorder', slide: 4, after: 2, reason: 'definition first' },
  ]);
  const order = revised.slides.map((s) => s.roughContent);
  assert.deepEqual(order, [
    'Part one',
    'Bookings EUR 7.1bn',
    'Bookings recap EUR 7.1bn',
    'Hiring plans',
    'Company boilerplate',
    'Thanks',
  ]);
});

test('an empty operation list leaves the outline identical', () => {
  const before = outline();
  const { outline: revised, applied } = applyRevisionOperations(before, []);
  assert.equal(applied.length, 0);
  assert.deepEqual(
    revised.slides.map((s) => s.roughContent),
    before.slides.map((s) => s.roughContent)
  );
});

test('slides are renumbered contiguously after revision', () => {
  const { outline: revised } = applyRevisionOperations(outline(), [
    { type: 'drop', slide: 5, reason: 'boilerplate' },
  ]);
  assert.deepEqual(
    revised.slides.map((s) => s.index),
    [0, 1, 2, 3, 4]
  );
});
