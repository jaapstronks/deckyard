/**
 * B606: the completion rate on `/insights` and on a deck's own analytics,
 * against real PostgreSQL.
 *
 * One definition (`getCompletionCounts()` in server/storage/analytics/
 * aggregations.js): the share of sessions in the window that reached the
 * deck's last slide, where the last slide is the highest index any session of
 * that deck ever reached. The dashboard pools its decks' sessions; the per-deck
 * overview, the viewer journey and the Top Performing rows read the same
 * counts. Before B606 every one of them but the journey returned a fixed 0.
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
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import {
  getDashboardSummary,
  getPresentationAnalyticsOverview,
  getPresentationsWithAnalytics,
  getTopPresentations,
  getViewerJourneyData,
} from '../../server/storage/analytics/index.js';

const OWNER = 'owner@example.test';
const DAY = 24 * 60 * 60 * 1000;

/**
 * One viewing session that went from slide 0 up to `reached`.
 * @param {import('kysely').Kysely<any>} db
 * @param {string} presentationId
 * @param {number} reached - Highest slide index the session saw.
 * @param {number} [daysAgo=1]
 */
async function seedSession(db, presentationId, reached, daysAgo = 1) {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString();
  const session = await db
    .insertInto('view_sessions')
    .values({
      presentation_id: presentationId,
      session_token: crypto.randomBytes(32).toString('hex'),
      source_type: 'share_link',
      viewer_type: 'anonymous',
      device_id: crypto.randomUUID(),
      started_at: at,
      last_activity_at: at,
      duration_seconds: 60,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('slide_views')
    .values(
      Array.from({ length: reached + 1 }, (_, index) => ({
        view_session_id: session.id,
        presentation_id: presentationId,
        slide_id: crypto.randomUUID(),
        slide_index: index,
        entered_at: at,
      })),
    )
    .execute();
}

async function seedOwnedDeck(db, title) {
  const id = await seedPresentation(db, { title });
  await db
    .updateTable('presentations')
    .set({ owner_email: OWNER })
    .where('id', '=', id)
    .execute();
  return id;
}

pgDescribe('analytics completion rate (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let half;
  let full;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);

    // Three slides (0..2): two of four recent sessions reach the end.
    half = await seedOwnedDeck(db, 'Half');
    await seedSession(db, half, 2);
    await seedSession(db, half, 2);
    await seedSession(db, half, 1);
    await seedSession(db, half, 0);
    // Outside a 30-day window: does not count, but its slide 2 is still the end.
    await seedSession(db, half, 0, 60);

    // Every recent session finishes.
    full = await seedOwnedDeck(db, 'Full');
    await seedSession(db, full, 1);
  });

  it('the dashboard card pools all sessions of the decks', async () => {
    const { summary } = await getDashboardSummary(
      OWNER,
      getDefaultOrganizationId(),
      { period: '30d' },
    );
    // (2 + 1) completed over (4 + 1) sessions.
    assert.equal(summary.completionRate, 0.6);
  });

  it('Top Performing and the deck list carry each deck its own rate', async () => {
    const top = await getTopPresentations(OWNER, getDefaultOrganizationId(), {
      period: '30d',
    });
    const byTitle = Object.fromEntries(
      top.map((p) => [p.title, p.completionRate]),
    );
    assert.deepEqual(byTitle, { Half: 0.5, Full: 1 });

    const { presentations } = await getPresentationsWithAnalytics(
      OWNER,
      getDefaultOrganizationId(),
      { period: '30d' },
    );
    const listed = Object.fromEntries(
      presentations.map((p) => [p.title, p.completionRate]),
    );
    assert.deepEqual(listed, { Half: 0.5, Full: 1 });
  });

  it('the per-deck overview and the journey read the same definition', async () => {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const overview = await getPresentationAnalyticsOverview(half, { since });
    const journey = await getViewerJourneyData(half, { since });
    assert.equal(overview.completionRate, 0.5);
    assert.equal(journey.completionRate, 0.5);

    // Without a window the old session counts too: 2 of 5.
    const allTime = await getPresentationAnalyticsOverview(half);
    assert.equal(allTime.completionRate, 0.4);
  });

  it('a deck without slide views has a rate of 0, not an error', async () => {
    const empty = await seedOwnedDeck(db, 'Empty');
    const overview = await getPresentationAnalyticsOverview(empty);
    assert.equal(overview.completionRate, 0);
  });
});
