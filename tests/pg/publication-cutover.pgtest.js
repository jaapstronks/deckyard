/**
 * T1.5 against real PostgreSQL and a real render bundle: the one-off
 * conversion of the publications from before editions, the old links that
 * then point at the first edition, and publishing/unpublishing on editions.
 *
 * - The dry run reports what `--apply` would do, per old id, and writes
 *   nothing; a gate refusal, a deck in the trash and a deck that moved
 *   organization are blocked with their reason, never skipped.
 * - `--apply` makes one first edition per deck (two old ids of one deck share
 *   it), at the conversion time, and links each old id; a second run changes
 *   nothing; a run interrupted after the edition finishes the links without a
 *   second edition, even when the deck moved on since.
 * - The old `/p/`, `/p/…/reader` and `/embed/` addresses answer 301 to the
 *   first edition, also after a second edition exists; an unconverted id 404s.
 * - A publish fires `presentation.published` once, naming the edition; its
 *   replay fires nothing. Unpublishing revokes every edition of the series.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 't1-5-cutover-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.MEDIA_STORAGE_MODE = 'local';
process.env.EXPORT_IMAGE_COMPRESSION = 'false';
delete process.env.SANDBOX_MODE;

const repoRoot = process.cwd();
const { __setTestDb } = await import('../../server/db/client.js');
const { openTestDb, closeTestDb, installFacadeStorage, pgDescribe, truncate } =
  await import('./helpers/harness.js');
const { seedDefaultOrganization, seedPresentation } =
  await import('./helpers/seed.js');
const { initializeMediaProvider } = await import('../../server/media/index.js');
const { buildRendererBundle } =
  await import('../../scripts/build-renderer-bundle.js');
const { migrateLegacyPublications, migrationKey } =
  await import('../../server/services/publication-migration.js');
const {
  createEdition,
  getDeckPublication,
  publishEdition,
  unpublishPresentation,
} = await import('../../server/services/publish-edition.js');
const { getPublicEdition } = await import('../../server/storage/editions.js');
const { getPresentation, updatePresentation } =
  await import('../../server/storage/presentations/index.js');
const { writeAppSettings } = await import('../../server/storage/settings.js');
const { crossOrganizationScope } =
  await import('../../server/storage/scope.js');
const { handlePublished } =
  await import('../../server/routes/static/published.js');
const { initializeThemeSeeds } =
  await import('../../server/utils/theme-seeds.js');

const ORG_B = '00000000-0000-0000-0000-0000000000b5';

const slides = () => [
  { id: 's1', type: 'title-slide', content: { title: 'Cutover deck' } },
];
const unnamedPicture = () => [
  {
    id: 's1',
    type: 'image-slide',
    content: { title: 'Photo', image: '/uploads/photo-t15.png' },
  },
];

pgDescribe('publication cutover (PostgreSQL)', () => {
  let db, orgA, scopeA, rendererStore, identity;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await initializeMediaProvider(repoRoot);
    await fs.mkdir(process.env.UPLOADS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(process.env.UPLOADS_DIR, 'photo-t15.png'),
      'not-a-real-png',
    );
    rendererStore = path.join(tmp, 'renderer-store');
    await buildRendererBundle({ storeDir: rendererStore });
  });
  after(async () => {
    await closeTestDb(db);
    await fs.rm(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    __setTestDb(db);
    await truncate(db, 'organizations', 'app_settings');
    orgA = await seedDefaultOrganization(db);
    await initializeThemeSeeds();
    await db
      .insertInto('organizations')
      .values({ id: ORG_B, name: 'Org B', slug: 'org-b' })
      .execute();
    scopeA = { repoRoot, organizationId: orgA };
    const { id: userId } = await db
      .insertInto('users')
      .values({ organization_id: orgA, email: 'author@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();
    identity = {
      actor: { id: userId, email: 'author@example.com', unrestricted: true },
    };
  });

  /** An old index row, as the publish routes before T1.5 wrote it. */
  const legacy = (id, presentationId, organizationId = orgA) =>
    db
      .insertInto('published_presentations')
      .values({
        id,
        presentation_id: presentationId,
        organization_id: organizationId,
        title: 'Old',
        slug: 'old-slug',
        created_at: '2026-01-20T12:00:00.000Z',
      })
      .execute();
  const count = async (table) =>
    Number(
      (
        await db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
  const migrate = (apply) =>
    migrateLegacyPublications(repoRoot, { apply, rendererStore });
  const byId = (report) =>
    Object.fromEntries(report.rows.map((r) => [r.legacyId, r]));

  /** One GET through the old-link routes. */
  async function get(pathname) {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers = {}) {
        this.status = status;
        Object.assign(this.headers, headers);
      },
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end() {},
    };
    const url = new URL(pathname, 'http://localhost');
    const handled = await handlePublished({
      repoRoot,
      req: { method: 'GET', url: pathname, headers: {} },
      res,
      url,
    });
    return handled ? res : null;
  }

  it('the dry run reports every old id and writes nothing', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    const trashed = await seedPresentation(db, {
      title: 'Trashed',
      slides: slides(),
      trashedAt: '2026-10-01T00:00:00.000Z',
    });
    const refused = await seedPresentation(db, {
      title: 'No alt',
      slides: unnamedPicture(),
    });
    const moved = await seedPresentation(db, {
      organizationId: ORG_B,
      title: 'Moved',
      slides: slides(),
    });
    await legacy('aaaa0001', ok);
    await legacy('aaaa0002', ok);
    await legacy('bbbb0001', trashed);
    await legacy('cccc0001', refused);
    await legacy('dddd0001', moved, orgA);

    const report = await migrate(false);
    const rows = byId(report);
    assert.equal(rows.aaaa0001.outcome, 'would_convert');
    assert.equal(rows.aaaa0002.outcome, 'would_convert');
    assert.deepEqual(
      [rows.bbbb0001.outcome, rows.bbbb0001.reason],
      ['blocked', 'source_trashed'],
    );
    assert.deepEqual(
      [rows.cccc0001.outcome, rows.cccc0001.reason],
      ['blocked', 'missing_alt'],
    );
    assert.ok(rows.cccc0001.details, 'the refusal keeps its details');
    assert.deepEqual(
      [rows.dddd0001.outcome, rows.dddd0001.reason],
      ['blocked', 'organization_mismatch'],
    );
    assert.deepEqual(report.summary, { would_convert: 2, blocked: 3 });
    assert.equal(await count('publication_editions'), 0);
    assert.equal(await count('publication_legacy_links'), 0);
    assert.equal(await count('publication_staging'), 0);
  });

  it('applies once per deck, at the conversion time, and a second run changes nothing', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    const trashed = await seedPresentation(db, {
      title: 'Trashed',
      slides: slides(),
      trashedAt: '2026-10-01T00:00:00.000Z',
    });
    await legacy('aaaa0001', ok);
    await legacy('aaaa0002', ok);
    await legacy('bbbb0001', trashed);
    const before = Date.now();

    const first = byId(await migrate(true));
    assert.equal(first.aaaa0001.outcome, 'converted');
    assert.deepEqual(first.aaaa0001.edition, first.aaaa0002.edition);
    assert.equal(first.aaaa0001.edition.version, 1);
    assert.equal(first.bbbb0001.outcome, 'blocked');
    assert.equal(await count('publication_editions'), 1);
    assert.equal(await count('publication_legacy_links'), 2);

    const edition = await getPublicEdition(
      crossOrganizationScope(repoRoot, 'test'),
      first.aaaa0001.edition.publicationId,
      1,
    );
    assert.ok(
      Date.parse(edition.publishedAt) >= before - 1000,
      'no invented history: the edition is dated at the conversion',
    );

    // The deck moves on; the conversion does not follow it.
    await updatePresentation(scopeA, ok, { title: 'Edited later' }, {});
    const second = await migrate(true);
    assert.equal(byId(second).aaaa0001.outcome, 'already_linked');
    assert.deepEqual(byId(second).aaaa0001.edition, first.aaaa0001.edition);
    assert.equal(await count('publication_editions'), 1);
  });

  it('finishes the links of an interrupted run without a second edition', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    await legacy('aaaa0001', ok);
    const pres = await getPresentation(scopeA, ok);
    const { edition } = await createEdition(
      scopeA,
      pres,
      {
        expectedRevision: Number(pres.revision),
        idempotencyKey: migrationKey(ok),
      },
      { rendererStore },
    );
    await updatePresentation(scopeA, ok, { title: 'Edited meanwhile' }, {});

    const rows = byId(await migrate(true));
    assert.equal(rows.aaaa0001.outcome, 'converted');
    assert.equal(rows.aaaa0001.edition.publicationId, edition.publicationId);
    assert.equal(rows.aaaa0001.edition.version, 1);
    assert.equal(await count('publication_editions'), 1);
  });

  it('old addresses point at the first edition, also once a second exists', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    await legacy('aaaa0001', ok);
    const { publicationId } = byId(await migrate(true)).aaaa0001.edition;

    await updatePresentation(scopeA, ok, { title: 'Second edition' }, {});
    const pres = await getPresentation(scopeA, ok);
    const next = await publishEdition(
      scopeA,
      identity,
      {
        presentationId: ok,
        expectedRevision: Number(pres.revision),
        idempotencyKey: 'v2',
      },
      { rendererStore },
    );
    assert.equal(next.edition.version, 2);

    const canvas = await get('/p/aaaa0001-old-slug?lang=en&x=1');
    assert.equal(canvas.status, 301);
    assert.equal(canvas.headers.Location, `/p/${publicationId}/1?lang=en`);
    const reader = await get('/p/aaaa0001-other/reader');
    assert.equal(reader.headers.Location, `/p/${publicationId}/1/reader`);
    const embed = await get('/embed/aaaa0001');
    assert.equal(embed.headers.Location, `/embed/${publicationId}/1`);
    assert.equal((await get('/p/ffff0000-nothing')).status, 404);
  });

  it('a publish announces its edition once; unpublishing revokes the series', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    await writeAppSettings(scopeA, {
      webhooks: { presentationPublishedUrl: 'http://203.0.114.3/hook' },
    });
    const posted = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      posted.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    };
    try {
      const rev = Number((await getPresentation(scopeA, ok)).revision);
      const request = {
        presentationId: ok,
        expectedRevision: rev,
        idempotencyKey: 'once',
      };
      const first = await publishEdition(scopeA, identity, request, {
        rendererStore,
      });
      const replay = await publishEdition(scopeA, identity, request, {
        rendererStore,
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.edition.id, first.edition.id);
      // The webhook is fire-and-forget; let it land.
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(posted.length, 1, 'a replay announces nothing');
      assert.equal(posted[0].body.edition.id, first.edition.id);
      assert.equal(posted[0].body.edition.version, 1);
      assert.equal(posted[0].body.presentation.published.version, 1);
    } finally {
      globalThis.fetch = realFetch;
    }

    const pres = await getPresentation(scopeA, ok);
    assert.equal((await getDeckPublication(scopeA, pres)).version, 1);
    const { revoked } = await unpublishPresentation(scopeA, identity, ok);
    assert.equal(revoked.length, 1);
    assert.equal(await getDeckPublication(scopeA, pres), null);
    const after = await getPublicEdition(
      crossOrganizationScope(repoRoot, 'test'),
      revoked[0].publicationId,
      1,
    );
    assert.ok(after.revokedAt);
  });

  it('scopes keys to the actor, refuses a stale revision, and shows the newest public edition', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    const { id: otherId } = await db
      .insertInto('users')
      .values({ organization_id: orgA, email: 'second@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const second = {
      actor: { id: otherId, email: 'second@example.com', unrestricted: true },
    };
    const rev = Number((await getPresentation(scopeA, ok)).revision);
    const request = { presentationId: ok, expectedRevision: rev };
    const a = await publishEdition(
      scopeA,
      identity,
      { ...request, idempotencyKey: '1' },
      { rendererStore },
    );
    const b = await publishEdition(
      scopeA,
      second,
      { ...request, idempotencyKey: '1' },
      { rendererStore },
    );
    assert.deepEqual(
      [a.edition.version, b.edition.version],
      [1, 2],
      'two users with key 1 publish two editions',
    );

    const stale = await publishEdition(
      scopeA,
      identity,
      { ...request, expectedRevision: rev - 1 || rev + 1, idempotencyKey: 's' },
      { rendererStore },
    ).then(
      () => null,
      (e) => e,
    );
    assert.equal(stale?.code, 'conflict');
    assert.equal(stale?.statusCode, 409);

    // The newest edition revoked: the deck shows the one before it.
    await db
      .insertInto('publication_edition_revocations')
      .values({ edition_id: b.edition.id, organization_id: orgA })
      .execute();
    const pres = await getPresentation(scopeA, ok);
    const shown = await getDeckPublication(scopeA, pres);
    assert.equal(shown.version, 1);
    assert.equal(shown.path, `/p/${a.edition.publicationId}/1`);
  });

  it('refuses a read-only actor and a deck of another organization', async () => {
    const ok = await seedPresentation(db, { title: 'Ok', slides: slides() });
    const foreign = await seedPresentation(db, {
      organizationId: ORG_B,
      title: 'Foreign',
      slides: slides(),
    });
    const { id: readerId } = await db
      .insertInto('users')
      .values({ organization_id: orgA, email: 'reader@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const reader = {
      actor: { id: readerId, email: 'reader@example.com' },
    };
    const attempt = (scope, who, id) =>
      publishEdition(
        scope,
        who,
        { presentationId: id, expectedRevision: 1, idempotencyKey: 'x' },
        { rendererStore },
      ).then(
        () => null,
        (e) => e,
      );
    const readOnly = await attempt(scopeA, reader, ok);
    assert.equal(readOnly?.statusCode, 403);
    const crossOrg = await attempt(scopeA, identity, foreign);
    assert.equal(crossOrg?.statusCode, 404);
    assert.equal(await count('publication_editions'), 0);
  });
});
