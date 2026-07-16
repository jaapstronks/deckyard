/**
 * Headless test for the editor live-doc binder (phase 2, step 3): a real
 * Hocuspocus mount with COLLAB_LIVE_EDITS=true and two clients that mimic
 * the editor — each holds its own `pres` object and a live-doc binder, edits
 * mutate `pres` followed by `syncLocal()` (the markDirty seam), and remote
 * changes must appear in the other client's `pres` via the binder's
 * projection.
 *
 * Run with: node --test tests/collab-editor-binder.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { maybeAttachCollab, shutdownCollab } = await import('../server/collab/mount.js');
const { createPresentation, getPresentation } = await import(
  '../server/storage/presentations.js'
);
const { createPresenceSession } = await import('../client/lib/collab/presence-session.js');
const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } = await import('../client/lib/collab/live-doc-binder.js');

/** Poll until `fn()` is truthy or the timeout elapses. */
async function waitFor(fn, { timeout = 8000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('editor binder: two clients over a live mount', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-binder-'));
  const stored = await createPresentation(repoRoot, {
    title: 'Binder deck',
    ownerEmail: 'anonymous',
    lang: 'nl',
  });

  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, { repoRoot });
  assert.ok(hocuspocus, 'collab should mount');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/collab`;

  /** An editor-like client: presence session + own pres + binder. */
  async function makeClient(email) {
    const session = createPresenceSession({
      presentationId: stored.id,
      user: { email, name: email.split('@')[0] },
      url,
    });
    const doc = session._provider.document;
    const pres = structuredClone(await getPresentation(repoRoot, stored.id));
    const remoteEvents = [];
    const binder = createLiveDocBinder({
      Y,
      doc,
      codec: createDeckYdocCodec(Y),
      pres,
      getActiveLang: () => pres?.i18n?.active || null,
      onRemoteApplied: (ev) => remoteEvents.push(ev),
    });
    await waitFor(() => doc.getMap('meta').get('extra'));
    binder.attach();
    return { session, doc, pres, binder, remoteEvents };
  }

  const a = await makeClient('alice@example.com');
  const b = await makeClient('bob@example.com');

  t.after(async () => {
    a.binder.destroy();
    b.binder.destroy();
    a.session.destroy();
    b.session.destroy();
    await shutdownCollab();
    await new Promise((resolve) => server.close(resolve));
    rmSync(repoRoot, { recursive: true, force: true });
  });

  const firstId = a.pres.slides[0].id;
  const lijstjeId = crypto.randomUUID();

  await t.test('a field edit propagates and keeps slide object identity', async () => {
    const bSlideRef = b.pres.slides.find((s) => s.id === firstId);
    a.pres.slides[0].content.title = 'Hallo van Alice';
    a.binder.syncLocal();
    await waitFor(
      () => b.pres.slides.find((s) => s.id === firstId)?.content?.title === 'Hallo van Alice'
    );
    // The form's onChange closures hold the slide object — identity must survive.
    assert.equal(b.pres.slides.find((s) => s.id === firstId), bSlideRef);
    const ev = b.remoteEvents.find((e) => e.changedSlideIds.has(firstId));
    assert.ok(ev, 'onRemoteApplied should report the changed slide');
  });

  await t.test('concurrent edits in different fields both survive', async () => {
    a.pres.slides[0].notes = 'Notitie van Alice';
    b.pres.slides[0].content.title = 'Titel van Bob';
    a.binder.syncLocal();
    b.binder.syncLocal();
    await waitFor(
      () =>
        a.pres.slides[0].content.title === 'Titel van Bob' &&
        b.pres.slides[0].notes === 'Notitie van Alice'
    );
  });

  await t.test('same-field concurrent typing merges at character level', async () => {
    const base = a.pres.slides[0].content.title;
    assert.equal(b.pres.slides[0].content.title, base);
    a.pres.slides[0].content.title = `Links ${base}`;
    b.pres.slides[0].content.title = `${base} rechts`;
    a.binder.syncLocal();
    b.binder.syncLocal();
    await waitFor(
      () =>
        a.pres.slides[0].content.title === `Links ${base} rechts` &&
        b.pres.slides[0].content.title === `Links ${base} rechts`
    );
  });

  await t.test('adding a slide propagates with projected content', async () => {
    a.pres.slides.push({
      id: lijstjeId,
      type: 'lijstje-slide',
      content: {
        title: 'Lijstje',
        items: [
          { title: 'Een', text: 'eerste' },
          { title: 'Twee', text: 'tweede' },
        ],
      },
      notes: '',
    });
    a.binder.syncLocal();
    await waitFor(() => b.pres.slides.some((s) => s.id === lijstjeId));
    const got = b.pres.slides.find((s) => s.id === lijstjeId);
    assert.equal(got.content.title, 'Lijstje');
    assert.deepEqual(
      got.content.items.map((i) => i.title),
      ['Een', 'Twee']
    );
  });

  await t.test('concurrent item edits on different items both survive', async () => {
    const ai = a.pres.slides.find((s) => s.id === lijstjeId);
    const bi = b.pres.slides.find((s) => s.id === lijstjeId);
    ai.content.items = ai.content.items.map((it, i) =>
      i === 0 ? { ...it, text: 'door Alice' } : it
    );
    bi.content.items = bi.content.items.map((it, i) =>
      i === 1 ? { ...it, text: 'door Bob' } : it
    );
    a.binder.syncLocal();
    b.binder.syncLocal();
    await waitFor(() => {
      const itemsA = a.pres.slides.find((s) => s.id === lijstjeId).content.items;
      const itemsB = b.pres.slides.find((s) => s.id === lijstjeId).content.items;
      return (
        itemsA[0].text === 'door Alice' &&
        itemsA[1].text === 'door Bob' &&
        itemsB[0].text === 'door Alice' &&
        itemsB[1].text === 'door Bob'
      );
    });
  });

  await t.test('adding and removing items converges', async () => {
    const ai = a.pres.slides.find((s) => s.id === lijstjeId);
    ai.content.items = [...ai.content.items, { title: 'Drie', text: 'derde' }];
    a.binder.syncLocal();
    await waitFor(
      () => b.pres.slides.find((s) => s.id === lijstjeId).content.items.length === 3
    );
    const bi = b.pres.slides.find((s) => s.id === lijstjeId);
    bi.content.items = bi.content.items.filter((_, i) => i !== 0);
    b.binder.syncLocal();
    await waitFor(() => {
      const itemsA = a.pres.slides.find((s) => s.id === lijstjeId).content.items;
      return itemsA.length === 2 && itemsA[0].title === 'Twee' && itemsA[1].title === 'Drie';
    });
  });

  await t.test('reorder converges and slide content survives', async () => {
    const ids = a.pres.slides.map((s) => s.id);
    assert.ok(ids.length >= 2);
    // Move the last slide to the front (the slide-list drag mutation shape).
    const moved = a.pres.slides.pop();
    a.pres.slides.unshift(moved);
    a.binder.syncLocal();
    await waitFor(
      () => b.pres.slides[0]?.id === moved.id && b.pres.slides.length === ids.length
    );
    assert.deepEqual(
      b.pres.slides.map((s) => s.id),
      a.pres.slides.map((s) => s.id)
    );
    assert.equal(b.pres.slides[0].content.title, moved.content.title);
  });

  await t.test('deck title edits sync both ways', async () => {
    a.pres.title = 'Onze binder-deck';
    a.binder.syncLocal();
    await waitFor(() => b.pres.title === 'Onze binder-deck');
    const ev = b.remoteEvents.find((e) => e.titleChanged);
    assert.ok(ev, 'title change should be flagged for the topbar');
  });

  await t.test('undo reverts own edit only; redo restores it', async () => {
    await sleep(500); // close the previous undo capture group
    const before = a.pres.slides[0].content.title;
    a.pres.slides[0].content.title = 'Alice undo-test';
    a.binder.syncLocal();
    await sleep(500); // separate capture groups
    b.pres.slides[0].notes = 'Bob blijft staan';
    b.binder.syncLocal();
    await waitFor(
      () =>
        a.pres.slides[0].notes === 'Bob blijft staan' &&
        b.pres.slides[0].content.title === 'Alice undo-test'
    );

    assert.ok(a.binder.canUndo());
    assert.ok(a.binder.undo());
    await waitFor(
      () =>
        a.pres.slides[0].content.title === before &&
        b.pres.slides[0].content.title === before
    );
    // Bob's concurrent edit is untouched by Alice's undo.
    assert.equal(a.pres.slides[0].notes, 'Bob blijft staan');
    assert.equal(b.pres.slides[0].notes, 'Bob blijft staan');

    assert.ok(a.binder.canRedo());
    assert.ok(a.binder.redo());
    await waitFor(() => b.pres.slides[0].content.title === 'Alice undo-test');
  });

  await t.test('undo restores a deleted slide', async () => {
    await sleep(500);
    const countBefore = a.pres.slides.length;
    const removed = a.pres.slides[1];
    a.pres.slides = a.pres.slides.filter((s) => s.id !== removed.id);
    a.binder.syncLocal();
    await waitFor(() => b.pres.slides.length === countBefore - 1);

    assert.ok(a.binder.undo());
    await waitFor(
      () =>
        a.pres.slides.length === countBefore &&
        b.pres.slides.length === countBefore &&
        b.pres.slides.some((s) => s.id === removed.id)
    );
  });

  await t.test('adding a language version + projectLanguage', async () => {
    await sleep(500);
    a.pres.i18n = a.pres.i18n && typeof a.pres.i18n === 'object' ? a.pres.i18n : {};
    a.pres.i18n.active = 'nl';
    a.pres.i18n.dominant = 'nl';
    a.pres.i18n.versions = a.pres.i18n.versions || {};
    a.pres.i18n.versions.nl = { title: a.pres.title, slides: a.pres.slides };
    a.pres.i18n.versions['en-GB'] = { title: 'Our binder deck', slides: [] };
    a.binder.syncLocal();

    await waitFor(() => a.doc.getMap('meta').get('langs')?.includes?.('en-GB'));
    const projected = a.binder.projectLanguage('en-GB');
    assert.equal(projected.title, 'Our binder deck');
    assert.equal(projected.slides.length, a.pres.slides.length);
    // Same structure, untranslated texts project as empty strings.
    assert.deepEqual(
      projected.slides.map((s) => s.id),
      a.pres.slides.map((s) => s.id)
    );
    assert.equal(projected.slides[0].content.title, '');
    assert.equal(projected.i18n?.versions?.['en-GB']?.title, 'Our binder deck');

    // A per-language text lands in the right version: edit the en buffer.
    a.pres.i18n.active = 'en-GB';
    a.pres.title = projected.title;
    a.pres.slides = projected.slides;
    a.pres.i18n.versions = projected.i18n.versions;
    a.pres.i18n.versions['en-GB'].slides = a.pres.slides;
    a.binder.syncLocal(); // rebuilds the shadow for the new language
    a.pres.slides[0].content.title = 'English title';
    a.binder.syncLocal();

    await waitFor(() => {
      const proj = b.binder.projectLanguage('en-GB');
      return proj.slides[0]?.content?.title === 'English title';
    });
    // The Dutch buffer at B is untouched by the English edit.
    assert.notEqual(b.pres.slides[0].content.title, 'English title');
  });

  await t.test('the debounced store persists the converged deck JSON', async () => {
    const p = await waitFor(async () => {
      const cur = await getPresentation(repoRoot, stored.id);
      return cur?.title === 'Onze binder-deck' && cur?.i18n?.versions?.['en-GB'] ? cur : null;
    });
    assert.ok(p.slides.some((s) => s.id === lijstjeId));
    assert.equal(p.i18n.versions['en-GB'].slides[0]?.content?.title, 'English title');
  });
});
