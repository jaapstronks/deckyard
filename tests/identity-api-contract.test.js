/**
 * The identity contract that crosses the wire (T10, PR C).
 *
 * The server decides ownership on `users.id` (PR A). For the client to mirror
 * that decision — which affordance to show — three things have to be true, and
 * this file pins each of them:
 *
 *   1. **the session carries an id**: login and `/api/auth/me` return one, so
 *      the client has something to compare with;
 *   2. **a presentation carries one**: `ownerId`/`createdById`/`updatedById`
 *      ride along on both the app and the public-API shapes;
 *   3. **the client compares the same way the server does**: the mirrors in
 *      client/lib import the *same* rule from shared/identity-match.js, so the
 *      two cannot drift apart the way they did when each surface re-derived
 *      "is this mine?" from an email.
 *
 * `ownerEmail` stays in the responses as display/contact — owner-only in the
 * public API — and is compared nowhere. That is the point of the split: display
 * and identity are two concepts, so they are two fields.
 *
 * Run with: node --test tests/identity-api-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Auth config must be in place before the modules under test are imported.
// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_ORG_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const USER_ID = 'user-alice-0001';
const OTHER_ID = 'user-bob-0002';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const auth = await import('../server/auth/auth.js');

const { sanitizePresentation } =
  await import('../server/routes/public-api/v1/presentations.js');
const { isCommentOwner } =
  await import('../client/lib/comments/comment-authz.js');
const { isPresentationAuthor: clientIsAuthor, isSlideLockedForUser } =
  await import('../client/lib/slide-authoring/slide-lock-authz.js');
const { isPresentationAuthor: serverIsAuthor } =
  await import('../server/utils/presentation-authz.js');

const passwordHash = await hashPassword('correct-horse-battery');

function seedDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: USER_ID,
        organization_id: ORG,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        password_hash: passwordHash,
        password_changed_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
  });
  __setTestDb(db);
  return db;
}

/** Build a request whose cookie header carries the session just minted. */
function requestWithSession(user) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie(req, res, user);
  const cookie = String(res.headers['Set-Cookie']).split(';')[0];
  return { headers: { cookie } };
}

// ---------------------------------------------------------------------------
// 1. The session carries an id
// ---------------------------------------------------------------------------

test('logging in yields the stable user id, not just an address', async () => {
  seedDb();
  const user = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct-horse-battery',
    {},
  );

  assert.equal(user.id, USER_ID);
  assert.equal(user.email, 'alice@example.com');
});

test('the session resolved from a cookie carries the same id', async () => {
  seedDb();
  const login = await auth.verifyLoginAsync(
    'alice@example.com',
    'correct-horse-battery',
    {},
  );
  const me = await auth.getUserFromRequestAsync(requestWithSession(login), {});

  // /api/auth/me serves this object verbatim, so what the route returns is
  // exactly what the client compares with.
  assert.equal(me.id, USER_ID);
});

// ---------------------------------------------------------------------------
// 2. A presentation carries one
// ---------------------------------------------------------------------------

test('the public-API shape carries the identity ids beside the display email', () => {
  const pres = {
    id: 'p1',
    title: 'Deck',
    ownerId: USER_ID,
    ownerEmail: 'alice@example.com',
    createdById: USER_ID,
    // The last writer travels as a display pair on the internal API (D22); the
    // public v1 shape projects it back down to the bare id it always exposed.
    updatedBy: { id: OTHER_ID, displayName: 'Bob Builder' },
    slides: [],
  };

  const asOwner = sanitizePresentation(pres, [], 'alice@example.com');
  assert.equal(asOwner.ownerId, USER_ID);
  assert.equal(asOwner.createdById, USER_ID);
  assert.equal(asOwner.updatedById, OTHER_ID);
  assert.equal(
    asOwner.updatedByDisplayName,
    undefined,
    'the public shape exposes the id only, never a name or an address',
  );
  assert.equal(asOwner.ownerEmail, 'alice@example.com');
});

test('the owner email is still redacted for anyone else — the id is not', () => {
  const pres = {
    id: 'p1',
    title: 'Deck',
    ownerId: USER_ID,
    ownerEmail: 'alice@example.com',
    slides: [],
  };
  const asStranger = sanitizePresentation(pres, [], 'bob@example.com');

  // Redaction is about disclosing a person's address, which an opaque id does
  // not do — and the id is what a consumer needs to answer "is this mine?".
  assert.equal(asStranger.ownerEmail, null);
  assert.equal(asStranger.ownerId, USER_ID);
});

test('a deck with no user record behind its owner reports a null id, not an error', () => {
  const pres = {
    id: 'p1',
    title: 'Deck',
    ownerEmail: 'external@partner.test',
    slides: [],
  };
  const out = sanitizePresentation(pres, [], 'external@partner.test');

  assert.equal(out.ownerId, null);
  assert.equal(out.ownerEmail, 'external@partner.test');
});

// ---------------------------------------------------------------------------
// 3. The client mirrors decide exactly as the server does
// ---------------------------------------------------------------------------

const dualKeyDeck = {
  id: 'p1',
  visibility: 'private',
  ownerId: USER_ID,
  ownerEmail: 'alice@example.com',
  createdById: USER_ID,
  createdBy: 'alice@example.com',
};

test('the client mirrors grant the owner by id, under any address', () => {
  const owner = { id: USER_ID, email: 'alice-new@example.com' };

  assert.equal(clientIsAuthor(owner, dualKeyDeck), true);
  assert.equal(isCommentOwner(owner, dualKeyDeck), true);
  assert.equal(
    isSlideLockedForUser({ lockedByAuthor: true }, owner, dualKeyDeck),
    false,
  );
  // …and the server agrees, which is the whole point of the shared rule.
  assert.equal(serverIsAuthor({ user: owner, pres: dualKeyDeck }), true);
});

test("a different user carrying the owner's address is refused by both", () => {
  const twin = { id: OTHER_ID, email: 'alice@example.com' };

  assert.equal(clientIsAuthor(twin, dualKeyDeck), false);
  assert.equal(isCommentOwner(twin, dualKeyDeck), false);
  assert.equal(
    isSlideLockedForUser({ lockedByAuthor: true }, twin, dualKeyDeck),
    true,
  );
  assert.equal(serverIsAuthor({ user: twin, pres: dualKeyDeck }), false);
});

test('the id-less shapes still fall back to the email on the client too', () => {
  // File mode / an external owner: no ids anywhere, the address is all there is.
  const legacyDeck = {
    id: 'p2',
    visibility: 'private',
    ownerEmail: 'legacy@example.com',
  };

  assert.equal(
    clientIsAuthor({ email: 'legacy@example.com' }, legacyDeck),
    true,
  );
  assert.equal(
    isCommentOwner({ email: 'legacy@example.com' }, legacyDeck),
    true,
  );
  assert.equal(
    clientIsAuthor({ email: 'someone@example.com' }, legacyDeck),
    false,
  );
});

test('an admin keeps the admin override on the client mirrors', () => {
  const admin = { id: OTHER_ID, email: 'root@example.com', isAdmin: true };

  assert.equal(clientIsAuthor(admin, dualKeyDeck), true);
  assert.equal(isCommentOwner(admin, dualKeyDeck), true);
});
