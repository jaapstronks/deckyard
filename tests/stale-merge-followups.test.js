/**
 * Regression tests for the stale-tab merge follow-ups (layers 3–5 of the
 * 2026-07-17 incident briefing; layers 1+2 are covered by
 * tests/stale-merge-guard.test.js):
 *
 *  3. Order preservation: a client that did not reorder
 *     (X-Slides-Order-Changed: 0) no longer imposes its stale slide order —
 *     the server's order is authoritative, server-new slides stay at their
 *     server position, client-new slides are woven in next to their
 *     neighbour.
 *  4. Client hygiene: a waking tab probes the server revision and either
 *     silently adopts the server state (clean) or runs the normal
 *     merge/conflict save flow (dirty) before the user edits stale content.
 *  5. Audit: every performed slide-level merge reports `_slideMerge`
 *     metadata and a merge by a client more than one revision behind
 *     creates a `pre_merge` snapshot first.
 *
 * Run with: node --test tests/stale-merge-followups.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { slideFingerprint } from '../shared/slide-fingerprint.js';
import { mergeSlidesAtSlideLevel } from '../server/storage/presentations/crud/helpers.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';
import { listPresentationVersions } from '../server/storage/presentations/versions.js';
import { createSaveManager } from '../client/views/editor/save-manager.js';
import { createRemoteRefresh } from '../client/views/editor/remote-refresh.js';

const slide = (id, body, extra = {}) => ({
  id,
  type: 'text-slide',
  content: { title: `Slide ${id}`, body },
  notes: '',
  parentId: null,
  ...extra,
});

const idsOf = (slides) => slides.map((s) => s.id);

// ============================================================================
// Unit: mergeSlidesAtSlideLevel — order preservation (layer 3)
// ============================================================================

describe('mergeSlidesAtSlideLevel — order preservation', () => {
  // Server: another user edited A, inserted N mid-deck, and kept B, C.
  const serverSlides = [
    slide('a', 'A v2 by other'),
    slide('n', 'N new by other'),
    slide('b', 'B v1'),
    slide('c', 'C v1'),
  ];
  // Stale client: never saw N, edited C.
  const clientSlides = [
    slide('a', 'A v1'),
    slide('b', 'B v1'),
    slide('c', 'C client edit'),
  ];

  it('keeps the server order when the client did not reorder', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['c'],
      clientReordered: false,
    });
    assert.equal(r.merged, true);
    assert.deepEqual(r.conflicts, []);
    // N stays mid-deck at its server position instead of being appended.
    assert.deepEqual(idsOf(r.slides), ['a', 'n', 'b', 'c']);
    assert.equal(r.slides.find((s) => s.id === 'a').content.body, 'A v2 by other');
    assert.equal(r.slides.find((s) => s.id === 'c').content.body, 'C client edit');
    assert.deepEqual(r.appendedSlideIds, ['n']);
  });

  it('weaves client-new slides in next to their neighbour', () => {
    const withNew = [
      slide('a', 'A v1'),
      slide('x', 'X new by client'),
      slide('b', 'B v1'),
      slide('c', 'C v1'),
    ];
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides: withNew,
      modifiedSlideIds: ['x'],
      clientReordered: false,
    });
    assert.equal(r.merged, true);
    // X follows A (its client-side neighbour), not the end of the deck.
    assert.deepEqual(idsOf(r.slides), ['a', 'x', 'n', 'b', 'c']);
  });

  it('inserts a client-new first slide at the start of the deck', () => {
    const withNewFirst = [slide('x', 'X new'), slide('a', 'A v1'), slide('b', 'B v1'), slide('c', 'C v1')];
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides: withNewFirst,
      modifiedSlideIds: ['x'],
      clientReordered: false,
    });
    assert.deepEqual(idsOf(r.slides), ['x', 'a', 'n', 'b', 'c']);
  });

  it('still detects fingerprint conflicts in the server-order path', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides: [
        slide('a', 'A stale client edit'),
        slide('b', 'B v1'),
        slide('c', 'C v1'),
      ],
      modifiedSlideIds: ['a'],
      baseFingerprints: { a: slideFingerprint(slide('a', 'A v1')) },
      clientReordered: false,
    });
    assert.equal(r.merged, true);
    assert.deepEqual(r.conflicts, ['a']);
    // Server version kept for the conflicting slide.
    assert.equal(r.slides.find((s) => s.id === 'a').content.body, 'A v2 by other');
  });

  it('applies the client order when the client actually reordered', () => {
    const reordered = [
      slide('c', 'C v1'),
      slide('b', 'B v1'),
      slide('a', 'A v1'),
    ];
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides: reordered,
      modifiedSlideIds: [],
      clientReordered: true,
    });
    assert.equal(r.merged, true);
    // Client order wins; server-new N is appended (no anchor to place it by).
    assert.deepEqual(idsOf(r.slides), ['c', 'b', 'a', 'n']);
    assert.deepEqual(r.appendedSlideIds, ['n']);
  });

  it('treats a missing signal (legacy client) like the old client-order path', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['c'],
    });
    assert.equal(r.merged, true);
    assert.deepEqual(idsOf(r.slides), ['a', 'b', 'c', 'n']);
    assert.deepEqual(r.appendedSlideIds, ['n']);
  });
});

// ============================================================================
// Integration: updatePresentation (file mode) — layers 3 + 5
// ============================================================================

describe('updatePresentation — order preservation, merge audit and pre_merge snapshot', () => {
  const A = '33333333-3333-4333-8333-333333333333';
  const B = '44444444-4444-4444-8444-444444444444';
  const C = '55555555-5555-4555-8555-555555555555';
  const N = '66666666-6666-4666-8666-666666666666';

  let tempRoot;
  let deckId;
  let template;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stale-merge-followups-'));
    const created = await createPresentation(tempRoot, {
      title: 'Stale merge follow-ups',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
    template = structuredClone(created.slides[0]);
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const mkSlide = (id, title) => {
    const s = structuredClone(template);
    s.id = id;
    s.content = { ...s.content, title };
    return s;
  };
  const setTitle = (doc, id, title) => {
    const s = doc.slides.find((sl) => sl.id === id);
    s.content = { ...s.content, title };
  };
  const syncI18n = (doc) => {
    const active = doc?.i18n?.active;
    if (active && doc?.i18n?.versions?.[active]) {
      doc.i18n.versions[active].title = doc.title;
      doc.i18n.versions[active].slides = doc.slides;
    }
    return doc;
  };
  const loadDoc = async () => structuredClone(await getPresentation(tempRoot, deckId));
  const resetDeck = async (slides) => {
    const doc = await loadDoc();
    doc.slides = structuredClone(slides);
    syncI18n(doc);
    await updatePresentation(tempRoot, deckId, doc, { actorEmail: 'owner@example.com' });
    return loadDoc();
  };

  it('a non-reordering stale tab keeps the server order and reports merge metadata', async () => {
    const base = await resetDeck([mkSlide(A, 'A v1'), mkSlide(B, 'B v1'), mkSlide(C, 'C v1')]);
    const staleTab = structuredClone(base);
    const staleFingerprints = {
      [C]: slideFingerprint(staleTab.slides.find((s) => s.id === C)),
    };

    // Another user edits A and inserts N mid-deck (two saves → gap of 2).
    let other = await loadDoc();
    setTitle(other, A, 'A v2 by other');
    syncI18n(other);
    await updatePresentation(tempRoot, deckId, other, { actorEmail: 'other@example.com' });
    other = await loadDoc();
    other.slides = [
      other.slides.find((s) => s.id === A),
      mkSlide(N, 'N new by other'),
      other.slides.find((s) => s.id === B),
      other.slides.find((s) => s.id === C),
    ];
    syncI18n(other);
    await updatePresentation(tempRoot, deckId, other, { actorEmail: 'other@example.com' });

    // The stale tab edited only C and did not reorder.
    setTitle(staleTab, C, 'C stale-tab edit');
    syncI18n(staleTab);
    const updated = await updatePresentation(tempRoot, deckId, staleTab, {
      expectedRevision: staleTab.revision,
      modifiedSlideIds: [C],
      slideBaseFingerprints: staleFingerprints,
      clientReordered: false,
      actorEmail: 'stale@example.com',
    });

    // N stays mid-deck; both users' edits survive.
    assert.deepEqual(idsOf(updated.slides), [A, N, B, C]);
    assert.equal(updated.slides.find((s) => s.id === A).content.title, 'A v2 by other');
    assert.equal(updated.slides.find((s) => s.id === C).content.title, 'C stale-tab edit');

    // Layer 5: merge metadata on the result (input for the audit log).
    assert.ok(updated._slideMerge, 'merge metadata must be attached');
    assert.equal(updated._slideMerge.revisionGap, 2);
    assert.deepEqual(updated._slideMerge.modifiedSlideIds, [C]);
    assert.deepEqual(updated._slideMerge.appendedSlideIds, [N]);
    assert.equal(updated._slideMerge.clientReordered, false);

    // Layer 5: gap > 1 created a pre_merge snapshot of the pre-merge server
    // state, so restoring a bad merge is one click in the version history.
    const versions = await listPresentationVersions(tempRoot, deckId);
    const preMerge = versions.filter((v) => v.reason === 'pre_merge');
    assert.equal(preMerge.length, 1);
    assert.equal(preMerge[0].revision, staleTab.revision + 2);
  });

  it('a merge with gap 1 attaches metadata but skips the pre_merge snapshot', async () => {
    const base = await resetDeck([mkSlide(A, 'A v1'), mkSlide(B, 'B v1')]);
    const staleTab = structuredClone(base);

    const other = await loadDoc();
    setTitle(other, A, 'A v2 by other');
    syncI18n(other);
    await updatePresentation(tempRoot, deckId, other, { actorEmail: 'other@example.com' });

    setTitle(staleTab, B, 'B tab edit');
    syncI18n(staleTab);
    const before = (await listPresentationVersions(tempRoot, deckId)).filter(
      (v) => v.reason === 'pre_merge'
    ).length;
    const updated = await updatePresentation(tempRoot, deckId, staleTab, {
      expectedRevision: staleTab.revision,
      modifiedSlideIds: [B],
      slideBaseFingerprints: {
        [B]: slideFingerprint(base.slides.find((s) => s.id === B)),
      },
      clientReordered: false,
      actorEmail: 'stale@example.com',
    });

    assert.equal(updated._slideMerge.revisionGap, 1);
    const after = (await listPresentationVersions(tempRoot, deckId)).filter(
      (v) => v.reason === 'pre_merge'
    ).length;
    assert.equal(after, before, 'gap 1 must not create a pre_merge snapshot');
  });

  it('a save without conflict attaches no merge metadata', async () => {
    const doc = await loadDoc();
    setTitle(doc, A, 'A clean edit');
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      expectedRevision: doc.revision,
      modifiedSlideIds: [A],
      actorEmail: 'owner@example.com',
    });
    assert.equal(updated._slideMerge, undefined);
  });
});

// ============================================================================
// Client: save-manager — order-changed signal + server-truth rebase
// ============================================================================

describe('save-manager — X-Slides-Order-Changed and rebaseServerTruth', () => {
  const noopToast = { info: () => {}, error: () => {}, success: () => {} };
  const SLIDE_TYPES = { 'text-slide': { fields: [{ key: 'body', type: 'markdown' }] } };

  const makePres = () => ({
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: [slide('a', 'A v1'), slide('b', 'B v1'), slide('c', 'C v1')],
    i18n: { active: 'nl', dominant: 'nl', versions: { nl: { title: 'Deck', slides: [] } } },
  });

  const makeManager = ({ pres, apiImpl }) =>
    createSaveManager({
      api: apiImpl,
      toast: noopToast,
      pres,
      id: pres.id,
      SLIDE_TYPES,
      normalizeLang: (l) => (l === 'nl' || l === 'en-GB' ? l : null),
      otherLang: (l) => (l === 'nl' ? 'en-GB' : 'nl'),
      getSelectedSlideId: () => 'b',
    });

  const echoApi = (sentHeaders) => async (_path, opts) => {
    sentHeaders.push(opts.headers);
    const body = JSON.parse(opts.body);
    return { ...body, revision: Number(opts.headers['If-Match']) + 1, modified: 'x' };
  };

  it("sends '0' when only content changed", async () => {
    const pres = makePres();
    const sentHeaders = [];
    const mgr = makeManager({ pres, apiImpl: echoApi(sentHeaders) });

    pres.slides[1].content.body = 'B v2';
    mgr.markDirty({ slideId: 'b' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    assert.equal(sentHeaders[0]['X-Slides-Order-Changed'], '0');
  });

  it("sends '1' after an actual reorder", async () => {
    const pres = makePres();
    const sentHeaders = [];
    const mgr = makeManager({ pres, apiImpl: echoApi(sentHeaders) });

    pres.slides = [pres.slides[1], pres.slides[0], pres.slides[2]];
    mgr.markDirty({ slideId: 'b' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    assert.equal(sentHeaders[0]['X-Slides-Order-Changed'], '1');
  });

  it("adds and deletes alone don't count as reordering", async () => {
    const pres = makePres();
    const sentHeaders = [];
    const mgr = makeManager({ pres, apiImpl: echoApi(sentHeaders) });

    // Delete C, insert X between A and B — relative order of survivors intact.
    pres.slides = [pres.slides[0], slide('x', 'X new'), pres.slides[1]];
    mgr.markDirty({ slideId: 'x' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    assert.equal(sentHeaders[0]['X-Slides-Order-Changed'], '0');
  });

  it('rebaseServerTruth adopts remote bases but keeps pending local bases', async () => {
    const pres = makePres();
    const sentHeaders = [];
    const mgr = makeManager({ pres, apiImpl: echoApi(sentHeaders) });

    const originalB = slideFingerprint(pres.slides[1]);

    // User edits B (pending), then the tab adopts a remote update where
    // another user changed A.
    pres.slides[1].content.body = 'B local edit';
    mgr.markDirty({ slideId: 'b' });
    const remoteSlides = [slide('a', 'A v2 remote'), pres.slides[1], slide('c', 'C v1')];
    mgr.rebaseServerTruth(remoteSlides);

    // User then also edits A and saves both.
    pres.slides[0] = structuredClone(remoteSlides[0]);
    pres.slides[0].content.body = 'A local edit on top';
    mgr.markDirty({ slideId: 'a' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    const fps = JSON.parse(sentHeaders[0]['X-Slide-Base-Fingerprints']);
    assert.equal(
      fps.a,
      slideFingerprint(slide('a', 'A v2 remote')),
      'adopted slide must be re-based on the remote version'
    );
    assert.equal(
      fps.b,
      originalB,
      'slide with pending local edits must keep its pre-edit base'
    );
  });
});

// ============================================================================
// Client: remote-refresh — wake-up staleness check (layer 4)
// ============================================================================

describe('remote-refresh — wake-up staleness check', () => {
  const makePres = () => ({
    id: 'p1',
    title: 'Deck',
    revision: 3,
    modified: '2026-07-17T09:00:00.000Z',
    slides: [slide('a', 'A v1'), slide('b', 'B v1')],
    i18n: { active: 'nl', dominant: 'nl', versions: { nl: { title: 'Deck', slides: [] } } },
  });

  const stubSaveManager = (overrides = {}) => {
    const calls = { requestSave: 0, rebase: 0 };
    return {
      calls,
      isDirty: () => false,
      isSaving: () => false,
      isBlockedByConflict: () => false,
      requestSave: async () => {
        calls.requestSave += 1;
      },
      rebaseServerTruth: () => {
        calls.rebase += 1;
      },
      ...overrides,
    };
  };

  it('silently adopts the server state when the tab is clean', async () => {
    const pres = makePres();
    const freshSlides = [slide('a', 'A v2 remote'), slide('n', 'N new'), slide('b', 'B v1')];
    const apiCalls = [];
    const api = async (path) => {
      apiCalls.push(path);
      if (path.endsWith('/revision')) return { id: 'p1', revision: 5 };
      return {
        id: 'p1',
        title: 'Deck renamed',
        revision: 5,
        modified: '2026-07-17T10:00:00.000Z',
        updatedBy: 'other@example.com',
        slides: structuredClone(freshSlides),
        i18n: { active: 'nl', dominant: 'nl', versions: { nl: { title: 'Deck renamed', slides: structuredClone(freshSlides) } } },
      };
    };
    const saveManager = stubSaveManager();
    let refreshed = null;
    const rr = createRemoteRefresh({
      api,
      id: 'p1',
      pres,
      saveManager,
      onRefreshed: (info) => {
        refreshed = info;
      },
    });

    await rr.check();

    assert.deepEqual(apiCalls, ['/api/presentations/p1/revision', '/api/presentations/p1?lang=nl']);
    assert.equal(pres.revision, 5);
    assert.equal(pres.title, 'Deck renamed');
    assert.deepEqual(idsOf(pres.slides), ['a', 'n', 'b']);
    assert.equal(saveManager.calls.rebase, 1);
    assert.equal(saveManager.calls.requestSave, 0);
    assert.deepEqual(refreshed.changedSlideIds.sort(), ['a', 'n']);
    // Active-language buffer re-pointed at the adopted slides.
    assert.strictEqual(pres.i18n.versions.nl.slides, pres.slides);
  });

  it('runs the normal save (merge/conflict flow) when the tab is dirty', async () => {
    const pres = makePres();
    const apiCalls = [];
    const api = async (path) => {
      apiCalls.push(path);
      return { id: 'p1', revision: 9 };
    };
    const saveManager = stubSaveManager({ isDirty: () => true });
    const rr = createRemoteRefresh({ api, id: 'p1', pres, saveManager });

    await rr.check();

    assert.deepEqual(apiCalls, ['/api/presentations/p1/revision']);
    assert.equal(saveManager.calls.requestSave, 1);
    assert.equal(saveManager.calls.rebase, 0);
  });

  it('does nothing when the server is not ahead', async () => {
    const pres = makePres();
    const apiCalls = [];
    const api = async (path) => {
      apiCalls.push(path);
      return { id: 'p1', revision: 3 };
    };
    const saveManager = stubSaveManager();
    const rr = createRemoteRefresh({ api, id: 'p1', pres, saveManager });

    await rr.check();

    assert.deepEqual(apiCalls, ['/api/presentations/p1/revision']);
    assert.equal(saveManager.calls.requestSave, 0);
    assert.equal(saveManager.calls.rebase, 0);
  });

  it('throttles bursts of wake signals to a single probe', async () => {
    const pres = makePres();
    let probes = 0;
    const api = async () => {
      probes += 1;
      return { id: 'p1', revision: 3 };
    };
    const rr = createRemoteRefresh({ api, id: 'p1', pres, saveManager: stubSaveManager() });

    await rr.check();
    await rr.check();
    await rr.check();

    assert.equal(probes, 1);
  });

  it('skips entirely when disabled (collab live-edit mode)', async () => {
    const pres = makePres();
    let probes = 0;
    const api = async () => {
      probes += 1;
      return { id: 'p1', revision: 9 };
    };
    const rr = createRemoteRefresh({
      api,
      id: 'p1',
      pres,
      saveManager: stubSaveManager(),
      isEnabled: () => false,
    });

    await rr.check();

    assert.equal(probes, 0);
  });
});
