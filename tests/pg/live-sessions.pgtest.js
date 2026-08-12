/**
 * Present-session storage against real PostgreSQL.
 *
 * Sessions used to be one JSON file each under `dataDir()/live-sessions/`,
 * read once per process (the `loadedRoots` guard in the old `disk.js`). This
 * suite covers what that arrangement could not do, so it has to be a *real*
 * database: the row is the shared substrate.
 *
 * "A second process" is modelled by clearing the in-memory `sessions` map. That
 * is exactly what a cold worker has — no map entries, the same table — so a
 * lookup that still resolves proves it went through Postgres. It also models a
 * restart, which is the other half of the acceptance test.
 *
 * The `presentation_id` foreign key is real here (migration 060 made it NOT
 * NULL and cascading), so every test seeds an organization and a deck rather
 * than the bare string ids the file suite tolerated.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { sessions } from '../../server/storage/live-sessions/state.js';
import {
  createLiveSession,
  getLiveSession,
  findMostRecentSessionForPresentation,
} from '../../server/storage/live-sessions/sessions.js';
import { getFollowStateForPresentation } from '../../server/storage/live-sessions/follow-state.js';
import { updateLiveSessionState } from '../../server/storage/live-sessions/sse.js';
import { setLiveSessionControlEnabled } from '../../server/storage/live-sessions/control.js';
import { closeSession } from '../../server/storage/live-sessions/close.js';
import { persistSession, sweepExpiredSessions } from '../../server/storage/live-sessions/db.js';
import { TTL_MS } from '../../server/storage/live-sessions/constants.js';

/** Drop everything this process holds: the state a fresh worker starts from. */
function coldStart() {
  for (const s of sessions.values()) {
    if (s?.persistTimer) clearTimeout(s.persistTimer);
  }
  sessions.clear();
}

pgDescribe('live-session storage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let presentationId;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    coldStart();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    coldStart();
    await truncate(db, 'organizations', 'presentations', 'present_sessions', 'follow_codes');
    await seedDefaultOrganization(db);
    presentationId = await seedPresentation(db, { title: 'Live deck' });
  });

  it('writes a row on create, with the deck, state and follow codes', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    assert.ok(created?.sessionId);

    const row = await db
      .selectFrom('present_sessions')
      .selectAll()
      .where('session_id', '=', created.sessionId)
      .executeTakeFirstOrThrow();

    assert.equal(row.presentation_id, presentationId);
    assert.equal(row.control_enabled, false);
    // jsonb reads back parsed, not as a string.
    assert.equal(typeof row.state, 'object');
    assert.equal(row.state.slideIndex, 0);
    assert.deepEqual(row.follow_codes, created.followCodes);
    assert.equal(Object.keys(created.followCodes).length, 2, 'nl + en minted');
    assert.ok(row.follow_codes_created_at, 'the follow-code age survives a restart');
  });

  it('finds a session created by another process', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    coldStart();

    const session = await getLiveSession(testScope(), created.sessionId);
    assert.ok(session, 'a cold process resolves the session from the table');
    assert.equal(session.presentationId, presentationId);
    assert.equal(session.clients.size, 0, 'its SSE clients stay process-local');
  });

  it('carries live slide state across a restart', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    await updateLiveSessionState(testScope(), created.sessionId, {
      slideId: 's3',
      slideIndex: 2,
      slideType: 'poll-slide',
      stepIdx: 1,
      stepParagraphs: true,
      updatedAt: Date.now(),
    });
    // The write is debounced; flush it the way the process would.
    await persistSession(sessions.get(created.sessionId));
    coldStart();

    const session = await getLiveSession(testScope(), created.sessionId);
    assert.equal(session.state.slideId, 's3');
    assert.equal(session.state.slideIndex, 2);
    assert.equal(session.state.slideType, 'poll-slide');
    assert.equal(session.state.stepIdx, 1);
    assert.equal(session.state.stepParagraphs, true);
  });

  it('carries the remote-control flag across a restart', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    setLiveSessionControlEnabled(testScope(), created.sessionId, true);
    await persistSession(sessions.get(created.sessionId));
    coldStart();

    const session = await getLiveSession(testScope(), created.sessionId);
    assert.equal(session.controlEnabled, true);
  });

  it('reports the follow state to a process that never saw the session', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    await updateLiveSessionState(testScope(), created.sessionId, {
      slideId: 's2',
      slideIndex: 1,
      updatedAt: Date.now(),
    });
    await persistSession(sessions.get(created.sessionId));
    coldStart();

    const state = await getFollowStateForPresentation(testScope(), presentationId);
    assert.equal(state.status, 'live');
    assert.equal(state.sessionId, created.sessionId);
    assert.equal(state.slideId, 's2');
    assert.equal(state.slideIndex, 1);

    const best = await findMostRecentSessionForPresentation(testScope(), presentationId);
    assert.equal(best?.sessionId, created.sessionId);
  });

  it('resumes the stored session instead of minting a second one', async () => {
    const first = await createLiveSession(testScope(), { presentationId });
    coldStart();

    const second = await createLiveSession(testScope(), { presentationId });
    assert.equal(second.sessionId, first.sessionId, 'a cold process resumes, not duplicates');

    const rows = await db.selectFrom('present_sessions').select('session_id').execute();
    assert.equal(rows.length, 1);
  });

  it('keeps the newer copy when memory and table disagree', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    // A stale row: the table lags the live object between debounced writes.
    await db
      .updateTable('present_sessions')
      .set({
        state: JSON.stringify({ slideId: 'stale', slideIndex: 9, updatedAt: 1 }),
        last_activity_at: new Date(Date.now() - 60_000),
      })
      .where('session_id', '=', created.sessionId)
      .execute();

    const session = await getLiveSession(testScope(), created.sessionId);
    assert.equal(session.state.slideId, '', 'the fresher in-memory state wins');

    // And the other way round: a row written by another process, later.
    await db
      .updateTable('present_sessions')
      .set({
        state: JSON.stringify({ slideId: 'from-other-worker', slideIndex: 4, updatedAt: 2 }),
        last_activity_at: new Date(Date.now() + 60_000),
      })
      .where('session_id', '=', created.sessionId)
      .execute();

    const refreshed = await getLiveSession(testScope(), created.sessionId);
    assert.equal(refreshed.state.slideId, 'from-other-worker');
    assert.equal(refreshed.state.slideIndex, 4);
  });

  it('deletes the row when the session closes', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    assert.equal(closeSession(created.sessionId, 'closed'), true);
    // The delete is fire-and-forget; give it the event-loop turn it needs.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rows = await db.selectFrom('present_sessions').selectAll().execute();
    assert.equal(rows.length, 0);
    assert.equal(await getLiveSession(testScope(), created.sessionId), null);
  });

  it('deletes the session with its deck', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    await db.deleteFrom('presentations').where('id', '=', presentationId).execute();

    const rows = await db.selectFrom('present_sessions').selectAll().execute();
    assert.equal(rows.length, 0, 'presentation_id cascades — no deckless sessions survive');
    coldStart();
    assert.equal(await getLiveSession(testScope(), created.sessionId), null);
  });

  it('sweeps sessions past the idle TTL and leaves live ones alone', async () => {
    const live = await createLiveSession(testScope(), { presentationId });
    const otherDeck = await seedPresentation(db, { title: 'Yesterday' });
    const stale = await createLiveSession(testScope(), { presentationId: otherDeck });
    await db
      .updateTable('present_sessions')
      .set({ last_activity_at: new Date(Date.now() - TTL_MS - 60_000) })
      .where('session_id', '=', stale.sessionId)
      .execute();

    assert.equal(await sweepExpiredSessions(), 1);

    const rows = await db.selectFrom('present_sessions').select('session_id').execute();
    assert.deepEqual(
      rows.map((r) => r.session_id),
      [live.sessionId]
    );
  });

  it('ignores an expired row rather than adopting it', async () => {
    const created = await createLiveSession(testScope(), { presentationId });
    await db
      .updateTable('present_sessions')
      .set({ last_activity_at: new Date(Date.now() - TTL_MS - 60_000) })
      .where('session_id', '=', created.sessionId)
      .execute();
    coldStart();

    assert.equal(await getLiveSession(testScope(), created.sessionId), null);
    const state = await getFollowStateForPresentation(testScope(), presentationId);
    assert.equal(state.status, 'not_started');
  });
});
