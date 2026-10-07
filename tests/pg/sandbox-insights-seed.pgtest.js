/**
 * B353: opening a sandbox example fills the guest's insights, against real
 * PostgreSQL.
 *
 * `POST /api/sandbox/examples/:id` imports the example as the guest's own deck
 * and writes the viewing history the example declares
 * (server/sandbox/analytics.js). This pins that the guest's dashboard and the
 * deck's own analytics read non-zero afterwards, and that a normal install
 * neither has the route nor lets the storage writer put a single row down.
 */

import { after, before, beforeEach, it } from 'node:test';
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
import { initializeThemeSeeds } from '../../server/utils/theme-seeds.js';
import { repoRoot } from '../../server/config/paths.js';
import { handleSandbox } from '../../server/routes/api/sandbox.js';
import {
  getDashboardSummary,
  getDashboardTimeline,
  getPresentationAnalyticsOverview,
  insertSeededViewSessions,
} from '../../server/storage/analytics/index.js';

const GUEST = `guest-${crypto.randomBytes(16).toString('hex')}@sandbox.local`;
const scope = () => ({
  organizationId: getDefaultOrganizationId(),
  actorEmail: GUEST,
});

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    headersSent: false,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
}

async function openExample(id) {
  const res = fakeRes();
  await handleSandbox({
    repoRoot,
    storageScope: scope(),
    req: { method: 'POST', headers: {} },
    res,
    url: new URL(`http://test.local/api/sandbox/examples/${id}`),
    authedUser: {
      email: GUEST,
      organizationId: getDefaultOrganizationId(),
      isAdmin: false,
    },
  });
  return res;
}

pgDescribe('sandbox insights seed (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let prevSandboxMode;

  before(async () => {
    db = await openTestDb();
    prevSandboxMode = process.env.SANDBOX_MODE;
  });

  after(async () => {
    if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxMode;
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await initializeThemeSeeds();
  });

  it('a guest who opens an example sees a filled dashboard', async () => {
    process.env.SANDBOX_MODE = '1';
    const res = await openExample('meet-deckyard');
    assert.equal(res.statusCode, 201, res.body);
    const deck = JSON.parse(res.body);

    const { summary, trend } = await getDashboardSummary(
      GUEST,
      getDefaultOrganizationId(),
      { period: '30d' },
    );
    assert.ok(summary.totalViews > 0, 'views in the last 30 days');
    assert.ok(summary.uniqueViewers > 0);
    assert.ok(summary.uniqueViewers < summary.totalViews, 'some come back');
    assert.ok(summary.avgDurationSeconds > 0);
    assert.notEqual(trend.direction, 'flat');

    const timeline = await getDashboardTimeline(
      GUEST,
      getDefaultOrganizationId(),
      { period: '7d' },
    );
    assert.ok(timeline.length > 0, 'the last week has a line');

    const overview = await getPresentationAnalyticsOverview(deck.id);
    assert.ok(overview.totalViews > 0, 'the deck has its own analytics');

    const stray = await db
      .selectFrom('slide_views')
      .select('slide_id')
      .where('presentation_id', '=', deck.id)
      .execute();
    const ids = new Set(deck.slides.map((s) => s.id));
    assert.ok(stray.length > 0);
    assert.ok(
      stray.every((row) => ids.has(row.slide_id)),
      'every slide view names a slide of the copy',
    );
  });

  it('an unknown example is a 404 and writes nothing', async () => {
    process.env.SANDBOX_MODE = '1';
    const res = await openExample('no-such-example');
    assert.equal(res.statusCode, 404);
    const rows = await db.selectFrom('view_sessions').select('id').execute();
    assert.equal(rows.length, 0);
  });

  it('a normal install has no route and its writer puts nothing down', async () => {
    delete process.env.SANDBOX_MODE;
    const res = await openExample('meet-deckyard');
    assert.equal(res.statusCode, 404);

    const id = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id,
        organization_id: getDefaultOrganizationId(),
        owner_email: GUEST,
        title: 'Deck',
        slides: JSON.stringify([{ id: 's1', type: 'title-slide' }]),
      })
      .execute();
    const now = new Date().toISOString();
    const written = await insertSeededViewSessions(scope(), id, [
      {
        startedAt: now,
        endedAt: now,
        durationSeconds: 1,
        sourceType: 'share_link',
        deviceId: 'd',
        exitSlideId: 's1',
        exitSlideIndex: 0,
        slideViews: [],
      },
    ]);
    assert.deepEqual(written, { sessions: 0 });
    const rows = await db.selectFrom('view_sessions').select('id').execute();
    assert.equal(rows.length, 0);
  });
});
