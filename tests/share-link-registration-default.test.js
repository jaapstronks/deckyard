/**
 * A share link is open to anyone with it unless you say otherwise (B744, D354).
 *
 * The Guests tab is headed "Anyone with the link", and a comment link used to
 * default to the opposite: `invite_only`, in the client select and twice on
 * the server (the storage default and a second one in the route). D354 made
 * `open` the default and inviting specific people the opt-in; the storage
 * layer is the one place that default lives, and the route passes an absent
 * field through rather than spelling its own.
 *
 * Pinned at both doors: `createShareLink()` directly, and `POST
 * /api/presentations/:id/share-links` through the exported dispatcher, over
 * tests/helpers/fake-db.js (house shape of
 * tests/share-link-guest-management-authz.test.js).
 *
 * Run with: node --test tests/share-link-registration-default.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createShareLink } =
  await import('../server/storage/share-links/index.js');
const { handleShareLinkManagement } =
  await import('../server/routes/api/share-links/management.js');

const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive',
  organizationId: ORG,
};

let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: OWNER.id,
        organization_id: ORG,
        email: OWNER.email,
        name: OWNER.name,
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

async function seedDeck() {
  return createPresentation(testScope(), {
    title: 'Deck with links',
    ownerEmail: OWNER.email,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
}

async function post(presentationId, body) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = createMockRes();
  await handleShareLinkManagement({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(
      `http://decks.example.test/api/presentations/${presentationId}/share-links`,
    ),
    authedUser: OWNER,
  });
  return res;
}

test('storage: a comment link without registrationMode is open', async () => {
  const pres = await seedDeck();
  const result = await createShareLink(testScope(), pres.id, {
    permission: 'comment',
  });
  assert.equal(result.ok, true);
  assert.equal(result.shareLink.registrationMode, 'open');
});

test('storage: invite_only is still the opt-in', async () => {
  const pres = await seedDeck();
  const result = await createShareLink(testScope(), pres.id, {
    permission: 'comment',
    registrationMode: 'invite_only',
  });
  assert.equal(result.shareLink.registrationMode, 'invite_only');
});

test('route: POST without registrationMode creates an open link', async () => {
  const pres = await seedDeck();
  const res = await post(pres.id, { permission: 'comment' });
  assert.equal(res.statusCode, 201, String(res.body));
  const body = JSON.parse(String(res.body));
  assert.equal(body.registrationMode, 'open');
});

test('route: an explicit invite_only is kept', async () => {
  const pres = await seedDeck();
  const res = await post(pres.id, {
    permission: 'comment',
    registrationMode: 'invite_only',
  });
  assert.equal(res.statusCode, 201, String(res.body));
  assert.equal(JSON.parse(String(res.body)).registrationMode, 'invite_only');
});
