/**
 * Slide collections storage: CRUD, ordering, scope isolation, and authz.
 *
 * Drives the storage facade (server/storage/collections.js) against an
 * initialized file adapter - the same path the running server uses in the
 * default OSS (file) mode. Covers:
 * - personal create/list/get/update/delete round-trip
 * - ordered membership (slideIds) replacement on update
 * - personal scope isolation between users
 * - team create/list plus the creator/admin mutate guard
 *
 * Run with: node --test tests/slide-collections-storage.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(os.tmpdir(), `deckyard-collections-${crypto.randomUUID()}`);
process.env.DATA_DIR = path.join(repoRoot, 'data');

const { initializeStorage, closeStorage } = await import('../server/storage/adapters/index.js');
const {
  listPersonalCollections,
  getPersonalCollection,
  createPersonalCollection,
  updatePersonalCollection,
  deletePersonalCollection,
  listTeamCollections,
  createTeamCollection,
  updateTeamCollection,
  deleteTeamCollection,
} = await import('../server/storage/collections.js');

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

before(async () => {
  await fs.mkdir(process.env.DATA_DIR, { recursive: true });
  await initializeStorage(repoRoot);
});

after(async () => {
  await closeStorage();
  await fs.rm(repoRoot, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('personal collections', () => {
  it('creates, lists and gets a collection with an ordered membership', async () => {
    const created = await createPersonalCollection(
      repoRoot,
      ALICE,
      { name: 'Intro deck', description: 'Onboarding', slideIds: ['s1', 's2', 's3'] },
      { actorEmail: ALICE }
    );
    assert.ok(created.ok, 'create ok');
    assert.strictEqual(created.item.scope, 'personal');
    assert.strictEqual(created.item.ownerEmail, ALICE);
    assert.strictEqual(created.item.slideCount, 3);
    assert.deepStrictEqual(created.item.slideIds, ['s1', 's2', 's3']);

    const { items } = await listPersonalCollections(repoRoot, ALICE);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, created.item.id);

    const fetched = await getPersonalCollection(repoRoot, ALICE, created.item.id);
    assert.ok(fetched, 'fetched by id');
    assert.strictEqual(fetched.name, 'Intro deck');
  });

  it('rejects a collection with no name', async () => {
    const r = await createPersonalCollection(repoRoot, ALICE, { name: '  ' }, { actorEmail: ALICE });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'name_required');
  });

  it('replaces the ordered membership on update and dedupes', async () => {
    const created = await createPersonalCollection(
      repoRoot,
      ALICE,
      { name: 'Reorder me', slideIds: ['a', 'b'] },
      { actorEmail: ALICE }
    );
    const updated = await updatePersonalCollection(
      repoRoot,
      ALICE,
      created.item.id,
      { slideIds: ['c', 'a', 'a', 'b'], name: 'Reordered' },
      { actorEmail: ALICE }
    );
    assert.ok(updated.ok, 'update ok');
    assert.strictEqual(updated.item.name, 'Reordered');
    // Deduped, order preserved.
    assert.deepStrictEqual(updated.item.slideIds, ['c', 'a', 'b']);
    assert.strictEqual(updated.item.slideCount, 3);
  });

  it('isolates personal collections between users', async () => {
    const aliceCol = await createPersonalCollection(
      repoRoot,
      ALICE,
      { name: 'Private to Alice' },
      { actorEmail: ALICE }
    );

    // Bob cannot see Alice's collection in his list.
    const bobList = await listPersonalCollections(repoRoot, BOB);
    assert.ok(!bobList.items.some((c) => c.id === aliceCol.item.id), 'not in Bob list');

    // Bob cannot fetch, update, or delete it.
    assert.strictEqual(await getPersonalCollection(repoRoot, BOB, aliceCol.item.id), null);
    const bobUpdate = await updatePersonalCollection(
      repoRoot,
      BOB,
      aliceCol.item.id,
      { name: 'hijacked' },
      { actorEmail: BOB }
    );
    assert.strictEqual(bobUpdate.ok, false);
    assert.strictEqual(bobUpdate.reason, 'not_found');
    const bobDelete = await deletePersonalCollection(repoRoot, BOB, aliceCol.item.id);
    assert.strictEqual(bobDelete.ok, false);
  });

  it('deletes a collection', async () => {
    const created = await createPersonalCollection(
      repoRoot,
      ALICE,
      { name: 'Temp' },
      { actorEmail: ALICE }
    );
    const del = await deletePersonalCollection(repoRoot, ALICE, created.item.id);
    assert.ok(del.ok, 'delete ok');
    assert.strictEqual(await getPersonalCollection(repoRoot, ALICE, created.item.id), null);
  });
});

describe('team collections', () => {
  it('creates and lists a team collection', async () => {
    const created = await createTeamCollection(
      repoRoot,
      { name: 'Team starter', slideIds: ['t1'] },
      { actorEmail: ALICE }
    );
    assert.ok(created.ok);
    assert.strictEqual(created.item.scope, 'team');
    assert.strictEqual(created.item.createdBy, ALICE);

    const { items } = await listTeamCollections(repoRoot, { userEmail: BOB });
    assert.ok(items.some((c) => c.id === created.item.id), 'visible to any user');
  });

  it('enforces the mutate guard: only creator or admin', async () => {
    const created = await createTeamCollection(
      repoRoot,
      { name: 'Guarded' },
      { actorEmail: ALICE }
    );
    const allowMutate = (collection, { actorEmail }) =>
      String(collection?.createdBy || '').toLowerCase() === String(actorEmail || '').toLowerCase();

    // Bob (non-creator, non-admin) is blocked.
    const blocked = await updateTeamCollection(
      repoRoot,
      created.item.id,
      { name: 'nope' },
      { actorEmail: BOB, allowMutate }
    );
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason, 'forbidden');

    // Alice (creator) may mutate and delete.
    const ok = await updateTeamCollection(
      repoRoot,
      created.item.id,
      { name: 'Renamed' },
      { actorEmail: ALICE, allowMutate }
    );
    assert.ok(ok.ok);
    assert.strictEqual(ok.item.name, 'Renamed');

    const del = await deleteTeamCollection(repoRoot, created.item.id, {
      actorEmail: ALICE,
      allowMutate,
    });
    assert.ok(del.ok);
  });
});
