/**
 * storage/display-identity.js — the builders behind every `{ id, displayName }`
 * in a response (D22), and the memoized batch lookup that feeds them.
 *
 * `tests/response-identity-shape.test.js` checks that mappers *use* these
 * builders; this file checks what the builders do: which name wins, when an
 * identity is `null` rather than blank, that an address stored as a name does
 * not come back under a second field, that the memo is consulted and cleared,
 * and that a user with no name on file is still a user.
 *
 * Run with: node --test tests/display-identity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  NO_DISPLAY_NAMES,
  toDisplayIdentity,
  toStoredActorIdentity,
  resolveDisplayNames,
  invalidateDisplayNames,
} from '../server/storage/display-identity.js';

const ORG = '00000000-0000-0000-0000-0000000000aa';
const ALICE_ID = '00000000-0000-4000-8000-000000000001';
const BOB_ID = '00000000-0000-4000-8000-000000000002';
const NAMELESS_ID = '00000000-0000-4000-8000-000000000003';

function seed() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: ALICE_ID,
        organization_id: ORG,
        email: 'alice@example.com',
        name: 'Alice Users-Row',
      },
      {
        id: BOB_ID,
        organization_id: ORG,
        email: 'bob@example.com',
        name: 'Bob Builder',
      },
      {
        id: NAMELESS_ID,
        organization_id: ORG,
        email: 'nameless@example.com',
        name: null,
      },
    ],
    // Alice has a profile name keyed on her id; it outranks `users.name`.
    user_settings: [
      {
        user_id: ALICE_ID,
        email: 'alice@example.com',
        settings: { profile: { name: 'Alice Profile' } },
      },
    ],
  });
  __setTestDb(db);
  invalidateDisplayNames();
  return db;
}

test.afterEach(() => {
  invalidateDisplayNames();
  __setTestDb(null);
});

// ─── toDisplayIdentity ─────────────────────────────────────────────────────

test('toDisplayIdentity: nobody stamped is null, not a blank identity', () => {
  assert.equal(toDisplayIdentity(null, null), null);
  assert.equal(toDisplayIdentity(undefined, ''), null);
  assert.equal(toDisplayIdentity(null, '   '), null);
});

test('toDisplayIdentity: without a lookup the name derives from the address', () => {
  assert.deepEqual(toDisplayIdentity(null, 'jaap.stronks@example.com'), {
    id: null,
    displayName: 'Jaap Stronks',
  });
  assert.deepEqual(toDisplayIdentity(ALICE_ID, 'alice@example.com'), {
    id: ALICE_ID,
    displayName: 'Alice',
  });
});

test('toDisplayIdentity: a resolved name wins over the derived one', () => {
  const lookup = {
    forId: (id) => (id === ALICE_ID ? 'Alice Profile' : ''),
    forEmail: (email) => (email === 'bob@example.com' ? 'Bob Builder' : ''),
    idForEmail: () => null,
  };
  assert.deepEqual(toDisplayIdentity(ALICE_ID, 'alice@example.com', lookup), {
    id: ALICE_ID,
    displayName: 'Alice Profile',
  });
  // Resolved by address when the id does not resolve.
  assert.deepEqual(toDisplayIdentity(null, 'bob@example.com', lookup), {
    id: null,
    displayName: 'Bob Builder',
  });
});

test('NO_DISPLAY_NAMES is the explicit "nothing resolved" lookup', () => {
  assert.equal(NO_DISPLAY_NAMES.forId(ALICE_ID), '');
  assert.equal(NO_DISPLAY_NAMES.forEmail('alice@example.com'), '');
  assert.equal(NO_DISPLAY_NAMES.idForEmail('alice@example.com'), null);
  assert.ok(Object.isFrozen(NO_DISPLAY_NAMES));
});

// ─── toStoredActorIdentity ─────────────────────────────────────────────────

test('toStoredActorIdentity: an address stored as the name is not a name', () => {
  // The writers fell back to `actor?.name || actor?.email`, so the stored
  // name is often the address again. It must derive, not echo.
  assert.deepEqual(
    toStoredActorIdentity('riley.q@example.com', 'riley.q@example.com'),
    { id: null, displayName: 'Riley Q' },
  );
});

test('toStoredActorIdentity: the stored real name outranks the derived one', () => {
  assert.deepEqual(
    toStoredActorIdentity('riley.q@example.com', 'Riley Quinn'),
    {
      id: null,
      displayName: 'Riley Quinn',
    },
  );
});

test('toStoredActorIdentity: a resolved profile name outranks the frozen one, and brings the id', () => {
  const lookup = {
    forId: () => 'Riley Q. (profile)',
    forEmail: (email) =>
      email === 'riley.q@example.com' ? 'Riley Q. (profile)' : '',
    idForEmail: (email) => (email === 'riley.q@example.com' ? BOB_ID : null),
  };
  assert.deepEqual(
    toStoredActorIdentity('riley.q@example.com', 'Riley Quinn', lookup),
    { id: BOB_ID, displayName: 'Riley Q. (profile)' },
  );
});

test('toStoredActorIdentity: no address but a stored name still names someone', () => {
  assert.deepEqual(toStoredActorIdentity(null, 'Guest Greta'), {
    id: null,
    displayName: 'Guest Greta',
  });
  assert.equal(toStoredActorIdentity(null, null), null);
  assert.equal(toStoredActorIdentity('', 'someone@example.com'), null);
});

// ─── resolveDisplayNames ───────────────────────────────────────────────────

test('resolveDisplayNames: an empty batch resolves nothing without touching the db', async () => {
  const db = seed();
  const lookup = await resolveDisplayNames([]);
  assert.equal(lookup, NO_DISPLAY_NAMES);
  assert.deepEqual(db.__queryLog, []);
});

test('resolveDisplayNames: one query answers ids and addresses, profile name first', async () => {
  const db = seed();
  const lookup = await resolveDisplayNames([
    { id: ALICE_ID },
    { email: 'BOB@example.com' }, // normalized like users.email
    { id: null, email: 'stranger@elsewhere.example' },
  ]);

  assert.equal(lookup.forId(ALICE_ID), 'Alice Profile');
  assert.equal(lookup.forEmail('alice@example.com'), 'Alice Profile');
  assert.equal(lookup.forEmail('bob@example.com'), 'Bob Builder');
  assert.equal(lookup.idForEmail('bob@example.com'), BOB_ID);
  assert.equal(lookup.forEmail('stranger@elsewhere.example'), '');
  assert.equal(lookup.idForEmail('stranger@elsewhere.example'), null);

  const userReads = db.__queryLog.filter(
    (q) => q.op === 'select' && q.table === 'users',
  );
  assert.equal(userReads.length, 1, 'the whole batch is one query');
});

test('resolveDisplayNames: a user with no name on file is still a user', async () => {
  seed();
  const lookup = await resolveDisplayNames([{ email: 'nameless@example.com' }]);
  assert.equal(lookup.forEmail('nameless@example.com'), '');
  assert.equal(
    lookup.idForEmail('nameless@example.com'),
    NAMELESS_ID,
    'the id behind the address is recorded even when the name is blank, ' +
      'so the client can still key the avatar lookup on it',
  );
  // And the mapper still produces an identity with the derived name.
  assert.deepEqual(
    toStoredActorIdentity('nameless@example.com', null, lookup),
    { id: NAMELESS_ID, displayName: 'Nameless' },
  );
});

test('resolveDisplayNames: hits and misses are memoized until invalidated', async () => {
  const db = seed();
  await resolveDisplayNames([{ id: ALICE_ID }, { email: 'ghost@example.com' }]);
  const before = db.__queryLog.filter(
    (q) => q.op === 'select' && q.table === 'users',
  ).length;

  // Rename behind the memo's back: the memo must still answer the old name,
  // and neither the hit nor the miss may re-query.
  await db
    .updateTable('users')
    .set({ name: 'Alice Renamed' })
    .where('id', '=', ALICE_ID)
    .execute();
  await db
    .deleteFrom('user_settings')
    .where('user_id', '=', ALICE_ID)
    .execute();

  const again = await resolveDisplayNames([
    { id: ALICE_ID },
    { email: 'ghost@example.com' },
  ]);
  assert.equal(again.forId(ALICE_ID), 'Alice Profile', 'served from the memo');
  assert.equal(
    db.__queryLog.filter((q) => q.op === 'select' && q.table === 'users')
      .length,
    before,
    'a fully-memoized batch issues no query — misses are cached too',
  );

  // The profile-write path calls this; the next read sees the new name.
  invalidateDisplayNames();
  const fresh = await resolveDisplayNames([{ id: ALICE_ID }]);
  assert.equal(fresh.forId(ALICE_ID), 'Alice Renamed');
});

test('resolveDisplayNames: the lookup it returns survives a concurrent invalidation', async () => {
  seed();
  const lookup = await resolveDisplayNames([{ id: ALICE_ID }]);
  // A profile write lands between the query and the mapper consuming it.
  invalidateDisplayNames();
  assert.equal(
    lookup.forId(ALICE_ID),
    'Alice Profile',
    'the batch keeps its own answers; a cleared memo cannot degrade a ' +
      'response that is already being mapped',
  );
});
