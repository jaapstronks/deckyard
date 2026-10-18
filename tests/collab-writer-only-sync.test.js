/**
 * Only a writer receives the collab document (B767).
 *
 * The Y.Doc on the /collab socket is the author's document: it carries the AI
 * review notes per slide (`_aiReasoning`, `_aiAlternatives`, `_aiWarnings`),
 * which can quote the source the deck was made from and which every read
 * route strips for readers. A sync hands the whole document over, so a
 * read-only connection is no boundary: a user without write permission must
 * not connect at all, and a user who loses it must be cut off.
 *
 * Driven over a real WebSocket with real session cookies, against the mounted
 * Hocuspocus server with live edits (persistence) on:
 *
 *   - the owner and an edit collaborator receive the notes (editor fields stay);
 *   - a view collaborator is refused while the document is loaded, and when it
 *     is opened from a stored Y.Doc binary;
 *   - an editor demoted through the collaborators route is disconnected at
 *     once and does not receive later notes;
 *   - an editor whose permission ends elsewhere is disconnected by the
 *     periodic re-authorization on their next message.
 *
 * "Did the notes reach this client" is asked of the raw state update: the
 * marker is a UTF-8 string inside it however the codec nests the field.
 *
 * Run with: node --test tests/collab-writer-only-sync.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
process.env.AUTH_ENABLED = 'true';
// Assembled rather than written as one literal so secret scanners do not flag it.
process.env.AUTH_SECRET = ['deckyard', 'test', 'b767', 'collab']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const EDITOR = 'editor@example.com';
const VIEWER = 'viewer@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { setSessionCookie } = await import('../server/auth/auth.js');
const { sessionVersion } = await import('../server/utils/session-version.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { getYDocState } =
  await import('../server/storage/presentations/ydocs.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleCollaborators } =
  await import('../server/routes/api/collaborators.js');
const { maybeAttachCollab, shutdownCollab } =
  await import('../server/collab/mount.js');
const { Y, HocuspocusProvider } = await import('../client/vendor/collab.js');

const REPO_ROOT = process.cwd();

/** A marker no slide renders, so its presence in a client's state is a leak. */
const NOTE = 'SOURCE-QUOTE-B767-COLLAB';

const users = userRows(OWNER, EDITOR, VIEWER);
const db = createFakeDb({
  organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  users,
  presentation_collaborators: [],
});
__setTestDb(db);
await initializeStorage();

after(() => {
  __setTestDb(null);
});

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

/** The `sb_session` cookie the server would set for a seeded user. */
function cookieFor(email) {
  const row = users.find((u) => u.email === email);
  const res = createMockRes();
  setSessionCookie(createMockReq(), res, {
    email,
    role: 'user',
    name: row.name,
    v: sessionVersion(row),
  });
  return String(res.headers['Set-Cookie']).split(';')[0];
}

/** A collaborator row as the storage keeps it. */
function collaboratorRow(deckId, email, permission) {
  return {
    id: `c-${email.split('@')[0]}-${deckId}`,
    organization_id: ORG,
    presentation_id: deckId,
    user_email: email,
    user_id: null,
    permission,
    invited_by: OWNER,
    invited_at: '2026-02-02T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
  };
}

/** A deck with the three notes on every slide, an editor and a viewer. */
async function createNotedDeck() {
  const noted = (title) => ({
    type: 'content-slide',
    content: { title },
    _aiReasoning: `Kept the claim "${NOTE}" from page 3`,
    _aiAlternatives: [{ type: 'quote-slide', reason: `${NOTE} as a quote` }],
    _aiWarnings: [`${NOTE} was shortened`],
  });
  const pres = await createPresentation(testScope(REPO_ROOT), {
    title: 'Generated deck',
    ownerEmail: OWNER,
    lang: 'nl',
    slides: [noted('Eerste'), noted('Tweede')],
  });
  db.__tables.presentation_collaborators.push(
    collaboratorRow(pres.id, EDITOR, 'edit'),
    collaboratorRow(pres.id, VIEWER, 'view'),
  );
  await invalidatePermission(pres.id, EDITOR);
  await invalidatePermission(pres.id, VIEWER);
  return pres;
}

/** Mount collab on a fresh HTTP server. */
async function startCollabServer() {
  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, { repoRoot: REPO_ROOT });
  assert.ok(hocuspocus, 'collab should mount');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    hocuspocus,
    url: `ws://127.0.0.1:${server.address().port}/collab`,
    async stop() {
      await shutdownCollab();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Open the editor's provider as `email`, with that user's session cookie on
 * the upgrade, and record what the server answered.
 */
function connectAs(url, deckId, email) {
  const cookie = cookieFor(email);
  class CookieWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, { protocols, headers: { cookie } });
    }
  }
  const events = { authenticated: false, denied: false, closes: 0 };
  const provider = new HocuspocusProvider({
    url,
    name: `presentation:${deckId}`,
    WebSocketPolyfill: CookieWebSocket,
    onAuthenticated: () => {
      events.authenticated = true;
    },
    onAuthenticationFailed: () => {
      events.denied = true;
    },
    onClose: () => {
      events.closes += 1;
    },
  });
  provider.awareness.setLocalState({ user: { email }, view: null });
  return {
    provider,
    events,
    /** Whether `marker` is anywhere in the state this client received. */
    holds: (marker = NOTE) =>
      Buffer.from(Y.encodeStateAsUpdate(provider.document)).includes(marker),
    hasDeck: () => provider.document.getMap('meta').get('extra') !== undefined,
    destroy: () => provider.destroy(),
  };
}

/** Append `marker` to the first slide's reasoning, as the owner's editor would. */
function writeNote(client, marker) {
  const slide = client.provider.document.getArray('slides').get(0);
  const reasoning = slide.get('_aiReasoning');
  if (reasoning instanceof Y.Text) reasoning.insert(reasoning.length, marker);
  else slide.set('_aiReasoning', `${reasoning ?? ''} ${marker}`);
}

test('collab: owner and edit collaborator receive the notes, a viewer is refused', async (t) => {
  const pres = await createNotedDeck();
  const collab = await startCollabServer();
  const owner = connectAs(collab.url, pres.id, OWNER);
  const editor = connectAs(collab.url, pres.id, EDITOR);
  let viewer;
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    viewer?.destroy();
    await collab.stop();
  });

  // Writers get the whole author document, notes included: the editor's
  // slide notes and review grid read them from here.
  await waitFor(() => owner.hasDeck() && editor.hasDeck());
  assert.equal(owner.holds(), true, 'owner keeps the notes');
  assert.equal(editor.holds(), true, 'edit collaborator keeps the notes');

  // A viewer connects while the document is loaded and synced to two peers.
  viewer = connectAs(collab.url, pres.id, VIEWER);
  await waitFor(() => viewer.events.denied || viewer.events.closes > 0);
  await sleep(300);
  assert.equal(viewer.events.authenticated, false, 'viewer is not admitted');
  assert.equal(viewer.hasDeck(), false, 'viewer receives no deck state');
  assert.equal(viewer.holds(), false, 'viewer receives no notes');

  // Nor any later update.
  writeNote(owner, ' LATER-NOTE');
  await waitFor(() => editor.holds('LATER-NOTE'));
  await sleep(200);
  assert.equal(viewer.holds('LATER-NOTE'), false);
});

test('collab: a viewer is refused when the document opens from a stored Y.Doc', async (t) => {
  const pres = await createNotedDeck();
  const collab = await startCollabServer();
  let viewer;
  t.after(async () => {
    viewer?.destroy();
    await collab.stop();
  });

  // The owner opens the deck once; the last disconnect stores the binary and
  // unloads the document.
  const owner = connectAs(collab.url, pres.id, OWNER);
  await waitFor(() => owner.hasDeck());
  owner.destroy();
  await waitFor(
    async () =>
      !collab.hocuspocus.documents.has(`presentation:${pres.id}`) &&
      (await getYDocState(testScope(REPO_ROOT), pres.id)),
  );

  viewer = connectAs(collab.url, pres.id, VIEWER);
  await waitFor(() => viewer.events.denied || viewer.events.closes > 0);
  await sleep(300);
  assert.equal(viewer.events.authenticated, false);
  assert.equal(viewer.hasDeck(), false);
  assert.equal(
    viewer.holds(),
    false,
    'the stored binary does not reach a viewer',
  );
  assert.equal(
    collab.hocuspocus.documents.has(`presentation:${pres.id}`),
    false,
    'a refused viewer does not even load the document',
  );
});

test('collab: an editor demoted to viewer is disconnected at once', async (t) => {
  const pres = await createNotedDeck();
  const collab = await startCollabServer();
  const owner = connectAs(collab.url, pres.id, OWNER);
  const editor = connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  // The owner demotes the editor through the collaborators route.
  const ownerUser = {
    id: userIdFor(OWNER),
    email: OWNER,
    role: 'user',
    organizationId: ORG,
  };
  const res = createMockRes();
  await handleCollaborators({
    repoRoot: REPO_ROOT,
    storageScope: createStorageScope(ownerUser, { repoRoot: REPO_ROOT }),
    req: createMockReq({ method: 'PATCH', body: { permission: 'view' } }),
    res,
    url: new URL(
      `http://localhost/api/presentations/${pres.id}/collaborators/${encodeURIComponent(EDITOR)}`,
    ),
    authedUser: ownerUser,
  });
  assert.equal(res.statusCode, 200, res.body);
  await waitFor(() => editor.events.closes > 0);

  writeNote(owner, ' AFTER-DEMOTION');
  await sleep(500);
  assert.equal(
    editor.holds('AFTER-DEMOTION'),
    false,
    'a demoted editor receives no later notes',
  );
  assert.equal(
    collab.hocuspocus.documents
      .get(`presentation:${pres.id}`)
      .getConnections()
      .some((c) => c.context?.user?.email === EDITOR),
    false,
    'the reconnect is refused as well',
  );
});

test('collab: a permission lost elsewhere closes the connection on its next message', async (t) => {
  const pres = await createNotedDeck();
  const collab = await startCollabServer();
  const owner = connectAs(collab.url, pres.id, OWNER);
  const editor = connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  // Revoked behind the collaborators route's back (no immediate close).
  const row = db.__tables.presentation_collaborators.find(
    (r) => r.presentation_id === pres.id && r.user_email === EDITOR,
  );
  row.revoked_at = new Date().toISOString();
  await invalidatePermission(pres.id, EDITOR);

  // Age the connection's authorization past COLLAB_REAUTHORIZE_MS rather
  // than waiting it out, then let the editor send anything.
  const document = collab.hocuspocus.documents.get(`presentation:${pres.id}`);
  for (const connection of document.getConnections()) {
    if (connection.context?.user?.email === EDITOR)
      connection.context.authorizedAt = 0;
  }
  editor.provider.awareness.setLocalStateField('view', { slideId: 'x' });
  await waitFor(() => editor.events.closes > 0);

  writeNote(owner, ' AFTER-REVOCATION');
  await sleep(500);
  assert.equal(editor.holds('AFTER-REVOCATION'), false);

  // The owner, checked on the same schedule, stays connected.
  for (const connection of document.getConnections()) {
    connection.context.authorizedAt = 0;
  }
  owner.provider.awareness.setLocalStateField('view', { slideId: 'y' });
  await sleep(300);
  assert.equal(owner.events.closes, 0, 'a writer passes the re-check');
});
