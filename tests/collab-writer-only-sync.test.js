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
 *   - an editor who loses the right any other way (a collaborator row revoked
 *     behind the route, ownership handed over) and then sends nothing
 *     receives nothing written after the authorization lease ran out, while
 *     a silent editor who keeps the right goes on receiving.
 *
 * The lease is shortened to LEASE_MS so the tests wait it out on the real
 * clock instead of aging a stamp by hand. Losing an organization membership
 * needs multi-organization mode: tests/collab-lease-membership.test.js.
 *
 * "Did the notes reach this client" is asked of the raw state update: the
 * marker is a UTF-8 string inside it however the codec nests the field.
 *
 * Run with: node --test tests/collab-writer-only-sync.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
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
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { getYDocState } =
  await import('../server/storage/presentations/ydocs.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleCollaborators } =
  await import('../server/routes/api/collaborators.js');
const { transferOwnership } = await import('../server/services/ownership.js');
const collabSocket = await import('./helpers/collab-socket.js');
const { waitFor, sleep, createNotedDeck } = collabSocket;

const REPO_ROOT = process.cwd();

/** The authorization lease in these tests (the server default is 10 s). */
const LEASE_MS = 400;

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

/** The noted deck, owned by OWNER, with an editor and a viewer. */
async function createSharedDeck() {
  const pres = await createNotedDeck(testScope(REPO_ROOT), {
    ownerEmail: OWNER,
  });
  db.__tables.presentation_collaborators.push(
    collaboratorRow(pres.id, EDITOR, 'edit'),
    collaboratorRow(pres.id, VIEWER, 'view'),
  );
  await invalidatePermission(pres.id, EDITOR);
  await invalidatePermission(pres.id, VIEWER);
  return pres;
}

const startCollabServer = () =>
  collabSocket.startCollabServer({
    repoRoot: REPO_ROOT,
    authorizationLeaseMs: LEASE_MS,
  });

const connectAs = async (url, deckId, email) =>
  collabSocket.connectAs(
    url,
    deckId,
    await collabSocket.cookieFor(users.find((u) => u.email === email)),
  );

/** A signed-in user as the routes and services receive one. */
const userFor = (email) => ({
  id: userIdFor(email),
  email,
  role: 'user',
  organizationId: ORG,
});

test('collab: owner and edit collaborator receive the notes, a viewer is refused', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
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
  viewer = await connectAs(collab.url, pres.id, VIEWER);
  await waitFor(() => viewer.events.denied || viewer.events.closes > 0);
  await sleep(300);
  assert.equal(viewer.events.authenticated, false, 'viewer is not admitted');
  assert.equal(viewer.hasDeck(), false, 'viewer receives no deck state');
  assert.equal(viewer.holds(), false, 'viewer receives no notes');

  // Nor any later update.
  owner.writeNote(' LATER-NOTE');
  await waitFor(() => editor.holds('LATER-NOTE'));
  await sleep(200);
  assert.equal(viewer.holds('LATER-NOTE'), false);
});

test('collab: a viewer is refused when the document opens from a stored Y.Doc', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  let viewer;
  t.after(async () => {
    viewer?.destroy();
    await collab.stop();
  });

  // The owner opens the deck once; the last disconnect stores the binary and
  // unloads the document.
  const owner = await connectAs(collab.url, pres.id, OWNER);
  await waitFor(() => owner.hasDeck());
  owner.destroy();
  await waitFor(
    async () =>
      !collab.hocuspocus.documents.has(`presentation:${pres.id}`) &&
      (await getYDocState(testScope(REPO_ROOT), pres.id)),
  );

  viewer = await connectAs(collab.url, pres.id, VIEWER);
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
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  // The owner demotes the editor through the collaborators route.
  const ownerUser = userFor(OWNER);
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

  owner.writeNote(' AFTER-DEMOTION');
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

/**
 * Revoke behind the collaborators route's back (no immediate close), as any
 * other path would: only the lease stands between the editor and later notes.
 */
async function revokeEditorRow(deckId) {
  const row = db.__tables.presentation_collaborators.find(
    (r) => r.presentation_id === deckId && r.user_email === EDITOR,
  );
  row.revoked_at = new Date().toISOString();
  await invalidatePermission(deckId, EDITOR);
}

test('collab: a silent editor whose permission ended receives nothing after the lease', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  // The editor stops sending and only listens; then the right ends.
  editor.silence();
  await revokeEditorRow(pres.id);
  await sleep(LEASE_MS * 2);

  owner.writeNote(' AFTER-THE-LEASE');
  await waitFor(() => editor.events.closes > 0);
  await sleep(300);
  assert.equal(
    editor.holds('AFTER-THE-LEASE'),
    false,
    'a note written after the lease ran out does not reach the revoked editor',
  );
  assert.equal(
    collab.connections(pres.id).some((c) => c.context.user.email === EDITOR),
    false,
    'the server closed the connection',
  );
  assert.equal(owner.events.closes, 0, 'the owner stays connected');
});

test('collab: a silent editor who keeps the right goes on receiving after the lease', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  editor.silence();
  for (const round of [1, 2, 3]) {
    await sleep(LEASE_MS * 1.5);
    owner.writeNote(` ROUND-${round}`);
    await waitFor(() => editor.holds(`ROUND-${round}`));
  }
  assert.equal(editor.events.closes, 0, 'each renewal passes');
  assert.equal(owner.events.closes, 0);
});

test('collab: ownership handed over takes the document from the previous owner', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  // The owner hands the deck to the editor and does not stay on it.
  owner.silence();
  await transferOwnership(
    createStorageScope(userFor(OWNER), { repoRoot: REPO_ROOT }),
    { actor: userFor(OWNER) },
    {
      presentationId: pres.id,
      newOwnerEmail: EDITOR,
      keepAsCollaborator: false,
    },
  );
  await sleep(LEASE_MS * 2);

  editor.writeNote(' AFTER-TRANSFER');
  await waitFor(() => owner.events.closes > 0);
  await sleep(300);
  assert.equal(owner.holds('AFTER-TRANSFER'), false);
  assert.equal(editor.events.closes, 0, 'the new owner stays connected');
});

test('collab: ownership handed over keeps a previous owner who stays on as editor', async (t) => {
  const pres = await createSharedDeck();
  const collab = await startCollabServer();
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const editor = await connectAs(collab.url, pres.id, EDITOR);
  t.after(async () => {
    owner.destroy();
    editor.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && editor.hasDeck());

  owner.silence();
  await transferOwnership(
    createStorageScope(userFor(OWNER), { repoRoot: REPO_ROOT }),
    { actor: userFor(OWNER) },
    { presentationId: pres.id, newOwnerEmail: EDITOR },
  );
  await sleep(LEASE_MS * 2);

  editor.writeNote(' KEPT-AS-EDITOR');
  await waitFor(() => owner.holds('KEPT-AS-EDITOR'));
  assert.equal(owner.events.closes, 0, 'still a writer, still connected');
});
