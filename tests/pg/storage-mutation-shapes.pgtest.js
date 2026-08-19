/**
 * The mutation failure shape, against real PostgreSQL (B91).
 *
 * `docs/reference/storage-layer.md` § *Failure signalling* says a storage
 * mutation answers `{ ok: true, … }` or `{ ok: false, reason }` on every
 * non-throwing branch — never `null`, `undefined` or a bare `false`.
 * `tests/storage-call-convention.test.js` gates the shape statically, but a
 * syntax check cannot see which branch the database actually takes: whether a
 * missing row really produces `not_found`, or whether the success payload
 * carries the thing the caller then serves.
 *
 * B86 pinned the live-session mutations in `live-sessions.pgtest.js` and B91
 * pinned the interaction/feedback cluster in `live-interactions.pgtest.js`.
 * This file holds the last group, which has no domain pgtest file of its own:
 * the presentation trash/duplicate pair, the image-library update/delete pair
 * and `removePublishedEntry` — the two boolean-shaped exports among them being
 * exactly the drift the gate is blind to.
 *
 * Both directions are pinned per export. A mutation that only ever answered
 * `{ ok: false }` would satisfy a one-sided test while being useless.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  deletePresentation,
  duplicatePresentation,
  restorePresentation,
} from '../../server/storage/presentations/index.js';
import {
  createImageLibraryItem,
  deleteImageLibraryItem,
  getImageLibraryItem,
  updateImageLibraryItem,
} from '../../server/storage/image-library/index.js';
import {
  removePublishedEntry,
  upsertPublishedEntry,
} from '../../server/storage/published/index.js';

const storageScope = testScope();
const ALICE = 'alice@example.test';

// A well-formed id that names nothing. It has to be a real UUID: the id columns
// are `uuid`, so a `'no-such-deck'` string makes PostgreSQL raise 22P02 before
// the query can answer "no rows" — a separate (pre-existing) gap, where these
// facades let a malformed caller id throw instead of answering `invalid`.
const absentId = () => crypto.randomUUID();

pgDescribe('storage mutation shapes (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await uninstallFacadeStorage();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncate(
      db,
      'organizations',
      'image_library',
      'published_presentations',
    );
    await seedDefaultOrganization(db);
  });

  // ─── presentations: restore + duplicate ────────────────────────────────────

  it('restorePresentation answers not_found for a deck that is not in the trash', async () => {
    assert.deepEqual(await restorePresentation(storageScope, absentId()), {
      ok: false,
      reason: 'not_found',
    });

    // A live deck is not restorable either: the UPDATE filters on trashed_at.
    const live = await createPresentation(storageScope, {
      title: 'Live',
      ownerEmail: ALICE,
    });
    assert.deepEqual(await restorePresentation(storageScope, live.id), {
      ok: false,
      reason: 'not_found',
    });
  });

  it('restorePresentation hands the restored deck back under ok', async () => {
    const pres = await createPresentation(storageScope, {
      title: 'Deck',
      ownerEmail: ALICE,
    });
    await deletePresentation(storageScope, pres.id, { actorEmail: ALICE });

    const restored = await restorePresentation(storageScope, pres.id);
    assert.equal(restored.ok, true);
    assert.equal(restored.presentation.id, pres.id);
    assert.equal(restored.presentation.trashedAt, null);
  });

  it('duplicatePresentation answers not_found for a deck this scope cannot see', async () => {
    assert.deepEqual(
      await duplicatePresentation(storageScope, absentId(), {}),
      {
        ok: false,
        reason: 'not_found',
      },
    );
  });

  it('duplicatePresentation hands the copy back under ok', async () => {
    const pres = await createPresentation(storageScope, {
      title: 'Deck',
      ownerEmail: ALICE,
    });
    const copy = await duplicatePresentation(storageScope, pres.id, {
      actorEmail: ALICE,
    });
    assert.equal(copy.ok, true);
    assert.notEqual(copy.presentation.id, pres.id, 'a duplicate is a new deck');
    assert.match(copy.presentation.title, /Deck$/);
  });

  // ─── image library: update + delete ────────────────────────────────────────

  it('updateImageLibraryItem answers not_found for an image that is not here', async () => {
    assert.deepEqual(
      await updateImageLibraryItem(storageScope, absentId(), { title: 'x' }),
      {
        ok: false,
        reason: 'not_found',
      },
    );
  });

  it('updateImageLibraryItem hands the patched row back under ok', async () => {
    const created = await createImageLibraryItem(storageScope, {
      url: '/uploads/one.png',
      title: 'Before',
    });
    const updated = await updateImageLibraryItem(storageScope, created.id, {
      url: '/uploads/one.png',
      title: 'After',
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.image.title, 'After');
  });

  it('deleteImageLibraryItem answers ok / not_found instead of a bare boolean', async () => {
    const created = await createImageLibraryItem(storageScope, {
      url: '/uploads/two.png',
      title: 'Doomed',
    });
    assert.deepEqual(await deleteImageLibraryItem(storageScope, created.id), {
      ok: true,
    });
    assert.equal(await getImageLibraryItem(storageScope, created.id), null);
    assert.deepEqual(await deleteImageLibraryItem(storageScope, created.id), {
      ok: false,
      reason: 'not_found',
    });
  });

  // ─── publishing: the other boolean the gate cannot see ─────────────────────

  it('removePublishedEntry answers invalid, not_found and ok rather than true/false', async () => {
    assert.deepEqual(await removePublishedEntry(storageScope, '   '), {
      ok: false,
      reason: 'invalid',
    });
    assert.deepEqual(
      await removePublishedEntry(storageScope, 'no-such-entry'),
      {
        ok: false,
        reason: 'not_found',
      },
    );

    const pres = await createPresentation(storageScope, {
      title: 'Published',
      ownerEmail: ALICE,
    });
    await upsertPublishedEntry(storageScope, {
      publishId: 'pub-1',
      presentationId: pres.id,
      title: 'Published',
    });
    assert.deepEqual(await removePublishedEntry(storageScope, 'pub-1'), {
      ok: true,
    });
  });
});
