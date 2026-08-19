/**
 * Sandbox TTL cleanup and per-guest quota against real PostgreSQL.
 *
 * Sandbox no longer reads deck JSON off disk (PR F): its TTL sweep and quota
 * are Postgres queries against the `presentations` table. This suite exercises
 * both against a real database — the coverage that lets the file backend go in
 * PR G.
 *
 *  - the sweep (server/jobs/sandbox-cleanup.js) hard-deletes expired ephemeral
 *    decks, spares fresh decks and curated organization-visible decks, and cascades
 *    to each deck's version snapshots and published entry;
 *  - the quota (server/storage/presentations/sandbox-quota.js) counts a guest's
 *    decks and stored bytes within the organization, and refuses a mint past
 *    the deck-count or byte cap with a typed 429.
 *
 * `SANDBOX_MODE` is forced on for the block (the quota gate no-ops without it)
 * and restored afterwards.
 */

import { after, afterEach, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import { sweepExpiredSandboxDecks } from '../../server/jobs/sandbox-cleanup.js';
import {
  assertSandboxQuotaForCreate,
  getSandboxUsageForOwner,
  getSandboxTotalBytes,
  SandboxQuotaError,
} from '../../server/storage/presentations/sandbox-quota.js';

const HOUR = 60 * 60 * 1000;
const ctx = { organizationId: getDefaultOrganizationId() };

/**
 * Insert a presentation row directly (bypassing the facade, which loads themes
 * from disk). `agedHours` back-dates `created_at` so the sweep sees it as old.
 */
async function insertDeck(
  db,
  {
    ownerEmail = null,
    visibility = 'private',
    agedHours = 0,
    slides = [],
    title = 'Deck',
  } = {},
) {
  const id = crypto.randomUUID();
  const createdAt = new Date(Date.now() - agedHours * HOUR).toISOString();
  await db
    .insertInto('presentations')
    .values({
      id,
      organization_id: getDefaultOrganizationId(),
      owner_email: ownerEmail,
      title,
      visibility,
      slides: JSON.stringify(slides),
      i18n: JSON.stringify({}),
      created_at: createdAt,
      modified_at: createdAt,
    })
    .execute();
  return id;
}

pgDescribe('sandbox TTL sweep + quota (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let prevSandboxMode;
  let prevMaxDecks;
  let prevMaxBytes;

  before(async () => {
    db = await openTestDb();
    prevSandboxMode = process.env.SANDBOX_MODE;
    prevMaxDecks = process.env.SANDBOX_MAX_DECKS_PER_GUEST;
    prevMaxBytes = process.env.SANDBOX_MAX_BYTES_PER_GUEST;
    process.env.SANDBOX_MODE = '1';
    // Default TTL is 24h; tests back-date with agedHours around that.
  });

  after(async () => {
    if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxMode;
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    // Reset quota env each test; individual tests set what they need.
    delete process.env.SANDBOX_MAX_DECKS_PER_GUEST;
    delete process.env.SANDBOX_MAX_BYTES_PER_GUEST;
  });

  afterEach(() => {
    if (prevMaxDecks === undefined)
      delete process.env.SANDBOX_MAX_DECKS_PER_GUEST;
    else process.env.SANDBOX_MAX_DECKS_PER_GUEST = prevMaxDecks;
    if (prevMaxBytes === undefined)
      delete process.env.SANDBOX_MAX_BYTES_PER_GUEST;
    else process.env.SANDBOX_MAX_BYTES_PER_GUEST = prevMaxBytes;
  });

  it('deletes expired ephemeral decks, spares fresh and organization decks', async () => {
    const expired = await insertDeck(db, { agedHours: 48, title: 'expired' });
    const fresh = await insertDeck(db, { agedHours: 1, title: 'fresh' });
    const curated = await insertDeck(db, {
      agedHours: 72,
      visibility: 'organization',
      title: 'seed',
    });

    const deleted = await sweepExpiredSandboxDecks();
    assert.equal(deleted, 1);

    const remaining = await db
      .selectFrom('presentations')
      .select('id')
      .execute();
    const ids = remaining.map((r) => r.id).sort();
    assert.deepEqual(ids, [fresh, curated].sort());
    assert.ok(!ids.includes(expired));
  });

  it('cascades: an expired deck takes its versions and published entry with it', async () => {
    const expired = await insertDeck(db, { agedHours: 48 });

    await db
      .insertInto('presentation_versions')
      .values({
        presentation_id: expired,
        organization_id: getDefaultOrganizationId(),
        presentation_data: JSON.stringify({ slides: [] }),
      })
      .execute();
    await db
      .insertInto('published_presentations')
      .values({
        id: 'pub123',
        presentation_id: expired,
        organization_id: getDefaultOrganizationId(),
        title: 'Published',
      })
      .execute();

    const deleted = await sweepExpiredSandboxDecks();
    assert.equal(deleted, 1);

    const versions = await db
      .selectFrom('presentation_versions')
      .select('id')
      .where('presentation_id', '=', expired)
      .execute();
    const published = await db
      .selectFrom('published_presentations')
      .select('id')
      .where('presentation_id', '=', expired)
      .execute();
    assert.equal(versions.length, 0, 'version snapshots cascade-deleted');
    assert.equal(published.length, 0, 'published entry cascade-deleted');
  });

  it('counts a guest’s decks and bytes, scoped to the org and case-insensitive', async () => {
    const bigSlides = [
      { id: 's1', type: 'text', content: { body: 'x'.repeat(5000) } },
    ];
    await insertDeck(db, {
      ownerEmail: 'alice@example.com',
      slides: bigSlides,
    });
    await insertDeck(db, {
      ownerEmail: 'ALICE@example.com',
      slides: bigSlides,
    });
    await insertDeck(db, { ownerEmail: 'bob@example.com' });

    const alice = await getSandboxUsageForOwner(ctx, 'alice@example.com');
    assert.equal(alice.deckCount, 2, 'owner match is case-insensitive');
    assert.ok(alice.totalBytes > 0, 'stored bytes summed');

    const bob = await getSandboxUsageForOwner(ctx, 'Bob@Example.com');
    assert.equal(bob.deckCount, 1);

    const total = await getSandboxTotalBytes(ctx);
    assert.ok(
      total >= alice.totalBytes + bob.totalBytes - 1,
      'global total sums all decks',
    );
  });

  it('refuses a mint past the per-guest deck-count cap with a typed 429', async () => {
    process.env.SANDBOX_MAX_DECKS_PER_GUEST = '2';
    await insertDeck(db, { ownerEmail: 'cap@example.com' });

    // Under the cap: no throw.
    await assertSandboxQuotaForCreate(ctx, 'cap@example.com');

    await insertDeck(db, { ownerEmail: 'cap@example.com' });

    // At the cap: typed error.
    await assert.rejects(
      () => assertSandboxQuotaForCreate(ctx, 'cap@example.com'),
      (err) => {
        assert.ok(err instanceof SandboxQuotaError);
        assert.equal(err.statusCode, 429);
        assert.equal(err.code, 'sandbox_quota_exceeded');
        assert.equal(err.details?.limit, 2);
        return true;
      },
    );
  });

  it('refuses a mint when stored bytes already exceed the per-guest byte cap', async () => {
    process.env.SANDBOX_MAX_BYTES_PER_GUEST = '100'; // 100 bytes: any real deck trips it
    await insertDeck(db, {
      ownerEmail: 'heavy@example.com',
      slides: [{ id: 's1', type: 'text', content: { body: 'y'.repeat(5000) } }],
    });

    await assert.rejects(
      () => assertSandboxQuotaForCreate(ctx, 'heavy@example.com'),
      (err) => {
        assert.ok(err instanceof SandboxQuotaError);
        assert.equal(err.code, 'sandbox_quota_exceeded');
        assert.ok('limitBytes' in (err.details || {}));
        return true;
      },
    );
  });

  it('is a no-op without an owner email or outside sandbox mode', async () => {
    process.env.SANDBOX_MAX_DECKS_PER_GUEST = '1';
    await insertDeck(db, { ownerEmail: 'nobody@example.com' });

    // No owner: nothing to attribute, so no gate.
    await assertSandboxQuotaForCreate(ctx, null);
    await assertSandboxQuotaForCreate(ctx, '');

    // Sandbox off: the gate is inert even over the cap.
    process.env.SANDBOX_MODE = '0';
    await assertSandboxQuotaForCreate(ctx, 'nobody@example.com');
    process.env.SANDBOX_MODE = '1';
  });
});
