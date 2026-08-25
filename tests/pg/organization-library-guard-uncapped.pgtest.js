/**
 * The organization-library trash/delete authz guard resolves its target un-capped (B85).
 *
 * B79 inherited the old `applyPagination()` default as a literal `.limit(100)`
 * on the slide-library list. `setOrganizationLibraryItemTrashed`/`deleteOrganizationLibraryItem`
 * then resolved the guard's target by scanning that capped list, so an item that
 * sat past the newest 100 rows failed the authz guard with a false `not_found` —
 * an organization simply could not trash or delete the tail of its own shelf.
 *
 * B85 removed the list cap and moved the guard to resolve directly by id. This
 * pins, against real PostgreSQL, the exact thing the fake in-memory DB cannot
 * prove: with >100 org-shelf items present, an item beyond the newest page is
 * still found, its creator still passes the guard, and a non-org id or a missing
 * id still resolves to `not_found`. It also checks the list facade itself now
 * returns the full set rather than the newest 100.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import crypto from 'node:crypto';
import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedSlideLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  listOrganizationLibrary,
  setOrganizationLibraryItemTrashed,
  deleteOrganizationLibraryItem,
} from '../../server/storage/slide-library.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const ORG = getDefaultOrganizationId();
const storageScope = testScope();

const CREATOR = 'creator@example.com';
const FILLER_COUNT = 120; // comfortably past the old 100-row cap

pgDescribe(
  'organization-library guard resolves un-capped (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;
    /** The target item, seeded oldest so it sits past the newest 100 by created_at. */
    let tailId;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      uninstallFacadeStorage();
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(db, 'slide_library', 'organizations');
      await seedDefaultOrganization(db);

      // One target with the oldest timestamp — the newest-first list orders it
      // dead last, exactly where the old .limit(100) would have dropped it.
      tailId = await seedSlideLibraryItem(db, {
        organizationId: ORG,
        shelf: 'organization',
        name: 'Tail item',
        createdAt: '2000-01-01T00:00:00.000Z',
        createdBy: CREATOR,
      });

      // Fill well past the cap with newer items so the target is not in the newest page.
      for (let i = 0; i < FILLER_COUNT; i += 1) {
        await seedSlideLibraryItem(db, {
          organizationId: ORG,
          shelf: 'organization',
          name: `Filler ${i}`,
          createdAt: `2020-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
        });
      }
    });

    it('listOrganizationLibrary returns the full set, not just the newest 100', async () => {
      const { items } = await listOrganizationLibrary(storageScope);
      assert.equal(
        items.length,
        FILLER_COUNT + 1,
        'the tail past 100 rows is present',
      );
      assert.ok(
        items.some((it) => it.id === tailId),
        'the oldest item survives the list',
      );
    });

    it('trashes an item past the newest 100 (no false not_found)', async () => {
      const r = await setOrganizationLibraryItemTrashed(storageScope, tailId, {
        trashed: true,
        actorEmail: CREATOR,
        allowTrash: () => true,
      });
      assert.equal(r.ok, true, 'the guard resolved the capped-out item');
      assert.ok(r.item.trashedAt, 'it was actually soft-deleted');

      const row = await db
        .selectFrom('slide_library')
        .select('trashed_at')
        .where('id', '=', tailId)
        .executeTakeFirstOrThrow();
      assert.ok(row.trashed_at, 'the trash flag is persisted');
    });

    it('deletes an item past the newest 100 (no false not_found)', async () => {
      const r = await deleteOrganizationLibraryItem(storageScope, tailId, {
        actorEmail: CREATOR,
        allowDelete: () => true,
      });
      assert.equal(r.ok, true, 'the guard resolved the capped-out item');

      const row = await db
        .selectFrom('slide_library')
        .select('id')
        .where('id', '=', tailId)
        .executeTakeFirst();
      assert.equal(row, undefined, 'the row is gone');
    });

    it('still enforces the guard: a rejecting allowTrash returns forbidden', async () => {
      const r = await setOrganizationLibraryItemTrashed(storageScope, tailId, {
        trashed: true,
        actorEmail: 'someone-else@example.com',
        allowTrash: () => false,
      });
      assert.equal(r.ok, false);
      assert.equal(
        r.reason,
        'forbidden',
        'authz still runs on the resolved item',
      );
    });

    it('a genuinely missing id is still not_found', async () => {
      // Ids are server-generated uuids; a "missing" one is a valid, absent uuid.
      const r = await deleteOrganizationLibraryItem(
        storageScope,
        crypto.randomUUID(),
        {
          actorEmail: CREATOR,
          allowDelete: () => true,
        },
      );
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'not_found');
    });

    it('a personal-shelf id is not an organization-shelf item (stays not_found)', async () => {
      const personalId = await seedSlideLibraryItem(db, {
        organizationId: ORG,
        shelf: 'personal',
        ownerEmail: CREATOR,
        name: 'Personal item',
      });
      const r = await deleteOrganizationLibraryItem(storageScope, personalId, {
        actorEmail: CREATOR,
        allowDelete: () => true,
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'not_found', 'the org-shelf guard is preserved');
    });
  },
);
