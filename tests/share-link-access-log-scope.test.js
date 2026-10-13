/** Share-link access logs require a scope and enforce the link's organization. */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { logShareLinkAccess, getShareLinkAccessLog, getShareLinkById } =
  await import('../server/storage/share-links/index.js');

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const LINK_IN_A = 'link-in-organization-a';
const LINK_IN_B = 'link-in-organization-b';

/**
 * A `presentation_share_links` row, in the shape the storage layer writes.
 * @param {Object} spec
 * @returns {Object}
 */
function linkRow({ id, org, deck }) {
  return {
    id,
    organization_id: org,
    presentation_id: deck,
    token: `tok-${id}`,
    label: null,
    permission: 'read',
    password_hash: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    created_by: 'owner@example.test',
    created_at: '2026-03-01T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
    revocation_message: null,
    registration_mode: 'invite_only',
  };
}

/** An access-log row for one link. */
function logRow({
  id,
  linkId,
  ip = '203.0.113.7',
  at = '2026-03-02T00:00:00.000Z',
}) {
  return {
    id,
    share_link_id: linkId,
    ip_address: ip,
    user_agent: 'UA/1.0',
    accessed_at: at,
  };
}

/** Install a fresh double seeded with both organizations' links. */
function seed(accessLog = []) {
  const db = createFakeDb({
    presentation_share_links: [
      linkRow({ id: LINK_IN_A, org: ORG_A, deck: 'deck-a' }),
      linkRow({ id: LINK_IN_B, org: ORG_B, deck: 'deck-b' }),
    ],
    share_link_access_log: accessLog,
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Behaviour: the link is the address
// ---------------------------------------------------------------------------

test('the log answers for exactly the link it is asked about', async () => {
  seed([
    logRow({
      id: 'a1',
      linkId: LINK_IN_A,
      ip: '203.0.113.1',
      at: '2026-03-02T10:00:00.000Z',
    }),
    logRow({
      id: 'a2',
      linkId: LINK_IN_A,
      ip: '203.0.113.2',
      at: '2026-03-02T11:00:00.000Z',
    }),
    logRow({ id: 'b1', linkId: LINK_IN_B, ip: '198.51.100.9' }),
  ]);

  const entries = await getShareLinkAccessLog(
    { organizationId: ORG_A },
    LINK_IN_A,
    {},
  );

  assert.deepEqual(
    entries.map((e) => e.id).sort(),
    ['a1', 'a2'],
    'the other organization’s link contributes nothing — different link, different rows',
  );
  assert.deepEqual(
    [...new Set(entries.map((e) => e.shareLinkId))],
    [LINK_IN_A],
  );
  assert.equal(entries[0].ipAddress, '203.0.113.2', 'newest access first');
});

test('an unknown or empty link id yields nothing', async () => {
  const db = seed([logRow({ id: 'a1', linkId: LINK_IN_A })]);

  assert.deepEqual(
    await getShareLinkAccessLog({ organizationId: ORG_A }, 'no-such-link', {}),
    [],
  );
  assert.deepEqual(
    await getShareLinkAccessLog({ organizationId: ORG_A }, '', {}),
    [],
  );
  assert.deepEqual(
    await getShareLinkAccessLog({ organizationId: ORG_A }, null, {}),
    [],
  );
  assert.deepEqual(
    db.__queryLog,
    [
      { op: 'select', table: 'share_link_access_log' },
      { op: 'join', table: 'presentation_share_links' },
    ],
    'only the one real lookup reaches the database; a blank id short-circuits',
  );
});

test('writing a row needs the link and the access info, nothing else', async () => {
  const db = seed();

  await logShareLinkAccess({ organizationId: ORG_A }, LINK_IN_A, {
    ipAddress: '203.0.113.5',
    userAgent: 'UA/2.0',
  });
  await logShareLinkAccess({ organizationId: ORG_A }, '', {
    ipAddress: '203.0.113.6',
  });

  const rows = db.__tables.share_link_access_log || [];
  assert.equal(rows.length, 1, 'the blank link id wrote nothing');
  assert.equal(rows[0].share_link_id, LINK_IN_A);
  assert.equal(rows[0].ip_address, '203.0.113.5');
  assert.equal(rows[0].user_agent, 'UA/2.0');
});

// ---------------------------------------------------------------------------
// Containment: the gate that stands between a caller and this table
// ---------------------------------------------------------------------------

test('a link id from another organization does not resolve, so the log is unreachable', async () => {
  seed([logRow({ id: 'b1', linkId: LINK_IN_B })]);

  // This is what `loadLinkForPresentation` calls before the route reads the
  // log. Acting in organization A, the organization-B link is simply absent — the
  // route turns that into a 404 (MH2) and never asks for the log.
  assert.equal(
    await getShareLinkById({ organizationId: ORG_A }, LINK_IN_B),
    null,
  );

  const own = await getShareLinkById({ organizationId: ORG_A }, LINK_IN_A);
  assert.equal(
    own?.id,
    LINK_IN_A,
    'its own organization’s link resolves normally',
  );
});

test('resolving a link with no organization to act in refuses rather than guessing', async () => {
  seed();

  await assert.rejects(
    () => getShareLinkById({}, LINK_IN_A),
    /no organization/i,
    'getOrgId throws instead of falling back to the default organization',
  );
});

test('a scope for another organization cannot read or write this link log', async () => {
  const db = seed([logRow({ id: 'a1', linkId: LINK_IN_A })]);
  assert.deepEqual(
    await getShareLinkAccessLog({ organizationId: ORG_B }, LINK_IN_A, {}),
    [],
  );
  await logShareLinkAccess({ organizationId: ORG_B }, LINK_IN_A, {
    ipAddress: '203.0.113.8',
  });
  assert.equal(db.__tables.share_link_access_log.length, 1);
});

test('access-log calls refuse missing scope', async () => {
  seed();
  await assert.rejects(
    () => getShareLinkAccessLog(undefined, LINK_IN_A, {}),
    /storage scope/,
  );
  await assert.rejects(
    () => logShareLinkAccess(undefined, LINK_IN_A, {}),
    /storage scope/,
  );
});
