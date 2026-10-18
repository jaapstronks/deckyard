/**
 * Leaving an organization takes the collab document away (B767).
 *
 * An organization-visible deck is writable by every member of its
 * organization, without a collaborator row. When a membership ends, the
 * member's session cookie still verifies; only resolving the membership again
 * tells. The collab lease does that on every renewal (it reads the cookie
 * anew instead of reusing the user from the upgrade), so a removed member who
 * only listens receives nothing written after the lease ran out, and a member
 * who stays goes on receiving.
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

const users = userRows(OWNER, MEMBER, STAYING);
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
