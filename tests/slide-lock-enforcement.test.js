/**
 * Tests for server-side slide-lock enforcement on content writes.
 *
 * Slide locks (author lock + concurrent editor lock) used to be enforced
 * client-side only; any API client could edit a locked slide. These tests
 * cover the authz negatives: content edits and deletes on locked slides are
 * rejected with 423, while reorders, additions and edits of unlocked slides
 * pass. Integration tests use file-mode storage in a temp repoRoot (same
 * approach as the other authz tests); concurrent-lock lookups are exercised
 * via the injectable lock loader (the real one is database-backed).
 *
 * Run with: node --test tests/slide-lock-enforcement.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  collectContentChangedSlideIds,
  enforceSlideLocks,
} from '../server/storage/presentations/crud/enforce-slide-locks.js';
import {
  createPresentation,
  getPresentation,
  updatePresentation,
} from '../server/storage/presentations.js';

const OWNER = 'owner@example.com';
const OTHER = 'collab@example.com';
const LOCKED_ID = '11111111-1111-4111-8111-111111111111';
const FREE_ID = '22222222-2222-4222-8222-222222222222';

// ============================================================================
// Unit tests: collectContentChangedSlideIds
// ============================================================================

describe('collectContentChangedSlideIds', () => {
  const slide = (id, extra = {}) => ({
    id,
    type: 'text-slide',
    content: { title: 'Titel', body: 'Tekst' },
    notes: '',
    parentId: null,
    ...extra,
  });

  it('returns empty for identical slides', () => {
    const prev = [slide('a'), slide('b')];
    const next = [slide('a'), slide('b')];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });

  it('ignores object key order', () => {
    const prev = [{ id: 'a', type: 'text-slide', content: { title: 'X', body: 'Y' } }];
    const next = [{ content: { body: 'Y', title: 'X' }, type: 'text-slide', id: 'a' }];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });

  it('detects a content change', () => {
    const prev = [slide('a'), slide('b')];
    const next = [slide('a'), slide('b', { content: { title: 'Anders', body: 'Tekst' } })];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), ['b']);
  });

  it('detects a deletion', () => {
    const prev = [slide('a'), slide('b')];
    const next = [slide('a')];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), ['b']);
  });

  it('ignores additions (new slides cannot be locked)', () => {
    const prev = [slide('a')];
    const next = [slide('a'), slide('new')];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });

  it('ignores pure reorders', () => {
    const prev = [slide('a'), slide('b'), slide('c')];
    const next = [slide('c'), slide('a'), slide('b')];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });

  it('ignores a lockedByAuthor toggle (the flag has its own guard)', () => {
    const prev = [slide('a', { lockedByAuthor: true })];
    const next = [slide('a')];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });

  it('treats a missing parentId as null (legacy slides)', () => {
    const prev = [{ id: 'a', type: 'text-slide', content: { title: 'X' } }];
    const next = [{ id: 'a', type: 'text-slide', content: { title: 'X' }, parentId: null }];
    assert.deepEqual(collectContentChangedSlideIds(prev, next), []);
  });
});

// ============================================================================
// Unit tests: enforceSlideLocks (injected lock loader)
// ============================================================================

describe('enforceSlideLocks', () => {
  const locked = { id: 'locked', type: 'text-slide', content: { title: 'Vast' }, lockedByAuthor: true };
  const free = { id: 'free', type: 'text-slide', content: { title: 'Los' } };
  const noLocks = async () => ({});

  const edited = (slide) => ({ ...slide, content: { ...slide.content, title: 'Bewerkt' } });

  it('rejects a non-author editing an author-locked slide with 423', async () => {
    await assert.rejects(
      enforceSlideLocks({
        presentationId: 'p1',
        previousSlides: [locked, free],
        nextSlides: [edited(locked), free],
        isAuthor: false,
        actorEmail: OTHER,
        loadSlideLocks: noLocks,
      }),
      (e) => e.statusCode === 423 && e.details?.lockKind === 'author' && e.details?.slideId === 'locked'
    );
  });

  it('rejects a non-author deleting an author-locked slide', async () => {
    await assert.rejects(
      enforceSlideLocks({
        presentationId: 'p1',
        previousSlides: [locked, free],
        nextSlides: [free],
        isAuthor: false,
        actorEmail: OTHER,
        loadSlideLocks: noLocks,
      }),
      (e) => e.statusCode === 423 && e.details?.lockKind === 'author'
    );
  });

  it('allows the author to edit their own locked slide', async () => {
    await enforceSlideLocks({
      presentationId: 'p1',
      previousSlides: [locked, free],
      nextSlides: [edited(locked), free],
      isAuthor: true,
      actorEmail: OWNER,
      loadSlideLocks: noLocks,
    });
  });

  it('allows a non-author to edit unlocked slides next to a locked one', async () => {
    await enforceSlideLocks({
      presentationId: 'p1',
      previousSlides: [locked, free],
      nextSlides: [locked, edited(free)],
      isAuthor: false,
      actorEmail: OTHER,
      loadSlideLocks: noLocks,
    });
  });

  it('rejects edits on a slide concurrently locked by someone else (even the author)', async () => {
    const locks = async () => ({
      free: { slideId: 'free', holderEmail: OTHER, holderName: 'Christel' },
    });
    await assert.rejects(
      enforceSlideLocks({
        presentationId: 'p1',
        previousSlides: [locked, free],
        nextSlides: [locked, edited(free)],
        isAuthor: true,
        actorEmail: OWNER,
        loadSlideLocks: locks,
      }),
      (e) =>
        e.statusCode === 423 &&
        e.details?.lockKind === 'concurrent' &&
        e.details?.holderName === 'Christel'
    );
  });

  it('allows edits on a slide the actor holds the concurrent lock for', async () => {
    const locks = async () => ({
      free: { slideId: 'free', holderEmail: OTHER, holderName: 'Christel' },
    });
    await enforceSlideLocks({
      presentationId: 'p1',
      previousSlides: [locked, free],
      nextSlides: [locked, edited(free)],
      isAuthor: false,
      actorEmail: OTHER,
      loadSlideLocks: locks,
    });
  });

  it('does not consult locks at all when nothing changed', async () => {
    let called = false;
    await enforceSlideLocks({
      presentationId: 'p1',
      previousSlides: [locked, free],
      nextSlides: [free, locked], // reorder only
      isAuthor: false,
      actorEmail: OTHER,
      loadSlideLocks: async () => {
        called = true;
        return {};
      },
    });
    assert.equal(called, false);
  });
});

// ============================================================================
// Integration tests: updatePresentation (file-mode storage)
// ============================================================================

describe('updatePresentation — slide-lock enforcement (file mode)', () => {
  let tempRoot;
  let deckId;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-lock-enf-test-'));
    const created = await createPresentation(tempRoot, {
      title: 'Lock enforcement',
      ownerEmail: OWNER,
      lang: 'nl',
    });
    deckId = created.id;
  });
  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  /** Fresh working copy of the stored deck. */
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

  beforeEach(async () => {
    // Reset to a known two-slide state: one author-locked, one free.
    const doc = await loadDoc();
    const base = structuredClone(doc.slides[0]);
    doc.slides = [
      { ...structuredClone(base), id: LOCKED_ID, lockedByAuthor: true },
      { ...structuredClone(base), id: FREE_ID, lockedByAuthor: false },
    ];
    syncI18n(doc);
    await updatePresentation(tempRoot, deckId, doc, { actorEmail: OWNER });
  });

  it('rejects a non-author content edit on an author-locked slide with 423', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'Gehackt';
    syncI18n(doc);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER }),
      (e) => e.statusCode === 423 && e.details?.slideId === LOCKED_ID
    );
    // Nothing was written
    const stored = await getPresentation(tempRoot, deckId);
    assert.notEqual(
      stored.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Gehackt'
    );
  });

  it('rejects a non-author deleting an author-locked slide with 423', async () => {
    const doc = await loadDoc();
    doc.slides = doc.slides.filter((s) => s.id !== LOCKED_ID);
    syncI18n(doc);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER }),
      (e) => e.statusCode === 423
    );
  });

  it('allows a non-author to edit the unlocked slide', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === FREE_ID).content.title = 'Aangepast';
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER });
    assert.equal(
      updated.slides.find((s) => s.id === FREE_ID).content.title,
      'Aangepast'
    );
  });

  it('allows a non-author to reorder slides without touching content', async () => {
    const doc = await loadDoc();
    doc.slides = [...doc.slides].reverse();
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER });
    assert.equal(updated.slides[0].id, FREE_ID);
  });

  it('allows the author to edit their own locked slide', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'Door auteur';
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, { actorEmail: OWNER });
    assert.equal(
      updated.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Door auteur'
    );
  });

  it('treats admins as authors (matches the client seam)', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'Door admin';
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      actorEmail: 'admin@example.com',
      user: { email: 'admin@example.com', isAdmin: true },
    });
    assert.equal(
      updated.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Door admin'
    );
  });

  it('still rejects a non-author toggling the lockedByAuthor flag (existing guard)', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === LOCKED_ID).lockedByAuthor = false;
    syncI18n(doc);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER }),
      (e) => e.statusCode === 400
    );
  });

  it('skips enforcement on internal writes (bypassLockCheck)', async () => {
    const doc = await loadDoc();
    doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'Interne write';
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, {
      actorEmail: OTHER,
      bypassLockCheck: true,
      user: { email: OWNER }, // internal writes act for the author
    });
    assert.equal(
      updated.slides.find((s) => s.id === LOCKED_ID).content.title,
      'Interne write'
    );
  });

  it('skips enforcement when collab live edits are on (locks phased out)', async () => {
    process.env.COLLAB_ENABLED = 'true';
    process.env.COLLAB_LIVE_EDITS = 'true';
    try {
      const doc = await loadDoc();
      doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'Via CRDT-pad';
      syncI18n(doc);
      // The author-lock *flag* guard still applies, so act as the author here;
      // the point is that the content-edit enforcement itself is off.
      const updated = await updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER, bypassLockCheck: false, user: { email: OWNER } });
      assert.equal(
        updated.slides.find((s) => s.id === LOCKED_ID).content.title,
        'Via CRDT-pad'
      );
    } finally {
      delete process.env.COLLAB_ENABLED;
      delete process.env.COLLAB_LIVE_EDITS;
    }
  });

  it('does not false-positive on a language switch (diffs against the stored buffer)', async () => {
    // Owner creates an en-GB version whose locked slide has its own text.
    let doc = await loadDoc();
    doc.i18n.versions['en-GB'] = {
      title: 'Lock enforcement (EN)',
      slides: structuredClone(doc.slides).map((s) => ({
        ...s,
        content: { ...s.content, title: `EN ${s.id}` },
      })),
    };
    syncI18n(doc);
    await updatePresentation(tempRoot, deckId, doc, { actorEmail: OWNER });

    // Non-author switches the active language: top-level slides become the
    // en-GB buffer (every slide's content differs from the stored nl slides),
    // and edits only the free slide. Must not 423 on the untouched locked one.
    doc = await loadDoc();
    doc.i18n.active = 'en-GB';
    doc.title = doc.i18n.versions['en-GB'].title;
    doc.slides = structuredClone(doc.i18n.versions['en-GB'].slides);
    doc.slides.find((s) => s.id === FREE_ID).content.title = 'EN edited';
    syncI18n(doc);
    const updated = await updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER });
    // Top-level slides realign to the dominant (nl) buffer; the edit lands
    // in the en-GB version buffer.
    assert.equal(
      updated.i18n.versions['en-GB'].slides.find((s) => s.id === FREE_ID).content.title,
      'EN edited'
    );
  });

  it('rejects a locked-slide edit hidden inside a language switch', async () => {
    let doc = await loadDoc();
    doc.i18n.versions['en-GB'] = {
      title: 'Lock enforcement (EN)',
      slides: structuredClone(doc.slides).map((s) => ({
        ...s,
        content: { ...s.content, title: `EN ${s.id}` },
      })),
    };
    syncI18n(doc);
    await updatePresentation(tempRoot, deckId, doc, { actorEmail: OWNER });

    doc = await loadDoc();
    doc.i18n.active = 'en-GB';
    doc.title = doc.i18n.versions['en-GB'].title;
    doc.slides = structuredClone(doc.i18n.versions['en-GB'].slides);
    doc.slides.find((s) => s.id === LOCKED_ID).content.title = 'EN gehackt';
    syncI18n(doc);
    await assert.rejects(
      updatePresentation(tempRoot, deckId, doc, { actorEmail: OTHER }),
      (e) => e.statusCode === 423 && e.details?.slideId === LOCKED_ID
    );
  });
});
