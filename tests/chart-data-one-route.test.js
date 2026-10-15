/**
 * Chart data has one route (D338, B707): the data editor writes live and a
 * whole session is one undo step, so Cmd+Z after Done takes it all back.
 *
 * - The snapshot undo manager's group (`beginGroup`/`endGroup`): captures far
 *   apart in time stay one step. (The Y.UndoManager side, for live edits, is
 *   covered in `collab-editor-binder.test.js`.)
 * - The data editor has a Done button and no Cancel/Save, and no form renders
 *   the grid inline any more.
 *
 * Run with: node --test tests/chart-data-one-route.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { createUndoManager } =
  await import('../client/lib/state/undo-manager.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deck = (data) => ({ slides: [{ id: 's1', content: { data } }] });

describe('undo group (snapshot undo manager)', () => {
  it('makes a session with pauses one undo step', async () => {
    const undo = createUndoManager({ debounceMs: 20 });
    const pres = deck('Label,Value\nA,10');
    undo.init(pres);

    undo.beginGroup(pres);
    pres.slides[0].content.data = 'Label,Value\nA,11';
    undo.captureSnapshot(pres);
    await sleep(60); // well past the debounce window
    pres.slides[0].content.data = 'Label,Value\nA,12';
    undo.captureSnapshot(pres);
    await sleep(60);
    pres.slides[0].content.data = 'Label,Value\nA,13';
    undo.captureSnapshot(pres);
    undo.endGroup(pres);

    assert.equal(undo.getStackInfo().undoCount, 1);
    const snap = undo.undo(pres);
    assert.equal(snap.pres.slides[0].content.data, 'Label,Value\nA,10');
    assert.equal(undo.canUndo(), false);
  });

  it('does not merge the session into an edit just before it', async () => {
    const undo = createUndoManager({ debounceMs: 1000 });
    const pres = deck('a');
    undo.init(pres);
    pres.slides[0].content.data = 'b';
    undo.captureSnapshot(pres); // still inside its debounce window

    undo.beginGroup(pres);
    pres.slides[0].content.data = 'c';
    undo.captureSnapshot(pres);
    undo.endGroup(pres);

    assert.equal(undo.getStackInfo().undoCount, 2);
    assert.equal(undo.undo(pres).pres.slides[0].content.data, 'b');
  });

  it('starts a new step after the group closes', () => {
    const undo = createUndoManager({ debounceMs: 1000 });
    const pres = deck('a');
    undo.init(pres);
    undo.beginGroup(pres);
    pres.slides[0].content.data = 'b';
    undo.captureSnapshot(pres);
    undo.endGroup(pres);
    pres.slides[0].content.title = 'na de sessie';
    undo.captureSnapshot(pres);
    assert.equal(undo.getStackInfo().undoCount, 2);
  });

  it('leaves the stacks untouched for a session without edits', () => {
    const undo = createUndoManager();
    const pres = deck('a');
    undo.init(pres);
    undo.beginGroup(pres);
    undo.endGroup(pres);
    assert.equal(undo.canUndo(), false);
  });
});

describe('one route to chart data', () => {
  const read = (p) =>
    readFileSync(
      new URL(`../client/views/editor/${p}`, import.meta.url),
      'utf8',
    );

  it('the data editor closes with Done, not Cancel/Save', () => {
    const src = read('chart-data-modal.js');
    assert.match(src, /'common\.done'/);
    assert.doesNotMatch(src, /'common\.(cancel|save)'/);
    assert.doesNotMatch(src, /isDirty|discardConfirm/);
    assert.match(src, /undoGroup\?\.begin\(\)/);
    assert.match(src, /undoGroup\?\.end\(\)/);
  });

  it('a form shows a summary, never the grid itself', () => {
    const src = read('editor-form/render-field.js');
    assert.doesNotMatch(src, /createCsvGridEditor/);
    assert.match(src, /summarizeCsvData/);
  });
});
