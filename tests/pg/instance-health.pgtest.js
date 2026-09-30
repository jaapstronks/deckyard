/**
 * The instance-health counters against real PostgreSQL (B514, D246).
 *
 * The double runs the facade's upsert by pattern-matching its SQL; this runs
 * it on the database that evaluates it: the `COALESCE(count, 0) + n` bump on
 * the `(axis, key, day)` primary key, a multi-row insert, the `date` column
 * read back as the day it was written, and the prune. It also pins the three
 * interaction counts whose storage paths the double cannot run (polls,
 * likerts and feedback aggregate through a `FILTER` count).
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { sessions } from '../../server/storage/live-sessions/state.js';
import { createLiveSession } from '../../server/storage/live-sessions/sessions.js';
import {
  pruneInstanceHealth,
  readInstanceHealth,
  recordInstanceHealth,
} from '../../server/storage/instance-health.js';
import {
  ensureLikertInteractionForSlide,
  ensurePollInteractionForSlide,
  voteLikertInteraction,
  votePollInteraction,
} from '../../server/storage/interactions.js';
import { submitFeedback } from '../../server/storage/feedback.js';

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * The counted `axis:key` pairs once the fire-and-forget writes have landed.
 * Against a real pool a write takes real I/O, so poll until `expected` shows
 * up or two seconds pass, and answer what is there either way.
 */
async function keysIn(db, expected) {
  const read = async () =>
    (await db.selectFrom('instance_health').select(['axis', 'key']).execute())
      .map((r) => `${r.axis}:${r.key}`)
      .sort();
  const deadline = Date.now() + 2000;
  let keys = await read();
  while (keys.length < expected.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    keys = await read();
  }
  return keys;
}

function coldStart() {
  for (const s of sessions.values()) {
    if (s?.persistTimer) clearTimeout(s.persistTimer);
  }
  sessions.clear();
}

pgDescribe('instance-health counters (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    coldStart();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    coldStart();
    await truncate(
      db,
      'instance_health',
      'organizations',
      'presentations',
      'present_sessions',
      'follow_codes',
    );
  });

  it('inserts one row per distinct key and bumps it on the next sighting', async () => {
    await recordInstanceHealth([
      { axis: 'surface', key: 'embed' },
      { axis: 'slide_type.viewed', key: 'title-slide' },
      { axis: 'slide_type.viewed', key: 'title-slide' },
    ]);
    await recordInstanceHealth([{ axis: 'surface', key: 'embed' }]);

    assert.deepEqual(await readInstanceHealth({ sinceDay: TODAY }), [
      { axis: 'slide_type.viewed', key: 'title-slide', day: TODAY, count: 1 },
      { axis: 'surface', key: 'embed', day: TODAY, count: 2 },
    ]);
  });

  it('prunes the days before the cutoff and keeps the cutoff day', async () => {
    await db
      .insertInto('instance_health')
      .values([
        { axis: 'export', key: 'pdf', day: '2025-01-01', count: 3 },
        { axis: 'export', key: 'pdf', day: '2025-06-01', count: 1 },
      ])
      .execute();
    assert.equal(await pruneInstanceHealth('2025-06-01'), 1);
    assert.deepEqual(
      (await readInstanceHealth()).map((r) => r.day),
      ['2025-06-01'],
    );
  });

  it('counts the live session, poll and likert opening and voting, and feedback', async () => {
    await seedDefaultOrganization(db);
    const presentationId = await seedPresentation(db, { title: 'Live deck' });
    const { sessionId } = await createLiveSession(testScope(), {
      presentationId,
    });

    const poll = { slideId: 's-poll', optionCount: 2 };
    await ensurePollInteractionForSlide(testScope(), sessionId, poll);
    const voted = await votePollInteraction(testScope(), sessionId, {
      ...poll,
      deviceId: 'device-1',
      optionIndex: 1,
    });
    assert.equal(voted.ok, true);

    const likert = { slideId: 's-likert', optionCount: 5 };
    await ensureLikertInteractionForSlide(testScope(), sessionId, likert);
    await voteLikertInteraction(testScope(), sessionId, {
      ...likert,
      deviceId: 'device-1',
      optionIndex: 3,
    });

    const fb = await submitFeedback(testScope(), sessionId, {
      slideId: 's-feedback',
      deviceId: 'device-1',
      text: 'Great',
    });
    assert.equal(fb.ok, true);

    const expected = [
      'interaction:feedback_submitted',
      'interaction:likert_opened',
      'interaction:likert_vote',
      'interaction:live_session',
      'interaction:poll_opened',
      'interaction:poll_vote',
    ];
    assert.deepEqual(await keysIn(db, expected), expected);
  });
});
