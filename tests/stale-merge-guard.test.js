/**
 * Regression tests for the stale-tab silent-merge overwrite (2026-07-17
 * incident): a browser tab that was ~19 hours / 172 revisions behind
 * autosaved and silently reverted another user's slide, moved newer slides
 * to the end and dropped a colleague's edits — no 409, no conflict toast.
 *
 * Guards under test:
 *  1. Staleness cap: beyond MERGE_MAX_REVISION_GAP revisions of client
 *     staleness the slide-level merge is refused and the save 409s.
 *  2. Per-slide conflict detection: the client sends a base fingerprint per
 *     modified slide; if the server's current slide no longer matches, both
 *     sides changed it and the save 409s with conflictingSlides, instead of
 *     last-writer-wins on stale data.
 *
 * Run with: node --test tests/stale-merge-guard.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson, slideFingerprint } from '../shared/slide-fingerprint.js';
import {
  mergeSlidesAtSlideLevel,
  mergeMaxRevisionGap,
} from '../server/storage/presentations/crud/helpers.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';
import { createSaveManager } from '../client/views/editor/save-manager.js';

const slide = (id, body, extra = {}) => ({
  id,
  type: 'text-slide',
  content: { title: `Slide ${id}`, body },
  notes: '',
  parentId: null,
  ...extra,
});

// ============================================================================
// Unit: fingerprints
// ============================================================================

describe('slideFingerprint', () => {
  it('is stable across object key order', () => {
    const a = { id: 'a', type: 'text-slide', content: { title: 'X', body: 'Y' } };
    const b = { content: { body: 'Y', title: 'X' }, type: 'text-slide', id: 'a' };
    assert.equal(slideFingerprint(a), slideFingerprint(b));
    assert.equal(canonicalJson(a), canonicalJson(b));
  });

  it('changes when content changes', () => {
    assert.notEqual(
      slideFingerprint(slide('a', 'v1')),
      slideFingerprint(slide('a', 'v2'))
    );
  });

  it('ignores undefined values like JSON.stringify does', () => {
    assert.equal(
      slideFingerprint({ id: 'a', gone: undefined }),
      slideFingerprint({ id: 'a' })
    );
  });
});

// ============================================================================
// Unit: mergeSlidesAtSlideLevel guards
// ============================================================================

describe('mergeSlidesAtSlideLevel — staleness cap + fingerprints', () => {
  const serverSlides = [slide('a', 'A server v2'), slide('b', 'B v1')];
  const clientSlides = [slide('a', 'A stale client edit'), slide('b', 'B v1')];

  it('without fingerprints keeps legacy last-writer-wins behaviour', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['a'],
    });
    assert.equal(r.merged, true);
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.slides.find((s) => s.id === 'a').content.body, 'A stale client edit');
  });

  it('flags a conflict when a modified slide also changed server-side', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['a'],
      // Client's base was the original v1 slide — server has since moved on.
      baseFingerprints: { a: slideFingerprint(slide('a', 'A v1')) },
    });
    assert.equal(r.merged, true);
    assert.deepEqual(r.conflicts, ['a']);
  });

  it('merges cleanly when the base fingerprint matches the server slide', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['a'],
      baseFingerprints: { a: slideFingerprint(serverSlides[0]) },
    });
    assert.equal(r.merged, true);
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.slides.find((s) => s.id === 'a').content.body, 'A stale client edit');
  });

  it('refuses to merge beyond the staleness cap', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['a'],
      revisionGap: mergeMaxRevisionGap() + 1,
    });
    assert.equal(r.merged, false);
    assert.equal(r.slides, null);
    assert.deepEqual(r.conflicts, []);
  });

  it('still merges at exactly the staleness cap', () => {
    const r = mergeSlidesAtSlideLevel({
      serverSlides,
      clientSlides,
      modifiedSlideIds: ['a'],
      revisionGap: mergeMaxRevisionGap(),
    });
    assert.equal(r.merged, true);
  });
});

// ============================================================================
// Integration: updatePresentation (file-mode storage)
// ============================================================================

describe('updatePresentation — stale-tab guards (file mode)', () => {
  const X = '33333333-3333-4333-8333-333333333333';
  const Y = '44444444-4444-4444-8444-444444444444';
  const Z = '55555555-5555-4555-8555-555555555555';
  const W = '66666666-6666-4666-8666-666666666666';

  let tempRoot;
  let deckId;
  let template;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stale-merge-test-'));
    const created = await createPresentation(tempRoot, {
      title: 'Stale merge guard',
      ownerEmail: 'owner@example.com',
      lang: 'nl',
    });
    deckId = created.id;
    // Clone a real slide from the created deck so type/schema always validate.
    template = structuredClone(created.slides[0]);
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  /** Valid slide built from the deck's own default slide. */
  const mkSlide = (id, title) => {
    const s = structuredClone(template);
    s.id = id;
    s.content = { ...s.content, title };
    return s;
  };
  const titleOf = (doc, id) => doc.slides.find((s) => s.id === id).content.title;
  const setTitle = (doc, id, title) => {
    const s = doc.slides.find((sl) => sl.id === id);
    s.content = { ...s.content, title };
  };

  const loadDoc = async () => structuredClone(await getPresentation(tempRoot, deckId));

  /** Keep the active i18n buffer in sync with top-level slides, like the client does. */
  const syncI18n = (doc) => {
    const active = doc?.i18n?.active;
    if (active && doc?.i18n?.versions?.[active]) {
      doc.i18n.versions[active].title = doc.title;
      doc.i18n.versions[active].slides = doc.slides;
    }
    return doc;
  };

  const resetDeck = async (slides) => {
    const doc = await loadDoc();
    doc.slides = structuredClone(slides);
    syncI18n(doc);
    await updatePresentation(tempRoot, deckId, doc, { actorEmail: 'owner@example.com' });
    return loadDoc();
  };

  it('reproduction: a stale tab editing a server-changed slide gets a 409, not a silent revert', async () => {
    const base = await resetDeck([mkSlide(X, 'X v1'), mkSlide(Z, 'Z v1')]);

    // The stale tab captures its state (and base fingerprints) here.
    const staleTab = structuredClone(base);
    const staleFingerprints = { [X]: slideFingerprint(staleTab.slides.find((s) => s.id === X)) };

    // Meanwhile another user edits slide X, adds Y mid-deck and deletes Z.
    const other = await loadDoc();
    setTitle(other, X, 'X v2 by other');
    other.slides = [other.slides.find((s) => s.id === X), mkSlide(Y, 'Y new by other')];
    syncI18n(other);
    await updatePresentation(tempRoot, deckId, other, { actorEmail: 'other@example.com' });

    // The stale tab wakes up and autosaves its old copy with its own X edit.
    setTitle(staleTab, X, 'X stale edit');
    syncI18n(staleTab);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, staleTab, {
        expectedRevision: staleTab.revision,
        modifiedSlideIds: [X],
        slideBaseFingerprints: staleFingerprints,
        actorEmail: 'stale@example.com',
      }),
      (e) => {
        assert.equal(e.statusCode, 409);
        assert.deepEqual(e.details?.conflictingSlides, [X]);
        return true;
      }
    );

    // Server state is untouched: other user's work survived.
    const stored = await getPresentation(tempRoot, deckId);
    assert.equal(titleOf(stored, X), 'X v2 by other');
    assert.ok(stored.slides.find((s) => s.id === Y));
  });

  it('disjoint edits with matching fingerprints still merge', async () => {
    const base = await resetDeck([mkSlide(X, 'X v1'), mkSlide(W, 'W v1')]);

    const tabA = structuredClone(base);
    const fingerprints = { [W]: slideFingerprint(tabA.slides.find((s) => s.id === W)) };

    // Other user edits X (revision advances past tabA's base).
    const other = await loadDoc();
    setTitle(other, X, 'X v2 by other');
    syncI18n(other);
    await updatePresentation(tempRoot, deckId, other, { actorEmail: 'other@example.com' });

    // Tab A edits only W: base fingerprint of W still matches the server.
    setTitle(tabA, W, 'W v2 by tab A');
    syncI18n(tabA);
    const updated = await updatePresentation(tempRoot, deckId, tabA, {
      expectedRevision: tabA.revision,
      modifiedSlideIds: [W],
      slideBaseFingerprints: fingerprints,
      actorEmail: 'taba@example.com',
    });

    assert.equal(titleOf(updated, X), 'X v2 by other');
    assert.equal(titleOf(updated, W), 'W v2 by tab A');
  });

  it('a client beyond the staleness cap gets a plain 409 even for disjoint edits', async () => {
    const base = await resetDeck([mkSlide(X, 'X v1'), mkSlide(W, 'W v1')]);
    const staleTab = structuredClone(base);

    // Advance the server well past the cap with harmless saves.
    for (let i = 0; i < mergeMaxRevisionGap() + 1; i += 1) {
      const doc = await loadDoc();
      setTitle(doc, X, `X tick ${i}`);
      syncI18n(doc);
      await updatePresentation(tempRoot, deckId, doc, { actorEmail: 'other@example.com' });
    }

    setTitle(staleTab, W, 'W stale edit');
    syncI18n(staleTab);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, staleTab, {
        expectedRevision: staleTab.revision,
        modifiedSlideIds: [W],
        slideBaseFingerprints: { [W]: slideFingerprint(base.slides.find((s) => s.id === W)) },
        actorEmail: 'stale@example.com',
      }),
      (e) => Number(e.statusCode) === 409
    );
  });
});

// ============================================================================
// Client: save-manager sends base fingerprints and rebases after saves
// ============================================================================

describe('save-manager — base fingerprints', () => {
  const noopToast = { info: () => {}, error: () => {}, success: () => {} };
  const SLIDE_TYPES = { 'text-slide': { fields: [{ key: 'body', type: 'markdown' }] } };

  const makePres = () => ({
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: [slide('a', 'A v1'), slide('b', 'B v1')],
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

  it('sends the pre-edit base fingerprint for modified slides', async () => {
    const pres = makePres();
    const baseFp = slideFingerprint(pres.slides[1]);
    const sentHeaders = [];
    const apiImpl = async (_path, opts) => {
      sentHeaders.push(opts.headers);
      const body = JSON.parse(opts.body);
      return { ...body, revision: Number(opts.headers['If-Match']) + 1, modified: 'x' };
    };
    const mgr = makeManager({ pres, apiImpl });

    pres.slides[1].content.body = 'B v2';
    mgr.markDirty({ slideId: 'b' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    const fps = JSON.parse(sentHeaders[0]['X-Slide-Base-Fingerprints']);
    assert.deepEqual(Object.keys(fps), ['b']);
    assert.equal(fps.b, baseFp, 'must fingerprint the base version, not the edited one');
  });

  it('rebases fingerprints on the save response for the next save', async () => {
    const pres = makePres();
    const sentHeaders = [];
    const apiImpl = async (_path, opts) => {
      sentHeaders.push(opts.headers);
      const body = JSON.parse(opts.body);
      return { ...body, revision: Number(opts.headers['If-Match']) + 1, modified: 'x' };
    };
    const mgr = makeManager({ pres, apiImpl });

    pres.slides[1].content.body = 'B v2';
    mgr.markDirty({ slideId: 'b' });
    await mgr.requestSave();

    pres.slides[1].content.body = 'B v3';
    mgr.markDirty({ slideId: 'b' });
    await mgr.requestSave();
    mgr.cancelAutosave();

    const secondFps = JSON.parse(sentHeaders[1]['X-Slide-Base-Fingerprints']);
    assert.equal(
      secondFps.b,
      slideFingerprint(slide('b', 'B v2')),
      'second save must use the first save result as its base'
    );
  });
});
