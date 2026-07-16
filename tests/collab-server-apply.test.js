/**
 * Tests for the server-as-collaborator seam (phase 2, step 4):
 *
 * 1. Unit tests for the codec's `applyPresentationToDoc` differ — slides
 *    matched by id, fields by key, texts per language as Y.Text patches,
 *    items index-matched; divergence warnings; no-op on identical input.
 * 2. End-to-end over a real Hocuspocus mount: a server-side
 *    `updatePresentation` (MCP/API-style) reaches two live editor clients,
 *    concurrent client edits survive, client undo managers never track
 *    server writes, and the JSON/revision stays stable (no store loop).
 *
 * Run with: node --test tests/collab-server-apply.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Yserver from 'yjs';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { maybeAttachCollab, shutdownCollab } = await import('../server/collab/mount.js');
const { createPresentation, getPresentation, updatePresentation } = await import(
  '../server/storage/presentations.js'
);
const { getYDocState } = await import('../server/storage/presentations/ydoc-state.js');
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

// ── unit: the apply differ ──────────────────────────────────────────────────

const codec = createDeckYdocCodec(Yserver);

const bilingualPres = () => ({
  id: 'deck-1',
  title: 'NL titel',
  lang: 'nl',
  themeId: 'deckyard',
  revision: 3,
  slides: [
    {
      id: 's1',
      type: 'lijstje-slide',
      notes: 'nl notitie',
      content: {
        title: 'Lijstje NL',
        textSize: 'normal',
        items: [
          { title: 'Een', text: 'eerste' },
          { title: 'Twee', text: 'tweede' },
        ],
      },
    },
    { id: 's2', type: 'content-slide', notes: '', content: { title: 'Tekst NL', body: 'body nl' } },
  ],
  i18n: {
    active: 'nl',
    dominant: 'nl',
    versions: {
      nl: {
        title: 'NL titel',
        slides: [], // filled below
      },
      'en-GB': {
        title: 'EN title',
        slides: [
          {
            id: 's1',
            type: 'lijstje-slide',
            notes: 'en note',
            content: {
              title: 'List EN',
              textSize: 'normal',
              items: [
                { title: 'One', text: 'first' },
                { title: 'Two', text: 'second' },
              ],
            },
          },
          { id: 's2', type: 'content-slide', notes: '', content: { title: 'Text EN', body: 'body en' } },
        ],
      },
    },
  },
});

function makeBootstrappedDoc(pres) {
  const doc = new Yserver.Doc();
  const p = structuredClone(pres);
  p.i18n.versions.nl.slides = p.slides;
  codec.bootstrapPresentationToDoc(p, doc);
  return doc;
}

test('applyPresentationToDoc: identical input produces zero ops', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const projected = codec.projectDocToPresentation(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  const { warnings } = codec.applyPresentationToDoc(projected, doc);
  assert.equal(updates, 0, 'no doc updates for an identical deck');
  assert.deepEqual(warnings, []);
});

test('applyPresentationToDoc: multi-language text + item + plain diffs', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const next = codec.projectDocToPresentation(doc);

  // Text change in both languages of the same field.
  next.slides[0].content.title = 'Lijstje NL v2';
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides[0].content.title = 'List EN v2';
  // EN-only item text change (dominant projection identical for that item).
  next.i18n.versions['en-GB'].slides[0].content.items[1].text = 'second v2';
  // Plain field change (LWW).
  next.slides[0].content.textSize = 'large';
  next.i18n.versions['en-GB'].slides[0].content.textSize = 'large';
  // Item appended in both languages.
  next.slides[0].content.items.push({ title: 'Drie', text: 'derde' });
  next.i18n.versions['en-GB'].slides[0].content.items.push({ title: 'Three', text: 'third' });

  const { warnings } = codec.applyPresentationToDoc(next, doc);
  assert.deepEqual(warnings, []);

  const out = codec.projectDocToPresentation(doc);
  assert.equal(out.slides[0].content.title, 'Lijstje NL v2');
  assert.equal(out.i18n.versions['en-GB'].slides[0].content.title, 'List EN v2');
  assert.equal(out.i18n.versions['en-GB'].slides[0].content.items[1].text, 'second v2');
  assert.equal(out.slides[0].content.items[1].text, 'tweede', 'NL item text untouched');
  assert.equal(out.slides[0].content.textSize, 'large');
  assert.equal(out.slides[0].content.items[2].title, 'Drie');
  assert.equal(out.i18n.versions['en-GB'].slides[0].content.items[2].title, 'Three');
});

test('applyPresentationToDoc: structural changes (add/remove/reorder slides)', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const next = codec.projectDocToPresentation(doc);

  // Reorder (s2 first), drop nothing, append a new slide s3.
  const [s1, s2] = next.slides;
  const s3 = {
    id: 's3',
    type: 'content-slide',
    notes: '',
    content: { title: 'Nieuw NL', body: '' },
  };
  next.slides = [s2, s1, s3];
  next.i18n.versions.nl.slides = next.slides;
  const [e1, e2] = next.i18n.versions['en-GB'].slides;
  next.i18n.versions['en-GB'].slides = [
    e2,
    e1,
    { id: 's3', type: 'content-slide', notes: '', content: { title: 'New EN', body: '' } },
  ];

  codec.applyPresentationToDoc(next, doc);
  const out = codec.projectDocToPresentation(doc);
  assert.deepEqual(
    out.slides.map((s) => s.id),
    ['s2', 's1', 's3']
  );
  // The moved slide keeps every language's texts; the new one carries both.
  assert.equal(out.i18n.versions['en-GB'].slides[1].content.title, 'List EN');
  assert.equal(out.i18n.versions['en-GB'].slides[2].content.title, 'New EN');

  // Now remove s1.
  const next2 = codec.projectDocToPresentation(doc);
  next2.slides = next2.slides.filter((s) => s.id !== 's1');
  next2.i18n.versions.nl.slides = next2.slides;
  next2.i18n.versions['en-GB'].slides = next2.i18n.versions['en-GB'].slides.filter(
    (s) => s.id !== 's1'
  );
  codec.applyPresentationToDoc(next2, doc);
  assert.deepEqual(
    codec.projectDocToPresentation(doc).slides.map((s) => s.id),
    ['s2', 's3']
  );
});

test('applyPresentationToDoc: concurrent edits on other fields survive', () => {
  const docA = makeBootstrappedDoc(bilingualPres());
  const docB = new Yserver.Doc();
  Yserver.applyUpdate(docB, Yserver.encodeStateAsUpdate(docA));

  // Server payload based on A's current state: changes slide s2's body.
  const serverNext = codec.projectDocToPresentation(docA);
  serverNext.slides[1].content.body = 'body nl v2';
  serverNext.i18n.versions.nl.slides = serverNext.slides;

  // Meanwhile a client (replica B) types into s1's title.
  const ytitle = docB.getArray('slides').get(0).get('content').get('title').get('nl');
  ytitle.insert(ytitle.length, ' (client)');

  codec.applyPresentationToDoc(serverNext, docA);

  // Exchange updates both ways.
  Yserver.applyUpdate(docB, Yserver.encodeStateAsUpdate(docA));
  Yserver.applyUpdate(docA, Yserver.encodeStateAsUpdate(docB));

  for (const d of [docA, docB]) {
    const out = codec.projectDocToPresentation(d);
    assert.equal(out.slides[0].content.title, 'Lijstje NL (client)');
    assert.equal(out.slides[1].content.body, 'body nl v2');
  }
});

test('applyPresentationToDoc: warnings for divergence, drops and languages', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const next = codec.projectDocToPresentation(doc);

  // Diverging plain field between versions (dominant wins, with warning).
  next.slides[0].content.textSize = 'large';
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides[0].content.textSize = 'compact';
  // Slide that only exists in the non-dominant version (dropped, warned).
  next.i18n.versions['en-GB'].slides.push({
    id: 'ghost',
    type: 'content-slide',
    notes: '',
    content: { title: 'Ghost', body: '' },
  });

  const { warnings } = codec.applyPresentationToDoc(next, doc);
  assert.ok(
    warnings.some((w) => w.includes("plain field 'textSize' differs in version 'en-GB'")),
    `plain divergence warning, got: ${warnings.join(' | ')}`
  );
  assert.ok(
    warnings.some((w) => w.includes("slide ghost only exists in version 'en-GB'")),
    'peer-only slide warning'
  );
  assert.equal(codec.projectDocToPresentation(doc).slides[0].content.textSize, 'large');

  // Removing a language version drops it (loudly) and cleans its texts.
  const mono = codec.projectDocToPresentation(doc);
  delete mono.i18n.versions['en-GB'];
  const { warnings: w2 } = codec.applyPresentationToDoc(mono, doc);
  assert.ok(
    w2.some((w) => w.includes("language version 'en-GB' is not in the incoming deck")),
    'language removal warning'
  );
  const out = codec.projectDocToPresentation(doc);
  assert.deepEqual(Object.keys(out.i18n.versions), ['nl']);
  const ytitle = doc.getMap('meta').get('title');
  assert.equal(ytitle.get('en-GB'), undefined, 'removed language title cleaned up');
});

test('applyPresentationToDoc: never stores i18n.active; slide type change reclassifies', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const next = codec.projectDocToPresentation(doc);
  next.i18n.active = 'en-GB'; // per-client state; must not stick
  next.slides[1].type = 'lijstje-slide';
  next.slides[1].content = { title: 'Nu een lijstje', items: [{ title: 'A', text: 'a' }] };
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides[1] = {
    id: 's2',
    type: 'lijstje-slide',
    notes: '',
    content: { title: 'Now a list', items: [{ title: 'A(en)', text: 'a(en)' }] },
  };

  codec.applyPresentationToDoc(next, doc);
  const out = codec.projectDocToPresentation(doc);
  assert.equal(out.i18n.active, 'nl', 'projection emits active = dominant');
  assert.equal(out.slides[1].type, 'lijstje-slide');
  assert.equal(out.slides[1].content.items[0].title, 'A');
  assert.equal(out.i18n.versions['en-GB'].slides[1].content.items[0].title, 'A(en)');
});

test('applyPresentationToDoc with base: three-way diff spares concurrent doc state', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  // `base` = what the caller read (the stored JSON of that moment).
  const base = codec.projectDocToPresentation(doc);

  // Concurrent client edits land in the doc AFTER the caller's read: a text
  // edit, a new slide, a new tail item and a custom extra key.
  const yslides = doc.getArray('slides');
  const ytext = yslides.get(0).get('content').get('title').get('nl');
  ytext.insert(ytext.length, ' (client)');
  yslides.push([
    codec.buildSlideForLang(
      { id: 'client-slide', type: 'content-slide', notes: '', content: { title: 'Van client', body: '' } },
      'nl'
    ),
  ]);
  yslides.get(0).get('content').get('items').push([
    codec.buildItemForLang(
      { title: 'Client item', text: 'client' },
      codec.textSpecForType('lijstje-slide').items.get('items'),
      'nl'
    ),
  ]);
  const extraNow = { ...doc.getMap('meta').get('extra'), clientKey: 'client-value' };
  doc.getMap('meta').set('extra', extraNow);

  // The server write, based on the stale base: rename the deck, edit s2's
  // body, bump the revision. Structure untouched vs base.
  const next = structuredClone(base);
  next.title = 'Server titel';
  next.i18n.versions.nl.title = 'Server titel';
  next.slides[1].content.body = 'server body';
  next.i18n.versions.nl.slides = next.slides;
  next.revision = (next.revision || 0) + 1;

  const { warnings } = codec.applyPresentationToDoc(next, doc, { base });
  assert.deepEqual(warnings, []);

  const out = codec.projectDocToPresentation(doc);
  // The caller's changes landed…
  assert.equal(out.title, 'Server titel');
  assert.equal(out.slides.find((s) => s.id === 's2').content.body, 'server body');
  assert.equal(out.revision, next.revision);
  // …and every concurrent client change survived.
  assert.equal(out.slides[0].content.title, 'Lijstje NL (client)');
  assert.ok(out.slides.some((s) => s.id === 'client-slide'), 'client-added slide survives');
  assert.equal(out.slides[0].content.items.length, 3, 'client-added tail item survives');
  assert.equal(out.slides[0].content.items[2].title, 'Client item');
  assert.equal(out.clientKey, 'client-value', 'client-set extra key survives');
});

test('applyPresentationToDoc with base: deliberate removals still apply', () => {
  const doc = makeBootstrappedDoc(bilingualPres());
  const base = codec.projectDocToPresentation(doc);

  // The caller deliberately deletes slide s2 and drops an item.
  const next = structuredClone(base);
  next.slides = next.slides.filter((s) => s.id !== 's2');
  next.slides[0].content.items = next.slides[0].content.items.slice(0, 1);
  next.i18n.versions.nl.slides = next.slides;
  next.i18n.versions['en-GB'].slides = next.i18n.versions['en-GB'].slides
    .filter((s) => s.id !== 's2')
    .map((s) => ({ ...s, content: { ...s.content, items: (s.content.items || []).slice(0, 1) } }));

  codec.applyPresentationToDoc(next, doc, { base });
  const out = codec.projectDocToPresentation(doc);
  assert.deepEqual(out.slides.map((s) => s.id), ['s1']);
  assert.equal(out.slides[0].content.items.length, 1);
  assert.equal(out.i18n.versions['en-GB'].slides[0].content.items.length, 1);
});

// ── e2e: server write over a live mount ────────────────────────────────────

test('server-as-collaborator: facade writes reach live editors', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'deckyard-server-apply-'));
  const stored = await createPresentation(repoRoot, {
    title: 'Server apply deck',
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
  let serverRevision = null;

  await t.test('an MCP-style server write appears live in both editors', async () => {
    // Alice makes an (undoable) local edit first, and it reaches the stored
    // JSON (debounced ~2s) before the server write below reads its base.
    a.pres.slides[0].notes = 'Notitie van Alice';
    a.binder.syncLocal();
    await waitFor(() => b.pres.slides[0].notes === 'Notitie van Alice');
    assert.ok(a.binder.canUndo(), 'Alice has an undoable local edit');
    await waitFor(
      async () => (await getPresentation(repoRoot, stored.id))?.slides?.[0]?.notes === 'Notitie van Alice',
      { timeout: 12000 }
    );

    // Server-side mutation through the facade (the MCP/public-API shape).
    const body = structuredClone(await getPresentation(repoRoot, stored.id));
    body.title = 'Door de server hernoemd';
    const bs = body.slides.find((s) => s.id === firstId);
    bs.content.title = 'Server titel';
    body.slides.push({
      id: crypto.randomUUID(),
      type: 'content-slide',
      notes: '',
      content: { title: 'Server slide', body: 'toegevoegd via API' },
    });
    const result = await updatePresentation(repoRoot, stored.id, body, {
      actorEmail: 'agent@example.com',
    });
    assert.ok(result && result.ok !== false, 'facade accepted the write');
    serverRevision = result.revision;

    // Both live editors converge without any reload.
    await waitFor(
      () =>
        a.pres.title === 'Door de server hernoemd' &&
        b.pres.title === 'Door de server hernoemd' &&
        a.pres.slides.find((s) => s.id === firstId)?.content?.title === 'Server titel' &&
        b.pres.slides.find((s) => s.id === firstId)?.content?.title === 'Server titel' &&
        a.pres.slides.some((s) => s.content?.title === 'Server slide') &&
        b.pres.slides.some((s) => s.content?.title === 'Server slide')
    );
    // Alice's concurrent local edit (a field the server didn't touch) survives.
    assert.equal(a.pres.slides[0].notes, 'Notitie van Alice');
    assert.equal(b.pres.slides[0].notes, 'Notitie van Alice');
  });

  await t.test('client undo managers never track server writes', async () => {
    // The server write is not undoable; Alice's own edit still is.
    assert.ok(a.binder.canUndo(), 'undo stack unchanged by the server write');
    assert.ok(a.binder.undo());
    await waitFor(() => b.pres.slides.find((s) => s.id === firstId)?.notes === '');
    // Undo reverted only Alice's note — the server's edits stand.
    assert.equal(a.pres.title, 'Door de server hernoemd');
    assert.equal(a.pres.slides.find((s) => s.id === firstId)?.content?.title, 'Server titel');
    assert.ok(a.binder.redo());
    await waitFor(() => b.pres.slides.find((s) => s.id === firstId)?.notes === 'Notitie van Alice');
  });

  await t.test('no store loop: JSON revision stays put, binary kept', async () => {
    // The apply flush stores the binary; the JSON re-store is skipped
    // because the projection equals the just-stored deck. Give any stray
    // debounced store (2s) time to fire before asserting.
    await sleep(3000);
    const p = await getPresentation(repoRoot, stored.id);
    assert.equal(p.revision, serverRevision, 'no extra revision bumps after the server write');
    assert.equal(p.title, 'Door de server hernoemd');
    const bin = await getYDocState(repoRoot, stored.id);
    assert.ok(bin instanceof Uint8Array && bin.length > 0, 'binary not invalidated (doc is live)');
  });

  await t.test('an in-flight client edit survives a same-moment server write', async () => {
    // Bob edits a field; the edit lives only in the doc (not yet stored).
    // The server write is based on the stored JSON, which predates it —
    // the three-way diff must leave Bob's field alone.
    const body = structuredClone(await getPresentation(repoRoot, stored.id));
    const bSlide = b.pres.slides.find((s) => s.content?.title === 'Server slide');
    bSlide.content.body = 'Bob typt hier tegelijk';
    b.binder.syncLocal();

    const target = body.slides.find((s) => s.id === firstId);
    target.content.title = 'Server titel v2';
    const result = await updatePresentation(repoRoot, stored.id, body, {
      actorEmail: 'agent@example.com',
    });
    assert.ok(result && result.ok !== false);

    await waitFor(
      () =>
        a.pres.slides.find((s) => s.id === firstId)?.content?.title === 'Server titel v2' &&
        a.pres.slides.find((s) => s.id === bSlide.id)?.content?.body === 'Bob typt hier tegelijk' &&
        b.pres.slides.find((s) => s.id === firstId)?.content?.title === 'Server titel v2' &&
        b.pres.slides.find((s) => s.id === bSlide.id)?.content?.body === 'Bob typt hier tegelijk'
    );
    // Both eventually reach the stored JSON too (Bob's via the debounce).
    await waitFor(async () => {
      const p = await getPresentation(repoRoot, stored.id);
      return (
        p.slides.find((s) => s.id === firstId)?.content?.title === 'Server titel v2' &&
        p.slides.find((s) => s.id === bSlide.id)?.content?.body === 'Bob typt hier tegelijk'
      );
    }, { timeout: 12000 });
  });

  await t.test('a theme-change-style write reaches the doc', async () => {
    const body = structuredClone(await getPresentation(repoRoot, stored.id));
    body.themeId = 'terminal';
    const result = await updatePresentation(repoRoot, stored.id, body, {
      actorEmail: 'anonymous',
    });
    assert.ok(result && result.ok !== false);
    await waitFor(() => a.pres.themeId === 'terminal' && b.pres.themeId === 'terminal');
    const ev = b.remoteEvents.find((e) => e.metaChanged);
    assert.ok(ev, 'meta change reported for re-render (preview repaint)');
  });

  await t.test('a translate-style write fills another language live', async () => {
    // Bob creates the EN version client-side (same flow as the binder test).
    b.pres.i18n = { active: 'nl', dominant: 'nl', versions: {} };
    b.pres.i18n.versions.nl = { title: b.pres.title, slides: b.pres.slides };
    b.pres.i18n.versions['en-GB'] = { title: 'Renamed by the server', slides: [] };
    b.binder.syncLocal();
    // Wait for the debounced store so the server JSON knows the language.
    await waitFor(
      async () => (await getPresentation(repoRoot, stored.id))?.i18n?.versions?.['en-GB'],
      { timeout: 12000 }
    );

    // Server-side translate: fill the EN texts (the translate endpoints'
    // write shape) — no client-side bridge involved anymore.
    const body = structuredClone(await getPresentation(repoRoot, stored.id));
    const en = body.i18n.versions['en-GB'];
    en.slides = structuredClone(body.slides).map((s) => {
      const copy = s;
      if (typeof copy?.content?.title === 'string') {
        copy.content.title = `EN ${copy.content.title}`;
      }
      return copy;
    });
    const nlTitle = body.slides.find((s) => s.id === firstId).content.title;
    const result = await updatePresentation(repoRoot, stored.id, body, {
      actorEmail: 'anonymous',
    });
    assert.ok(result && result.ok !== false);

    await waitFor(() => {
      const proj = a.binder.projectLanguage('en-GB');
      return proj?.slides?.find((s) => s.id === firstId)?.content?.title === `EN ${nlTitle}`;
    });
    // The Dutch buffers are untouched by the EN fill.
    assert.equal(a.pres.slides.find((s) => s.id === firstId)?.content?.title, nlTitle);
  });
});
