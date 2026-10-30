/**
 * A deck title is per language, also live (B893).
 *
 * The SL-20 proof on slides.ciiic.nl saw one open tab keep the old deck
 * title after an API rename while another tab, on another language, showed
 * the new one. The cause is not a stale live doc: a title-only server write
 * (`{ title }`, the public API's rename) renames the dominant language
 * version (`withDominantVersion` in the storage facade), live-apply carries
 * that into the open doc, and each editor shows the title of its own active
 * language. This pins that behaviour over a real Hocuspocus mount with two
 * binders on different languages: the dominant-language editor follows the
 * rename live, the other keeps its own translated title and only its buffer
 * of the dominant version changes.
 *
 * Run with: node --test tests/collab-remote-title-per-language.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testScope } from './helpers/storage-scope.js';
import { waitFor } from './helpers/collab-socket.js';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { maybeAttachCollab, shutdownCollab } =
  await import('../server/collab/mount.js');
const { createPresentation, getPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { createPresenceSession } =
  await import('../client/views/editor/live-edits/presence-session.js');
const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');

const db = createFakeDb({
  organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
});
__setTestDb(db);
await initializeStorage();

after(() => {
  __setTestDb(null);
});

/** Columns an INSERT never names; see tests/collab-server-apply.test.js. */
function fillNullColumns() {
  for (const row of db.__tables.presentations || []) {
    row.published ??= null;
    row.trashed_at ??= null;
    row.trashed_by ??= null;
  }
}

test('a title-only server write renames the dominant language live, not the other', async (t) => {
  const created = await createPresentation(testScope(), {
    title: 'Kopie van testje',
    ownerEmail: 'anonymous',
    lang: 'nl',
  });
  fillNullColumns();
  const base = await getPresentation(testScope(), created.id);
  const bilingual = await updatePresentation(
    testScope(),
    created.id,
    {
      // The editor's shape: the active version in the top-level fields. A
      // bare `i18n` body rebuilds that version from absent fields (B895).
      title: 'Kopie van testje',
      slides: base.slides,
      i18n: {
        active: 'nl',
        dominant: 'nl',
        versions: {
          nl: { title: 'Kopie van testje', slides: base.slides },
          'en-GB': {
            title: 'Copy of testje',
            slides: structuredClone(base.slides),
          },
        },
      },
    },
    { actorEmail: 'setup@example.com' },
  );
  assert.ok(bilingual && bilingual.ok !== false, 'second language stored');
  assert.equal(bilingual.i18n.dominant, 'nl');

  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, {
    repoRoot: process.cwd(),
  });
  assert.ok(hocuspocus, 'collab should mount');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/collab`;

  /** An editor open on `lang`, the way the editor projects its version. */
  async function openEditor(email, lang) {
    const session = createPresenceSession({
      presentationId: created.id,
      user: { email, name: email.split('@')[0] },
      url,
    });
    const doc = session._provider.document;
    const pres = structuredClone(
      await getPresentation(testScope(), created.id),
    );
    pres.i18n.active = lang;
    pres.title = pres.i18n.versions[lang].title;
    pres.slides = pres.i18n.versions[lang].slides;
    const remoteEvents = [];
    const binder = createLiveDocBinder({
      Y,
      doc,
      codec: createDeckYdocCodec(Y),
      pres,
      getActiveLang: () => pres.i18n.active,
      onRemoteApplied: (ev) => remoteEvents.push(ev),
    });
    await waitFor(() => doc.getMap('meta').get('extra'));
    binder.attach();
    return { session, pres, binder, remoteEvents };
  }

  const en = await openEditor('alice@example.com', 'en-GB');
  const nl = await openEditor('bob@example.com', 'nl');
  t.after(async () => {
    en.binder.detach();
    nl.binder.detach();
    en.session.detach();
    nl.session.detach();
    await shutdownCollab();
    await new Promise((resolve) => server.close(resolve));
  });
  assert.equal(en.pres.title, 'Copy of testje');
  assert.equal(nl.pres.title, 'Kopie van testje');

  // The public API's rename: a body with a title and nothing else.
  const renamed = await updatePresentation(
    testScope(),
    created.id,
    { title: 'SL-20 live-proef (synthetisch)' },
    { actorEmail: 'agent@example.com' },
  );
  assert.ok(renamed && renamed.ok !== false, 'facade accepted the rename');
  assert.equal(
    renamed.i18n.versions.nl.title,
    'SL-20 live-proef (synthetisch)',
  );
  assert.equal(renamed.i18n.versions['en-GB'].title, 'Copy of testje');

  // The dominant-language editor follows live and is told to repaint.
  await waitFor(() => nl.pres.title === 'SL-20 live-proef (synthetisch)');
  assert.ok(
    nl.remoteEvents.some((ev) => ev.titleChanged),
    'the nl editor gets titleChanged, so the topbar repaints',
  );

  // The other editor keeps its own title; only its nl buffer moves.
  await waitFor(
    () => en.pres.i18n.versions.nl.title === 'SL-20 live-proef (synthetisch)',
  );
  assert.equal(en.pres.title, 'Copy of testje');
  assert.ok(
    !en.remoteEvents.some((ev) => ev.titleChanged),
    'the en-GB editor shows no title change',
  );
});
