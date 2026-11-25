/**
 * Removing a language version with a second collab peer open (DY-874).
 *
 * The removal is a server write (`removeLanguageVersion`); live-apply carries
 * it into the open doc, where `applyPresentationToDoc` drops the language. The
 * editors on the other end must drop their buffer of that version too: the
 * binder's local sync into the doc adds every language `pres` carries, so a
 * stale buffer would bring the removed version back on the next edit.
 *
 * Run with: node --test tests/collab-remove-language-version.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testScope } from './helpers/storage-scope.js';
import { waitFor } from './helpers/collab-socket.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

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
const { removeLanguageVersion } =
  await import('../server/services/language-versions.js');
const { createPresenceSession } =
  await import('../client/views/editor/live-edits/presence-session.js');
const { Y } = await import('../client/vendor/collab.js');
const { createDeckYdocCodec } = await import('../shared/collab/deck-ydoc.js');
const { createLiveDocBinder } =
  await import('../client/views/editor/live-edits/live-doc-binder.js');

const db = createFakeDb({
  organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  users: userRows('owner@example.com'),
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

test('a removed version leaves both open editors, and a later edit does not bring it back', async (t) => {
  const created = await createPresentation(testScope(), {
    title: 'Kopie van testje',
    ownerEmail: 'owner@example.com',
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

  const nlBefore = JSON.stringify(
    (await getPresentation(testScope(), created.id)).i18n.versions.nl,
  );

  // The editor's action: the version goes through the server, which applies
  // the write to the live doc (the server-as-collaborator seam).
  await removeLanguageVersion(
    testScope(),
    { actor: sessionFor('owner@example.com', { isAdmin: false }) },
    { presentationId: created.id, lang: 'en-GB' },
  );

  // Both editors lose the version's buffer, whichever language they are in.
  await waitFor(() => !nl.pres.i18n.versions['en-GB']);
  await waitFor(() => !en.pres.i18n.versions['en-GB']);
  assert.deepEqual(Object.keys(nl.pres.i18n.versions), ['nl']);

  // A later edit in the source does not add the version back (the local
  // sync into the doc is additive for languages).
  nl.pres.slides[0].content.title = 'Na het verwijderen';
  nl.binder.syncLocal();
  await new Promise((r) => setTimeout(r, 50));
  const docLangs = createDeckYdocCodec(Y).getDocLangs(
    nl.session._provider.document,
  );
  assert.deepEqual(docLangs, ['nl']);

  const stored = await getPresentation(testScope(), created.id);
  assert.deepEqual(Object.keys(stored.i18n.versions), ['nl']);
  const storedNl = JSON.parse(nlBefore);
  assert.equal(
    stored.i18n.versions.nl.title,
    storedNl.title,
    'the remaining version keeps its texts',
  );
});
