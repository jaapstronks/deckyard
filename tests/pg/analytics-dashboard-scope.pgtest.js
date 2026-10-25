/**
 * The analytics dashboard's decks, against real PostgreSQL (B825, D358).
 *
 * The dashboard used to read the decks it covers into JavaScript
 * (`getUserPresentationIds`) and send them back to every aggregation as
 * `IN (...)`. Now one SQL subquery decides it (`dashboardDeckIds` in
 * server/storage/analytics/dashboard.js), and the deck list is a keyset page.
 * The right moved from one spelling to another, so the old spelling stays
 * here as the oracle, with one term added since (B841, a revoked row gives
 * no dashboard):
 *
 *   **rights parity**: over decks the reader owns, holds as `edit`, `admin`,
 *   `view` or `comment` collaborator, held through a now revoked `edit` or
 *   `admin` row, sees
 *   only through organization visibility, owns in the trash, owns in another
 *   organization or holds there as editor, and decks without an owner address
 *   or owned under an old address, the decks the list pages through equal the
 *   oracle's for every reader (an address in another case and no address at
 *   all included), and every aggregate (summary, trend, timeline, top decks,
 *   sources, completion) equals the same aggregate over the oracle's ids.
 *
 * A trashed deck stays in; a revoked `edit`/`admin` row is out, on the
 * dashboard and in the weekly digest, which reads the same predicate (B841).
 *
 * And the six checks the deck list carries (brief `db-level-pagination.md`
 * § Checks): completeness, order, stability, org isolation, refusal and full
 * pages, through the route.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { sql } from 'kysely';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { createMockRes } from '../helpers/http-mocks.js';
import { normalizeEmail } from '../../shared/email.js';
import { handleAnalytics } from '../../server/routes/api/analytics/index.js';
import {
  getDashboardSummary,
  getDashboardTimeline,
  getSourceBreakdown,
  getTopPresentations,
  getWeeklyAnalyticsForUser,
  listDashboardPresentations,
} from '../../server/storage/analytics/index.js';
import {
  completionRate,
  getCompletionCounts,
} from '../../server/storage/analytics/aggregations.js';

const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';
const DAY = 24 * 60 * 60 * 1000;
const SOURCES = ['share_link', 'published', 'follow', 'embed'];

const READER = 'reader@example.com';
const OTHER = 'other@example.com';

/**
 * The right as it was before B825: owner by address, or a collaborator row
 * with `edit`/`admin`, both inside the organization; since B841 the row must
 * not be revoked.
 */
async function oracleDeckIds(db, userEmail, organizationId) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];
  const owned = await db
    .selectFrom('presentations')
    .select('id')
    .where('owner_email', '=', email)
    .where('organization_id', '=', organizationId)
    .execute();
  const shared = await db
    .selectFrom('presentation_collaborators')
    .innerJoin(
      'presentations',
      'presentations.id',
      'presentation_collaborators.presentation_id',
    )
    .select('presentations.id')
    .where('presentation_collaborators.user_email', '=', email)
    .where('presentations.organization_id', '=', organizationId)
    .where('presentation_collaborators.permission', 'in', ['edit', 'admin'])
    .where('presentation_collaborators.revoked_at', 'is', null)
    .execute();
  return [...new Set([...owned, ...shared].map((r) => r.id))];
}

pgDescribe('analytics dashboard decks in SQL (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgA;
  let orgB;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations', 'users', 'presentations');
    orgA = await seedDefaultOrganization(db);
    orgB = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: orgB, name: 'Other Org', slug: 'other-org' })
      .execute();
  });

  const scopeOf = (organizationId, email) => ({
    repoRoot: process.cwd(),
    organizationId,
    actorEmail: email,
  });

  async function insertDeck({
    organizationId = orgA,
    ownerEmail = null,
    visibility = 'private',
    trashed = false,
    modifiedAt = SAME_MOMENT,
  } = {}) {
    const id = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id,
        organization_id: organizationId,
        title: `Deck ${id.slice(0, 4)}`,
        visibility,
        owner_email: ownerEmail,
        created_by: ownerEmail,
        trashed_at: trashed ? SAME_MOMENT : null,
        modified_at: modifiedAt,
      })
      .execute();
    return id;
  }

  async function collaborate(presentationId, email, permission, opts = {}) {
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: presentationId,
        organization_id: opts.organizationId ?? orgA,
        user_email: email,
        permission,
        invited_by: OTHER,
        revoked_at: opts.revoked ? '2026-10-02 00:00:00+00' : null,
      })
      .execute();
  }

  /** `count` sessions on a deck, `daysAgo` days back, cycling sources. */
  async function sessions(presentationId, count, daysAgo = 2) {
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.now() - (daysAgo + i * 0.1) * DAY);
      const session = await db
        .insertInto('view_sessions')
        .values({
          presentation_id: presentationId,
          session_token: crypto.randomBytes(32).toString('hex'),
          source_type: SOURCES[i % SOURCES.length],
          viewer_type: 'anonymous',
          device_id: i % 3 ? crypto.randomUUID() : 'shared-device',
          started_at: at.toISOString(),
          last_activity_at: at.toISOString(),
          duration_seconds: 30 + i * 7,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('slide_views')
        .values(
          Array.from({ length: 1 + (i % 3) }, (_, index) => ({
            view_session_id: session.id,
            presentation_id: presentationId,
            slide_id: `s${index}`,
            slide_index: index,
            entered_at: at.toISOString(),
          })),
        )
        .execute();
    }
  }

  /**
   * Every case the right distinguishes, each deck with its own sessions (in
   * the period and a few in the period before, for the trend).
   */
  async function seedRights() {
    const decks = {
      owned: await insertDeck({ ownerEmail: READER }),
      edit: await insertDeck({ ownerEmail: OTHER }),
      admin: await insertDeck({ ownerEmail: OTHER }),
      view: await insertDeck({ ownerEmail: OTHER }),
      comment: await insertDeck({ ownerEmail: OTHER }),
      orgVisible: await insertDeck({
        ownerEmail: OTHER,
        visibility: 'organization',
      }),
      revokedEdit: await insertDeck({ ownerEmail: OTHER }),
      revokedAdmin: await insertDeck({ ownerEmail: OTHER }),
      trashedOwned: await insertDeck({ ownerEmail: READER, trashed: true }),
      noOwner: await insertDeck({ ownerEmail: null }),
      oldAddress: await insertDeck({ ownerEmail: 'reader-before@example.com' }),
      otherOrgOwned: await insertDeck({
        organizationId: orgB,
        ownerEmail: READER,
      }),
      otherOrgEdit: await insertDeck({
        organizationId: orgB,
        ownerEmail: OTHER,
      }),
    };
    await collaborate(decks.edit, READER, 'edit');
    await collaborate(decks.admin, READER, 'admin');
    await collaborate(decks.view, READER, 'view');
    await collaborate(decks.comment, READER, 'comment');
    await collaborate(decks.revokedEdit, READER, 'edit', { revoked: true });
    await collaborate(decks.revokedAdmin, READER, 'admin', { revoked: true });
    await collaborate(decks.otherOrgEdit, READER, 'edit', {
      organizationId: orgB,
    });
    // A collaborator row filed under the other organization on an org A deck:
    // the old right matched it on address and deck, not on the row's org.
    await collaborate(decks.orgVisible, OTHER, 'admin', {
      organizationId: orgB,
    });
    let n = 1;
    for (const id of Object.values(decks)) {
      await sessions(id, 2 + (n % 4));
      await sessions(id, n % 3, 40);
      n++;
    }
    return decks;
  }

  /** Walk the dashboard list to its end, `limit` decks a page. */
  async function walkList(email, organizationId = orgA, limit = 3) {
    const pages = [];
    let after = null;
    for (let guard = 0; guard < 200; guard++) {
      const { items, next } = await listDashboardPresentations(
        scopeOf(organizationId, email),
        email,
        organizationId,
        { period: '30d', limit, after },
      );
      pages.push(items);
      if (!next) return pages;
      after = next;
    }
    throw new Error('the list never ended');
  }

  /** The aggregates over an explicit id list: the old code path's result. */
  async function oracleAggregates(ids, organizationId) {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const previousSince = new Date(Date.now() - 60 * DAY).toISOString();
    if (!ids.length) {
      return {
        totalViews: 0,
        uniqueViewers: 0,
        avgDurationSeconds: 0,
        previousViews: 0,
        timelineViews: 0,
        sources: { shareLink: 0, published: 0, follow: 0, embed: 0 },
        completionRate: 0,
        topIds: [],
      };
    }
    const current = await sql`
      SELECT COUNT(id) AS views,
        COUNT(DISTINCT COALESCE(device_id, id::text)) AS unique_viewers,
        AVG(duration_seconds) AS avg_duration
      FROM view_sessions
      WHERE presentation_id = ANY(${ids}::uuid[]) AND started_at >= ${since}
    `.execute(db);
    const previous = await sql`
      SELECT COUNT(id) AS views FROM view_sessions
      WHERE presentation_id = ANY(${ids}::uuid[])
        AND started_at >= ${previousSince} AND started_at <= ${since}
    `.execute(db);
    const bySource = await sql`
      SELECT source_type, COUNT(id) AS n FROM view_sessions
      WHERE presentation_id = ANY(${ids}::uuid[]) AND started_at >= ${since}
      GROUP BY source_type
    `.execute(db);
    const top = await sql`
      SELECT presentation_id AS id FROM view_sessions
      WHERE presentation_id = ANY(${ids}::uuid[]) AND started_at >= ${since}
      GROUP BY presentation_id
      ORDER BY COUNT(id) DESC, presentation_id DESC
      LIMIT 10
    `.execute(db);
    const name = {
      share_link: 'shareLink',
      published: 'published',
      follow: 'follow',
      embed: 'embed',
    };
    const sources = { shareLink: 0, published: 0, follow: 0, embed: 0 };
    for (const row of bySource.rows) {
      sources[name[row.source_type]] = Number(row.n);
    }
    const completion = await getCompletionCounts({ organizationId }, db, ids, {
      since,
    });
    return {
      totalViews: Number(current.rows[0].views),
      uniqueViewers: Number(current.rows[0].unique_viewers),
      avgDurationSeconds: Math.round(Number(current.rows[0].avg_duration) || 0),
      previousViews: Number(previous.rows[0].views),
      timelineViews: Number(current.rows[0].views),
      sources,
      completionRate: completionRate(completion.values()),
      topIds: top.rows.map((row) => row.id),
    };
  }

  const READERS = [
    READER,
    'Reader@Example.COM',
    OTHER,
    'stranger@example.com',
    '',
  ];

  it('parity: the listed decks equal the old right, for every reader, in both organizations', async () => {
    const decks = await seedRights();
    for (const organizationId of [orgA, orgB]) {
      for (const email of READERS) {
        const expected = await oracleDeckIds(db, email, organizationId);
        const listed = (await walkList(email, organizationId))
          .flat()
          .map((row) => row.id);
        assert.deepEqual(
          [...listed].sort(),
          [...expected].sort(),
          `${email || '(no address)'} in ${organizationId === orgA ? 'A' : 'B'}`,
        );
        assert.equal(new Set(listed).size, listed.length, 'each deck once');
      }
    }

    // The cases themselves, so the oracle is not silently empty.
    const reader = new Set(await oracleDeckIds(db, READER, orgA));
    for (const key of ['owned', 'edit', 'admin', 'trashedOwned']) {
      assert.equal(reader.has(decks[key]), true, `${key} is on the dashboard`);
    }
    for (const key of [
      'view',
      'comment',
      'revokedEdit',
      'revokedAdmin',
      'orgVisible',
      'noOwner',
      'oldAddress',
      'otherOrgOwned',
      'otherOrgEdit',
    ]) {
      assert.equal(reader.has(decks[key]), false, `${key} is not`);
    }
    assert.deepEqual(
      (await oracleDeckIds(db, READER, orgB)).sort(),
      [decks.otherOrgOwned, decks.otherOrgEdit].sort(),
    );
  });

  it('parity: every aggregate equals the same aggregate over the old ids', async () => {
    await seedRights();
    for (const organizationId of [orgA, orgB]) {
      for (const email of READERS) {
        const label = `${email || '(no address)'} in ${organizationId === orgA ? 'A' : 'B'}`;
        const scope = scopeOf(organizationId, email);
        const ids = await oracleDeckIds(db, email, organizationId);
        const expected = await oracleAggregates(ids, organizationId);

        const { summary, trend } = await getDashboardSummary(
          scope,
          email,
          organizationId,
          { period: '30d' },
        );
        assert.equal(summary.totalViews, expected.totalViews, label);
        assert.equal(summary.uniqueViewers, expected.uniqueViewers, label);
        assert.equal(
          summary.avgDurationSeconds,
          expected.avgDurationSeconds,
          label,
        );
        assert.equal(summary.completionRate, expected.completionRate, label);
        const change = expected.previousViews
          ? Math.round(
              ((expected.totalViews - expected.previousViews) /
                expected.previousViews) *
                100,
            )
          : expected.totalViews
            ? 100
            : 0;
        assert.equal(trend.percentChange, Math.abs(change), label);

        const timeline = await getDashboardTimeline(
          scope,
          email,
          organizationId,
          { period: '30d' },
        );
        assert.equal(
          timeline.reduce((sum, day) => sum + day.views, 0),
          expected.timelineViews,
          label,
        );
        assert.deepEqual(
          await getSourceBreakdown(scope, email, organizationId, {
            period: '30d',
          }),
          expected.sources,
          label,
        );
        assert.deepEqual(
          (
            await getTopPresentations(scope, email, organizationId, {
              period: '30d',
              limit: 10,
            })
          ).map((row) => row.id),
          expected.topIds,
          label,
        );
      }
    }
  });

  it('parity: each listed deck carries the aggregates of its own sessions', async () => {
    await seedRights();
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    for (const row of (await walkList(READER)).flat()) {
      const own = await sql`
        SELECT COUNT(id) AS views FROM view_sessions
        WHERE presentation_id = ${row.id} AND started_at >= ${since}
      `.execute(db);
      assert.equal(row.views, Number(own.rows[0].views), row.id);
    }
  });

  it('B841: a revoked editor or admin has the deck nowhere, the weekly digest included', async () => {
    const decks = await seedRights();
    const revoked = [decks.revokedEdit, decks.revokedAdmin];
    const listed = (await walkList(READER)).flat().map((row) => row.id);
    for (const id of revoked) assert.equal(listed.includes(id), false, id);
    const top = await getTopPresentations(scopeOf(orgA, READER), READER, orgA, {
      period: '30d',
      limit: 50,
    });
    for (const id of revoked) {
      assert.equal(
        top.some((row) => row.id === id),
        false,
        id,
      );
    }

    // The digest covers exactly the dashboard's decks, for every reader.
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    for (const organizationId of [orgA, orgB]) {
      for (const email of READERS) {
        const label = `${email || '(no address)'} in ${organizationId === orgA ? 'A' : 'B'}`;
        const ids = await oracleDeckIds(db, email, organizationId);
        const weekly = await getWeeklyAnalyticsForUser(
          scopeOf(organizationId, email),
          crypto.randomUUID(),
          email,
        );
        assert.equal(weekly.presentationCount, ids.length, label);
        const views = ids.length
          ? await sql`
              SELECT COUNT(id) AS views FROM view_sessions
              WHERE presentation_id = ANY(${ids}::uuid[])
                AND started_at >= ${since}
            `.execute(db)
          : { rows: [{ views: 0 }] };
        assert.equal(weekly.totalViews, Number(views.rows[0].views), label);
        if (normalizeEmail(email) !== READER) continue;
        for (const id of revoked) {
          assert.equal(
            weekly.topPresentations.some((row) => row.id === id),
            false,
            `${label}: ${id}`,
          );
        }
      }
    }
  });

  /** GET the dashboard list route as `email` in `organizationId`. */
  async function getList(params, email = READER, organizationId = orgA) {
    const res = createMockRes();
    const search = new URLSearchParams(params).toString();
    await handleAnalytics({
      repoRoot: process.cwd(),
      storageScope: scopeOf(organizationId, email),
      authedUser: { email, organizationId },
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://x/api/analytics/presentations?${search}`),
    });
    return { status: res.statusCode, body: res.json() };
  }

  /** Walk the route to its end. */
  async function walkRoute(params, email = READER, organizationId = orgA) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 200; guard++) {
      const { status, body } = await getList(
        cursor ? { ...params, cursor } : params,
        email,
        organizationId,
      );
      assert.equal(status, 200, JSON.stringify(body));
      pages.push(body.presentations.map((row) => row.id));
      cursor = body.nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the list never ended');
  }

  /** 23 decks the reader owns, ten of them at one microsecond. */
  async function seedManyOwned(organizationId = orgA) {
    const ids = [];
    for (let i = 0; i < 23; i++) {
      ids.push(
        await insertDeck({
          organizationId,
          ownerEmail: READER,
          modifiedAt:
            i < 10
              ? SAME_MOMENT
              : `2026-10-01 12:00:00.1234${String(i).padStart(2, '0')}+00`,
        }),
      );
    }
    return ids;
  }

  it('1+2+6: every deck once, in (modified_at desc, id desc), full pages', async () => {
    await seedManyOwned();
    const pages = await walkRoute({ limit: '5' });
    const ids = pages.flat();
    const ordered = await sql`
      SELECT id FROM presentations
      WHERE organization_id = ${orgA} AND owner_email = ${READER}
      ORDER BY modified_at DESC, id DESC
    `.execute(db);
    assert.deepEqual(
      ids,
      ordered.rows.map((row) => row.id),
    );
    assert.equal(ids.length, 23);
    for (const page of pages.slice(0, -1)) assert.equal(page.length, 5);
    assert.equal(pages.at(-1).length, 3);
  });

  it('3: a deck changed at the top between pages does not move page 2', async () => {
    await seedManyOwned();
    const first = await getList({ limit: '5' });
    const second = await getList({
      limit: '5',
      cursor: first.body.nextCursor,
    });
    await insertDeck({
      ownerEmail: READER,
      modifiedAt: '2026-10-05 00:00:00+00',
    });
    const again = await getList({ limit: '5', cursor: first.body.nextCursor });
    assert.deepEqual(
      again.body.presentations.map((row) => row.id),
      second.body.presentations.map((row) => row.id),
    );
  });

  it('4: a cursor from org A used in org B only shows B decks', async () => {
    await seedManyOwned(orgA);
    const orgBDecks = await seedManyOwned(orgB);
    const first = await getList({ limit: '5' });
    const ids = [];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const { body } = await getList({ limit: '5', cursor }, READER, orgB);
      ids.push(...body.presentations.map((row) => row.id));
      cursor = body.nextCursor;
    }
    assert.ok(ids.length > 0);
    for (const id of ids) assert.equal(orgBDecks.includes(id), true, id);
  });

  it('5: limit, offset, sort and foreign cursors are refused', async () => {
    await seedManyOwned();
    const first = await getList({ limit: '5', period: '30d' });
    const otherList = Buffer.from(
      JSON.stringify({
        v: 1,
        s: 'started_desc',
        f: 'x',
        k: ['2026-10-01 12:00:00+00', crypto.randomUUID()],
      }),
    ).toString('base64url');
    for (const [params, field] of [
      [{ limit: '0' }, 'limit'],
      [{ limit: '101' }, 'limit'],
      [{ limit: 'abc' }, 'limit'],
      [{ offset: '5' }, 'offset'],
      [{ sort: 'views' }, 'sort'],
      [{ cursor: 'not-a-cursor' }, 'cursor'],
      [{ cursor: otherList }, 'cursor'],
      [{ period: '7d', cursor: first.body.nextCursor }, 'cursor'],
    ]) {
      const { status, body } = await getList(params);
      assert.equal(status, 400, JSON.stringify(params));
      assert.equal(body.error, 'invalid', JSON.stringify(params));
      assert.equal(body.details.field, field, JSON.stringify(params));
    }
  });
});
