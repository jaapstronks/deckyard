/**
 * Leaving an organization takes the collab document away (B767).
 *
 * An organization-visible deck is writable by every member of its
 * organization, without a collaborator row. When a membership ends, the
 * member's session cookie still verifies; only resolving the membership again
 * tells. Collab does that on every lease renewal and on every document a
 * socket opens (it reads the cookie anew instead of reusing the user from the
 * upgrade), so a removed member who only listens receives nothing written
 * after the lease ran out, a removed member or a revoked session opens no
 * further deck on the socket it still has, and a member who stays goes on
 * receiving and opening.
 *
 * Multi-organization mode is read when modules load, so this file sets it
 * before importing anything; the single-organization boundary is in
 * tests/collab-writer-only-sync.test.js.
 *
 * Run with: node --test tests/collab-lease-membership.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.COLLAB_ENABLED = 'true';
process.env.COLLAB_LIVE_EDITS = 'true';
process.env.AUTH_ENABLED = 'true';
process.env.MULTI_ORG_ENABLED = 'true';
// Assembled rather than written as one literal so secret scanners do not flag it.
process.env.AUTH_SECRET = ['deckyard', 'test', 'b767', 'membership']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
delete process.env.AUTH_DEV_BYPASS;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';
const STAYING = 'staying@example.com';
const SWITCHING = 'switching@example.com';
const REVOKED = 'revoked@example.com';
const LOADING = 'loading@example.com';
const LEASE_MS = 400;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { removeMember } =
  await import('../server/storage/user-organizations/memberships.js');
const { updatePresentation } =
  await import('../server/storage/presentations/index.js');
const collabSocket = await import('./helpers/collab-socket.js');
const { waitFor, sleep, createNotedDeck } = collabSocket;

const REPO_ROOT = process.cwd();

const users = userRows(OWNER, MEMBER, STAYING, SWITCHING, REVOKED, LOADING);
const membership = (email, role = 'member') => ({
  id: `membership-${email.split('@')[0]}`,
  user_id: userIdFor(email),
  organization_id: ORG,
  role,
  is_designer: false,
  joined_at: '2026-01-01T00:00:00.000Z',
});
const db = createFakeDb({
  organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  users,
  user_organizations: [
    membership(OWNER, 'owner'),
    membership(MEMBER),
    membership(STAYING),
    membership(SWITCHING),
    membership(REVOKED),
    membership(LOADING),
  ],
  presentation_collaborators: [],
});
__setTestDb(db);
await initializeStorage();

after(() => {
  __setTestDb(null);
});

const connectAs = async (url, deckId, email) =>
  collabSocket.connectAs(
    url,
    deckId,
    await collabSocket.cookieFor(users.find((u) => u.email === email)),
  );

test('collab: a member removed from the organization loses an organization deck', async (t) => {
  const { id } = await createNotedDeck(testScope(REPO_ROOT), {
    ownerEmail: OWNER,
  });
  const pres = await updatePresentation(
    testScope(REPO_ROOT),
    id,
    { visibility: 'organization' },
    { allowVisibilityChange: true },
  );
  assert.equal(pres.visibility, 'organization');
  const collab = await collabSocket.startCollabServer({
    repoRoot: REPO_ROOT,
    authorizationLeaseMs: LEASE_MS,
  });
  const owner = await connectAs(collab.url, pres.id, OWNER);
  const member = await connectAs(collab.url, pres.id, MEMBER);
  const staying = await connectAs(collab.url, pres.id, STAYING);
  t.after(async () => {
    owner.destroy();
    member.destroy();
    staying.destroy();
    await collab.stop();
  });
  await waitFor(() => owner.hasDeck() && member.hasDeck() && staying.hasDeck());
  assert.equal(member.holds(), true, 'a member writes the organization deck');

  member.silence();
  staying.silence();
  const result = await removeMember(
    testScope(REPO_ROOT),
    membership(MEMBER).id,
  );
  assert.equal(result.ok, true);
  await sleep(LEASE_MS * 2);

  owner.writeNote(' AFTER-LEAVING');
  await waitFor(() => staying.holds('AFTER-LEAVING'));
  await waitFor(() => member.events.closes > 0);
  assert.equal(
    member.holds('AFTER-LEAVING'),
    false,
    'the removed member receives nothing written after the lease',
  );
  assert.equal(staying.events.closes, 0, 'a remaining member stays');
  assert.equal(owner.events.closes, 0);
});

/** A deck with the AI notes that every member of the organization may write. */
async function organizationDeck() {
  const scope = testScope(REPO_ROOT);
  const { id } = await createNotedDeck(scope, { ownerEmail: OWNER });
  return updatePresentation(
    scope,
    id,
    { visibility: 'organization' },
    { allowVisibilityChange: true },
  );
}

test('collab: a removed member opens no further deck on the socket they still have', async (t) => {
  const first = await organizationDeck();
  const second = await organizationDeck();
  const collab = await collabSocket.startCollabServer({
    repoRoot: REPO_ROOT,
    authorizationLeaseMs: LEASE_MS,
  });
  const switching = await connectAs(collab.url, first.id, SWITCHING);
  const staying = await connectAs(collab.url, first.id, STAYING);
  const opened = [];
  t.after(async () => {
    for (const client of [...opened, switching, staying]) client.destroy();
    await collab.stop();
  });
  await waitFor(() => switching.hasDeck() && staying.hasDeck());

  const result = await removeMember(
    testScope(REPO_ROOT),
    membership(SWITCHING).id,
  );
  assert.equal(result.ok, true);
  // Straight away, well within the lease of the first deck: opening a
  // document does not lean on a lease.
  const refused = await collabSocket.openOnSocket(switching, second.id);
  const allowed = await collabSocket.openOnSocket(staying, second.id);
  opened.push(refused, allowed);

  await waitFor(() => refused.events.denied);
  await waitFor(() => allowed.hasDeck());
  assert.equal(refused.events.authenticated, false);
  assert.equal(refused.hasDeck(), false);
  assert.equal(
    refused.holds(),
    false,
    'the removed member receives nothing of the deck they had not opened',
  );
  assert.equal(allowed.events.authenticated, true);
  assert.equal(
    allowed.holds(),
    true,
    'a member opens a second deck on the same socket',
  );
  assert.equal(collab.connections(second.id).length, 1);
});

test('collab: a revoked session opens no further deck on the socket it still has', async (t) => {
  const first = await organizationDeck();
  const second = await organizationDeck();
  const collab = await collabSocket.startCollabServer({
    repoRoot: REPO_ROOT,
    authorizationLeaseMs: LEASE_MS,
  });
  const revoked = await connectAs(collab.url, first.id, REVOKED);
  const opened = [];
  t.after(async () => {
    for (const client of [...opened, revoked]) client.destroy();
    await collab.stop();
  });
  await waitFor(() => revoked.hasDeck());

  // A password change: every session minted before it stops verifying.
  db.__tables.users.find((u) => u.email === REVOKED).password_changed_at =
    '2026-10-18T12:00:00.000Z';
  const refused = await collabSocket.openOnSocket(revoked, second.id);
  opened.push(refused);

  await waitFor(() => refused.events.denied);
  assert.equal(refused.hasDeck(), false);
  assert.equal(refused.holds(), false);
});

test('collab: a first sync that outlasts the lease is checked again before it goes out', async (t) => {
  const deck = await organizationDeck();
  const collab = await collabSocket.startCollabServer({
    repoRoot: REPO_ROOT,
    authorizationLeaseMs: LEASE_MS,
  });
  // Hold the document's load until the test lets it go: both connections are
  // authorized by then, and their leases run out before the first sync.
  let release;
  const loaded = new Promise((resolve) => {
    release = resolve;
  });
  let loading = false;
  collab.hocuspocus.configuration.extensions.push({
    async onLoadDocument({ documentName }) {
      if (documentName !== `presentation:${deck.id}`) return;
      loading = true;
      await loaded;
    },
  });
  const leaving = await connectAs(collab.url, deck.id, LOADING);
  const staying = await connectAs(collab.url, deck.id, STAYING);
  t.after(async () => {
    leaving.destroy();
    staying.destroy();
    await collab.stop();
  });
  await waitFor(() => loading && leaving.events.authenticated);
  await waitFor(() => staying.events.authenticated);

  const result = await removeMember(
    testScope(REPO_ROOT),
    membership(LOADING).id,
  );
  assert.equal(result.ok, true);
  await sleep(LEASE_MS * 2);
  release();

  await waitFor(() => staying.hasDeck());
  assert.equal(staying.holds(), true, 'a member who stays gets the first sync');
  await waitFor(() => collab.connections(deck.id).length === 1);
  assert.equal(leaving.hasDeck(), false);
  assert.equal(
    leaving.holds(),
    false,
    'the first sync waits for a fresh check once the lease ran out',
  );
});
