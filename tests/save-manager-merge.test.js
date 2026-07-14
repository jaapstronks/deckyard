/**
 * Regression tests for concurrent-editing save behaviour in the editor's
 * save manager. Covers the silent-data-loss chain where a server-side
 * slide-level merge advanced the client's revision without the client
 * adopting the merged content, so the next save overwrote the other
 * editor's work while the UI reported "Saved".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveManager } from '../client/views/editor/save-manager.js';

const noopToast = {
  info: () => {},
  error: () => {},
  success: () => {},
};

const SLIDE_TYPES = {
  'text-slide': { fields: [{ key: 'body', type: 'markdown' }] },
};

function makePres() {
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: [
      { id: 'a', type: 'text-slide', content: { body: 'A v1' } },
      { id: 'b', type: 'text-slide', content: { body: 'B v1' } },
    ],
    i18n: { active: 'nl', dominant: 'nl', versions: { nl: { title: 'Deck', slides: [] } } },
  };
}

function makeManager({ pres, apiImpl, onRemoteMerge, selectedSlideId = 'b' }) {
  return createSaveManager({
    api: apiImpl,
    toast: noopToast,
    pres,
    id: pres.id,
    SLIDE_TYPES,
    normalizeLang: (l) => (l === 'nl' || l === 'en-GB' ? l : null),
    otherLang: (l) => (l === 'nl' ? 'en-GB' : 'nl'),
    onRemoteMerge,
    getSelectedSlideId: () => selectedSlideId,
  });
}

test('save without concurrent writes keeps local slides and adopts revision', async () => {
  const pres = makePres();
  const apiImpl = async (_path, opts) => {
    const body = JSON.parse(opts.body);
    return { ...body, revision: Number(opts.headers['If-Match']) + 1, modified: 'x' };
  };
  const mgr = makeManager({ pres, apiImpl });

  pres.slides[1].content.body = 'B v2';
  mgr.markDirty({ slideId: 'b' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.equal(pres.revision, 2);
  assert.equal(pres.slides[1].content.body, 'B v2');
  assert.equal(mgr.isDirty(), false);
});

test('server-side merge: client adopts other editor\'s slides instead of going stale', async () => {
  const pres = makePres();
  let merged = null;
  const apiImpl = async (_path, opts) => {
    const body = JSON.parse(opts.body);
    // Simulate the server's slide-level merge: another editor already saved
    // revision 2 with a change to slide "a"; our If-Match 1 conflicts and the
    // server merges (their slide "a" + our slide "b") into revision 3.
    merged = {
      ...body,
      revision: 3,
      slides: [
        { id: 'a', type: 'text-slide', content: { body: 'A changed by other' } },
        body.slides.find((s) => s.id === 'b'),
      ],
    };
    return merged;
  };
  const remoteMergeCalls = [];
  const mgr = makeManager({
    pres,
    apiImpl,
    onRemoteMerge: (info) => remoteMergeCalls.push(info),
  });

  pres.slides[1].content.body = 'B v2';
  mgr.markDirty({ slideId: 'b' });
  await mgr.requestSave();
  mgr.cancelAutosave();

  assert.equal(pres.revision, 3);
  // Our own edit survives…
  assert.equal(pres.slides.find((s) => s.id === 'b').content.body, 'B v2');
  // …and the other editor's change is adopted locally, so the next save
  // (If-Match 3, no conflict) can no longer overwrite it with stale content.
  assert.equal(
    pres.slides.find((s) => s.id === 'a').content.body,
    'A changed by other'
  );
  assert.equal(remoteMergeCalls.length, 1);
  assert.deepEqual(remoteMergeCalls[0].changedSlideIds, ['a']);
});

test('edits made while a save is in flight stay tracked for the next save', async () => {
  const pres = makePres();
  const sentModifiedHeaders = [];
  let resolveFirstSave;
  let call = 0;
  const apiImpl = async (_path, opts) => {
    sentModifiedHeaders.push(opts.headers['X-Modified-Slides'] || null);
    const body = JSON.parse(opts.body);
    call += 1;
    if (call === 1) {
      // Hold the first save open so a mid-flight edit can happen
      await new Promise((resolve) => { resolveFirstSave = resolve; });
    }
    return { ...body, revision: Number(opts.headers['If-Match']) + 1, modified: 'x' };
  };
  const mgr = makeManager({ pres, apiImpl });

  pres.slides[1].content.body = 'B v2';
  mgr.markDirty({ slideId: 'b' });
  const firstSave = mgr.requestSave();

  // Edit slide "a" while the first save is in flight
  await new Promise((r) => setTimeout(r, 10));
  pres.slides[0].content.body = 'A v2';
  mgr.markDirty({ slideId: 'a' });
  // Queue a follow-up save (mirrors what markDirty's autosave would do)
  const queued = mgr.requestSave();

  resolveFirstSave();
  await firstSave;
  await queued;
  // Allow the queued follow-up save (triggered in the finally block) to run
  await new Promise((r) => setTimeout(r, 20));
  mgr.cancelAutosave();

  assert.equal(call, 2, 'expected a follow-up save for the mid-flight edit');
  const secondHeader = JSON.parse(sentModifiedHeaders[1]);
  assert.ok(
    secondHeader.includes('a'),
    `mid-flight edit to slide "a" must stay tracked (got ${sentModifiedHeaders[1]})`
  );
});
