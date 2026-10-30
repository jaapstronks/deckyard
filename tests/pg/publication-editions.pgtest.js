/**
 * T1.3: series, immutable editions and one atomic publish, against real
 * PostgreSQL. One block per acceptance line of
 * `docs/plans/briefs/publication-records.md` § T1.3:
 *
 *   1. Two concurrent publishes of one deck get two version numbers, and the
 *      second really waits on the first's series lock.
 *   2. An identical retry (sequential and concurrent) leaves one edition.
 *   3. The same key with another request is refused, on the same deck and
 *      on another one.
 *   4. A failure before commit leaves no visible edition, no used number,
 *      and staging the sweep can remove.
 *   5. Deck edits, version prune and deck deletion leave editions unchanged;
 *      the database itself refuses an UPDATE of an edition.
 *   6. Organization B cannot write a series of A.
 *   7. Asset bytes stay with the edition after the upload is gone.
 *
 * Run with: DATABASE_URL=postgres://…/deckyard_pg_tests npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 't1-3-editions-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.MEDIA_STORAGE_MODE = 'local';
// The fixtures are not real images; sealing is under test, not compression.
process.env.EXPORT_IMAGE_COMPRESSION = 'false';
delete process.env.SANDBOX_MODE;

const repoRoot = process.cwd();
const { sql, __setTestDb } = await import('../../server/db/client.js');
const { openTestDb, closeTestDb, installFacadeStorage, pgDescribe, truncate } =
  await import('./helpers/harness.js');
const { seedDefaultOrganization, seedPresentation } =
  await import('./helpers/seed.js');
const { initializeMediaProvider } = await import('../../server/media/index.js');
const { buildRendererBundle } =
  await import('../../scripts/build-renderer-bundle.js');
const { verifyEditionInput, sha256Hex } =
  await import('../../server/render/renderer-bundle/index.js');
const { publishEdition, editionRequestHash } =
  await import('../../server/services/publish-edition.js');
const {
  commitEdition,
  deleteAbandonedEditionStaging,
  getEdition,
  stageEditionInput,
} = await import('../../server/storage/editions.js');
const { prepareEditionInput } =
  await import('../../server/export/edition-input.js');
const {
  createPresentationVersion,
  getPresentation,
  prunePresentationVersions,
  updatePresentation,
} = await import('../../server/storage/presentations/index.js');
const { permanentlyDeletePresentation } =
  await import('../../server/services/permanent-delete.js');
const { loadThemeAssets } = await import('../../server/utils/themes.js');
const { initializeThemeSeeds } =
  await import('../../server/utils/theme-seeds.js');

const PNG = Buffer.from('t1-3-photo-bytes-not-a-real-png');
const ORG_B = '00000000-0000-0000-0000-0000000000b3';
const deferred = () => Promise.withResolvers();

const slides = () => [
  {
    id: 's1',
    type: 'title-slide',
    content: { title: 'Edition title', subheading: 'Sub' },
    notes: 'Private speaker note',
  },
  {
    id: 's2',
    type: 'image-slide',
    content: {
      title: 'Photo',
      image: '/uploads/photo-t13.png',
      alt: 'A photo',
    },
  },
];

pgDescribe('publication editions (PostgreSQL)', () => {
  let db, orgA, deckA, deckB, scopeA, scopeB, identity, rendererStore;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await initializeMediaProvider(repoRoot);
    await fs.mkdir(process.env.UPLOADS_DIR, { recursive: true });
    rendererStore = path.join(tmp, 'renderer-store');
    await buildRendererBundle({ storeDir: rendererStore });
  });
  after(async () => {
    await closeTestDb(db);
    await fs.rm(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    __setTestDb(db);
    await truncate(db, 'organizations');
    await fs.writeFile(
      path.join(process.env.UPLOADS_DIR, 'photo-t13.png'),
      PNG,
    );
    orgA = await seedDefaultOrganization(db);
    await initializeThemeSeeds();
    await db
      .insertInto('organizations')
      .values({ id: ORG_B, name: 'Org B', slug: 'org-b' })
      .execute();
    const { id: userId } = await db
      .insertInto('users')
      .values({ organization_id: orgA, email: 'author@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();
    deckA = await seedPresentation(db, { title: 'Deck A', slides: slides() });
    deckB = await seedPresentation(db, {
      organizationId: ORG_B,
      title: 'Deck B',
      slides: slides(),
    });
    scopeA = { repoRoot, organizationId: orgA };
    scopeB = { repoRoot, organizationId: ORG_B };
    identity = {
      actor: { id: userId, email: 'author@example.com', unrestricted: true },
    };
  });

  const revisionOf = async (id, scope = scopeA) =>
    Number((await getPresentation(scope, id)).revision);
  const publish = async (key, { scope = scopeA, id = deckA, rev } = {}) =>
    publishEdition(
      scope,
      identity,
      {
        presentationId: id,
        expectedRevision: rev ?? (await revisionOf(id, scope)),
        idempotencyKey: key,
      },
      { rendererStore },
    );
  const count = async (table) =>
    Number(
      (
        await db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
  const caught = (promise) =>
    promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  /** A staged input for the storage-level proofs. */
  const stage = async (scope = scopeA, id = deckA) => {
    const pres = await getPresentation(scope, id);
    const theme = await loadThemeAssets(repoRoot, pres.theme, scope);
    const prepared = await prepareEditionInput(repoRoot, pres, {
      scope,
      theme,
    });
    const { stagingId } = await stageEditionInput(scope, {
      presentationId: id,
      ...prepared,
    });
    return { stagingId, pres, prepared };
  };
  const commitArgs = (stagingId, key, rev = 1) => ({
    presentationId: deckA,
    stagingId,
    sourceRevision: rev,
    rendererHash: 'a'.repeat(64),
    idempotencyKey: key,
    requestHash: editionRequestHash({
      presentationId: deckA,
      expectedRevision: rev,
    }),
  });

  /**
   * Pause exactly one real transaction after its work, before its commit,
   * and report its backend pid. With `fail`, roll it back instead.
   */
  function pauseCommit({ fail = false } = {}) {
    const entered = deferred(),
      release = deferred();
    let armed = true;
    const proxy = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction')
          return () => ({
            execute: (fn) =>
              target.transaction().execute(async (trx) => {
                const pause = armed;
                armed = false;
                const result = await fn(trx);
                if (pause) {
                  const { rows } =
                    await sql`select pg_backend_pid() as pid`.execute(trx);
                  entered.resolve(rows[0].pid);
                  await release.promise;
                  if (fail) throw new Error('injected failure before commit');
                }
                return result;
              }),
          });
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    __setTestDb(proxy);
    return { entered: entered.promise, release: () => release.resolve() };
  }

  /** Wait until PostgreSQL itself reports a session blocked by `pid`. */
  async function waitingOn(pid) {
    for (let n = 0; n < 300; n++) {
      const { rows } = await sql`select pid from pg_stat_activity
        where datname = current_database()
        and ${pid} = any(pg_blocking_pids(pid))`.execute(db);
      if (rows.length) return;
      await delay(10);
    }
    assert.fail('the competing publish never waited on the series lock');
  }

  it('publishes a verifiable edition with its assets and local delivery', async () => {
    const { replayed, edition } = await publish('key-1');
    assert.equal(replayed, false);
    assert.equal(edition.version, 1);
    assert.equal(edition.sourceRevision, await revisionOf(deckA));
    assert.match(edition.rendererHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(edition.delivery, {
      destination: 'local',
      status: 'delivered',
      receipt: { editionId: edition.id, manifestHash: edition.manifestHash },
    });

    const stored = await getEdition(scopeA, edition.publicationId, 1);
    assert.deepEqual(
      verifyEditionInput({
        manifestBytes: stored.manifestBytes,
        inputBytes: stored.inputBytes,
      }),
      { ok: true, problems: [] },
    );
    assert.equal(stored.manifestHash, sha256Hex(stored.manifestBytes));
    const manifest = JSON.parse(stored.manifestBytes.toString('utf8'));
    assert.deepEqual(stored.assets, manifest.assets);
    assert.ok(
      stored.assets.some((a) => a.sha256 === sha256Hex(PNG)),
      'the uploaded photo is in the closed asset set',
    );
    assert.ok(!stored.inputBytes.includes('Private speaker note'));

    const audit = await db
      .selectFrom('publication_edition_audit')
      .select('actor_user_id')
      .executeTakeFirstOrThrow();
    assert.equal(audit.actor_user_id, identity.actor.id);
    assert.equal(await count('publication_staging'), 0);
  });

  it('gives two concurrent publishes of one deck two numbers, the second waiting on the first', async () => {
    const rev = await revisionOf(deckA);
    const first = await stage();
    const second = await stage();
    const gate = pauseCommit();
    const a = caught(
      commitEdition(scopeA, commitArgs(first.stagingId, 'c-1', rev)),
    );
    const pid = await gate.entered;
    __setTestDb(db);
    const b = caught(
      commitEdition(scopeA, commitArgs(second.stagingId, 'c-2', rev)),
    );
    await waitingOn(pid);
    gate.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.ifError(ra.error);
    assert.ifError(rb.error);
    assert.deepEqual(
      [ra.value.edition.version, rb.value.edition.version],
      [1, 2],
    );

    // And through the whole service, without a gate: still unique.
    const results = await Promise.all(
      ['p-1', 'p-2', 'p-3'].map((key) => publish(key, { rev })),
    );
    assert.deepEqual(results.map((r) => r.edition.version).sort(), [3, 4, 5]);
    const series = await db
      .selectFrom('publications')
      .select('last_version')
      .executeTakeFirstOrThrow();
    assert.equal(series.last_version, 5);
  });

  it('answers an identical retry with the first edition, also when both arrive at once', async () => {
    const first = await publish('retry-key');
    const again = await publish('retry-key');
    assert.equal(again.replayed, true);
    assert.deepEqual(again.edition, first.edition);

    // A retry after the deck moved on still asks for what it asked then.
    await updatePresentation(scopeA, deckA, { title: 'Edited' }, {});
    const late = await publish('retry-key', {
      rev: first.edition.sourceRevision,
    });
    assert.equal(late.replayed, true);
    assert.equal(late.edition.id, first.edition.id);

    // Two identical requests in flight: one edition, one replay.
    const rev = await revisionOf(deckA);
    const both = await Promise.all([
      publish('twin', { rev }),
      publish('twin', { rev }),
    ]);
    assert.deepEqual(both.map((r) => r.replayed).sort(), [false, true]);
    assert.equal(both[0].edition.id, both[1].edition.id);
    assert.equal(await count('publication_editions'), 2);
    assert.equal(await count('publication_deliveries'), 2);
  });

  it('refuses the same key for a different request, on this deck and on another', async () => {
    await publish('k');
    await updatePresentation(scopeA, deckA, { title: 'Edited' }, {});
    const changed = await caught(publish('k'));
    assert.equal(changed.error?.code, 'idempotency_key_reused');
    assert.equal(changed.error?.statusCode, 409);

    const otherDeck = await seedPresentation(db, {
      title: 'Deck A2',
      slides: slides(),
    });
    const other = await caught(publish('k', { id: otherDeck }));
    assert.equal(other.error?.code, 'idempotency_key_reused');

    // Under the lock too: a commit carrying a reused key is refused.
    const { stagingId } = await stage();
    const raw = await caught(
      commitEdition(scopeA, {
        ...commitArgs(stagingId, 'k', 999),
      }),
    );
    assert.equal(raw.error?.code, 'idempotency_key_reused');
    assert.equal(await count('publication_editions'), 1);
  });

  it('orders the same key on two decks by the unique index, and drops the loser staging', async () => {
    const otherDeck = await seedPresentation(db, {
      title: 'Deck A3',
      slides: slides(),
    });
    const first = await stage();
    const second = await stage(scopeA, otherDeck);
    const gate = pauseCommit();
    const winner = commitEdition(scopeA, commitArgs(first.stagingId, 'race'));
    const pid = await gate.entered;
    // Another series lock, so only the unique key index makes it wait.
    const loser = caught(
      commitEdition(scopeA, {
        ...commitArgs(second.stagingId, 'race'),
        presentationId: otherDeck,
        requestHash: editionRequestHash({
          presentationId: otherDeck,
          expectedRevision: 1,
        }),
      }),
    );
    await waitingOn(pid);
    gate.release();
    assert.equal((await winner).edition.version, 1);
    const { error } = await loser;
    assert.equal(error?.code, 'idempotency_key_reused');
    __setTestDb(db);

    assert.equal(await count('publication_editions'), 1);
    assert.equal(await count('publication_staging'), 0, 'loser staging gone');
  });

  it('refuses a stale revision before preparing anything', async () => {
    const rev = await revisionOf(deckA);
    await updatePresentation(scopeA, deckA, { title: 'Moved on' }, {});
    const stale = await caught(publish('stale', { rev }));
    assert.equal(stale.error?.code, 'conflict');
    assert.equal(await count('publication_staging'), 0);
    assert.equal(await count('publications'), 0);
  });

  it('leaves nothing visible when the commit fails, and staging the sweep removes', async () => {
    const { stagingId } = await stage();
    const gate = pauseCommit({ fail: true });
    const pending = caught(commitEdition(scopeA, commitArgs(stagingId, 'f-1')));
    await gate.entered;
    // Inside the open transaction the edition exists; outside it does not.
    assert.equal(await count('publication_editions'), 0);
    assert.equal(await count('publication_deliveries'), 0);
    gate.release();
    const { error } = await pending;
    assert.match(error?.message || '', /injected failure/);
    __setTestDb(db);

    assert.equal(await count('publication_editions'), 0);
    assert.equal(await count('publication_edition_assets'), 0);
    assert.equal(await count('publication_edition_audit'), 0);
    assert.equal(await count('publication_deliveries'), 0);
    assert.equal(
      await count('publications'),
      0,
      'the series insert rolled back too',
    );
    assert.equal(await count('publication_staging'), 1);

    // A fresh row survives the sweep; an abandoned one does not.
    const now = new Date().toISOString();
    assert.deepEqual(
      await deleteAbandonedEditionStaging(
        { repoRoot, crossOrganization: 'test' },
        new Date(Date.now() - 60_000).toISOString(),
      ),
      { deleted: 0 },
    );
    assert.deepEqual(
      await deleteAbandonedEditionStaging(scopeB, now),
      { deleted: 0 },
      'one organization sweeps only its own staging',
    );
    assert.deepEqual(
      await deleteAbandonedEditionStaging(
        { repoRoot, crossOrganization: 'test' },
        now,
      ),
      { deleted: 1 },
    );

    // The swept input cannot be committed; a fresh publish takes number 1.
    const gone = await caught(
      commitEdition(scopeA, commitArgs(stagingId, 'f-1')),
    );
    assert.equal(gone.error?.code, 'edition_staging_missing');
    const { edition } = await publish('f-2');
    assert.equal(edition.version, 1);
  });

  it('keeps editions unchanged through edits, version prune and deck deletion', async () => {
    const { edition } = await publish('keep');
    const before = await getEdition(scopeA, edition.publicationId, 1);

    await updatePresentation(scopeA, deckA, { title: 'Rewritten' }, {});
    const pres = await getPresentation(scopeA, deckA);
    for (let i = 0; i < 3; i++) {
      await createPresentationVersion(scopeA, deckA, pres, { reason: 'test' });
    }
    await prunePresentationVersions(scopeA, deckA, { keep: 1 });
    await fs.rm(path.join(process.env.UPLOADS_DIR, 'photo-t13.png'));

    await db
      .updateTable('presentations')
      .set({ trashed_at: new Date(Date.now() - 1000).toISOString() })
      .where('id', '=', deckA)
      .execute();
    const purged = await permanentlyDeletePresentation({
      repoRoot,
      storageScope: scopeA,
      id: deckA,
    });
    assert.deepEqual(purged, { ok: true });

    const afterAll = await getEdition(scopeA, edition.publicationId, 1);
    assert.deepEqual(afterAll, before);
    assert.ok(
      afterAll.inputBytes.includes(PNG.toString('base64')),
      'the photo bytes stay with the edition after the upload is gone',
    );
    const series = await db
      .selectFrom('publications')
      .select(['id', 'presentation_id'])
      .executeTakeFirstOrThrow();
    assert.equal(series.id, edition.publicationId);
    assert.equal(series.presentation_id, null, 'only the deck reference goes');

    const rewrite = await caught(
      db
        .updateTable('publication_editions')
        .set({ version: 7 })
        .where('id', '=', edition.id)
        .execute(),
    );
    assert.match(rewrite.error?.message || '', /immutable/);
  });

  it('does not let organization B write a series of A', async () => {
    const { edition } = await publish('a-1');

    const viaService = await caught(
      publish('b-1', { scope: scopeB, id: deckA, rev: 1 }),
    );
    assert.equal(viaService.error?.statusCode, 404);

    const staged = await caught(
      stageEditionInput(scopeB, {
        presentationId: deckA,
        ...(await stage()).prepared,
      }),
    );
    assert.equal(staged.error?.statusCode, 404);

    // B's own staging, aimed at A's deck: the series lookup is B's only.
    const own = await stage(scopeB, deckB);
    const crossed = await caught(
      commitEdition(scopeB, {
        ...commitArgs(own.stagingId, 'b-2'),
        presentationId: deckA,
      }),
    );
    assert.equal(crossed.error?.statusCode, 404);

    assert.equal(await getEdition(scopeB, edition.publicationId, 1), null);
    const series = await db.selectFrom('publications').selectAll().execute();
    assert.equal(series.length, 1);
    assert.equal(series[0].organization_id, orgA);
    assert.equal(series[0].last_version, 1);

    // B's own deck publishes into its own series, with its own numbering.
    const mine = await publish('b-3', { scope: scopeB, id: deckB });
    assert.equal(mine.edition.version, 1);
    assert.notEqual(mine.edition.publicationId, edition.publicationId);
  });

  it('refuses an actor who may not write the deck', async () => {
    const reader = {
      actor: {
        id: crypto.randomUUID(),
        email: 'reader@example.com',
        organizationId: orgA,
      },
    };
    const refused = await caught(
      publishEdition(
        scopeA,
        reader,
        {
          presentationId: deckA,
          expectedRevision: await revisionOf(deckA),
          idempotencyKey: 'r-1',
        },
        { rendererStore },
      ),
    );
    assert.ok([403, 404].includes(refused.error?.statusCode));
    assert.equal(await count('publications'), 0);
  });
});
