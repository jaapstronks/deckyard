/**
 * Questions, interactions and feedback against real PostgreSQL.
 *
 * These three domains each wrote a JSON file per session under `dataDir()`,
 * visible only to the process that held the session in its own map, and — for
 * interactions and feedback — never deleted, because expired sessions were
 * explicitly left on disk. The properties that arrangement could not have are
 * what this suite is about, so it has to be a *real* database:
 *
 *  - the answers survive a restart and are visible to a second worker,
 *  - "one vote per device" and "one entry per device" are constraints rather
 *    than Map semantics in one process,
 *  - the rows go away with their session, through the foreign key, which is
 *    what lets `utils/live-session-cleanup.js` collect all four domains with
 *    one DELETE.
 *
 * "A second process" is modelled by clearing the in-memory `sessions` map of
 * the present-session layer: a cold worker has no map entries and the same
 * tables, so a lookup that still resolves went through Postgres.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { sessions } from '../../server/storage/present-sessions/state.js';
import { createPresentSession } from '../../server/storage/present-sessions/sessions.js';
import { closeSession } from '../../server/storage/present-sessions/close.js';
import { TTL_MS } from '../../server/storage/present-sessions/constants.js';
import { sweepExpiredLiveSessions } from '../../server/utils/live-session-cleanup.js';
import {
  cancelQuestion,
  createQuestion,
  getQuestion,
  listQuestions,
  promoteQuestion,
  removeQuestion,
  upvoteQuestion,
} from '../../server/storage/questions.js';
import {
  ensurePollInteractionForSlide,
  getPollInteractionAggregate,
  resetPollInteraction,
  setPollInteractionStatus,
  voteLikertInteraction,
  votePollInteraction,
} from '../../server/storage/interactions.js';
import {
  ensureFeedbackForSlide,
  getFeedbackAggregate,
  listFeedbackEntries,
  resetFeedback,
  setFeedbackStatus,
  submitFeedback,
} from '../../server/storage/feedback.js';

/** Drop everything this process holds: the state a fresh worker starts from. */
function coldStart() {
  for (const s of sessions.values()) {
    if (s?.persistTimer) clearTimeout(s.persistTimer);
  }
  sessions.clear();
}

pgDescribe('live interaction storage (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let presentationId;
  /** @type {string} */
  let sessionId;

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
    // Every interaction row is foreign-keyed to a live session, so the session
    // is the fixture rather than a bare string id.
    ({ sessionId } = await createPresentSession(null, { presentationId }));
  });

  // -- questions ------------------------------------------------------------

  it('keeps a question after a restart, ranked and visible', async () => {
    const created = await createQuestion(null, sessionId, {
      authorId: 'dev-a',
      authorName: 'Ada',
      text: 'Why this and not that?',
      originalLang: 'nl',
    });
    assert.equal(created.ok, true);
    coldStart();

    const list = await listQuestions(null, sessionId);
    assert.equal(list.length, 1);
    assert.equal(list[0].text, 'Why this and not that?');
    assert.equal(list[0].authorName, 'Ada');
    assert.equal(list[0].upvotes, 0);
    assert.equal(list[0].original.lang, 'nl');
    assert.equal(list[0].texts.nl, 'Why this and not that?');
  });

  it('counts one upvote per device and refuses the second', async () => {
    const { question } = await createQuestion(null, sessionId, {
      authorId: 'dev-a',
      text: 'First',
    });

    assert.deepEqual(await upvoteQuestion(null, sessionId, {
      questionId: question.id,
      voterId: 'dev-b',
    }), { ok: true, upvotes: 1 });

    const again = await upvoteQuestion(null, sessionId, {
      questionId: question.id,
      voterId: 'dev-b',
    });
    assert.deepEqual(again, { ok: false, reason: 'already_voted' });

    // The count is derived from the voter set, so it cannot drift from it.
    const row = await db
      .selectFrom('questions')
      .select('voters')
      .where('id', '=', question.id)
      .executeTakeFirstOrThrow();
    assert.deepEqual(row.voters, ['dev-b']);
  });

  it('refuses an upvote on your own question', async () => {
    const { question } = await createQuestion(null, sessionId, {
      authorId: 'dev-a',
      text: 'Mine',
    });
    assert.deepEqual(await upvoteQuestion(null, sessionId, {
      questionId: question.id,
      voterId: 'dev-a',
    }), { ok: false, reason: 'own_question' });
  });

  it('ranks promoted first, then by upvotes, then oldest first', async () => {
    const quiet = (await createQuestion(null, sessionId, { authorId: 'a', text: 'Quiet' }))
      .question;
    const loud = (await createQuestion(null, sessionId, { authorId: 'b', text: 'Loud' }))
      .question;
    const chosen = (await createQuestion(null, sessionId, { authorId: 'c', text: 'Chosen' }))
      .question;

    await upvoteQuestion(null, sessionId, { questionId: loud.id, voterId: 'x' });
    await upvoteQuestion(null, sessionId, { questionId: loud.id, voterId: 'y' });
    await promoteQuestion(null, sessionId, { questionId: chosen.id, slideId: 's9' });
    coldStart();

    const list = await listQuestions(null, sessionId);
    assert.deepEqual(
      list.map((q) => q.text),
      ['Chosen', 'Loud', 'Quiet']
    );
    assert.equal(list[0].promoted.slideId, 's9');
    assert.ok(list[0].promoted.promotedAt > 0);
    assert.equal(list[1].upvotes, 2);
    assert.equal(list[2].id, quiet.id);
  });

  it('locks a promoted question against votes, cancellation and removal', async () => {
    const { question } = await createQuestion(null, sessionId, {
      authorId: 'dev-a',
      text: 'Promote me',
    });
    await promoteQuestion(null, sessionId, { questionId: question.id, slideId: 's1' });

    assert.equal(
      (await upvoteQuestion(null, sessionId, { questionId: question.id, voterId: 'dev-b' })).reason,
      'locked'
    );
    assert.equal(
      (await cancelQuestion(null, sessionId, { questionId: question.id, authorId: 'dev-a' }))
        .reason,
      'locked'
    );
    assert.equal(
      (await removeQuestion(null, sessionId, { questionId: question.id, removedBy: 'mod' })).reason,
      'locked'
    );
    // Promoting twice is idempotent, not an error.
    assert.deepEqual(
      await promoteQuestion(null, sessionId, { questionId: question.id, slideId: 's1' }),
      { ok: true, already: true }
    );
  });

  it('hides cancelled and removed questions from the list', async () => {
    const mine = (await createQuestion(null, sessionId, { authorId: 'dev-a', text: 'Oops' }))
      .question;
    const theirs = (await createQuestion(null, sessionId, { authorId: 'dev-b', text: 'Spam' }))
      .question;

    assert.deepEqual(
      await cancelQuestion(null, sessionId, { questionId: mine.id, authorId: 'dev-b' }),
      { ok: false, reason: 'forbidden' }
    );
    assert.deepEqual(
      await cancelQuestion(null, sessionId, { questionId: mine.id, authorId: 'dev-a' }),
      { ok: true }
    );
    assert.deepEqual(
      await removeQuestion(null, sessionId, { questionId: theirs.id, removedBy: 'mod@example.com' }),
      { ok: true }
    );
    coldStart();

    assert.deepEqual(await listQuestions(null, sessionId), []);
  });

  it('answers "no such question" for a malformed id instead of erroring', async () => {
    // The column is uuid; a path segment is whatever the client typed.
    assert.equal(await getQuestion(null, sessionId, 'not-a-uuid'), null);
    assert.deepEqual(
      await upvoteQuestion(null, sessionId, { questionId: 'not-a-uuid', voterId: 'dev-b' }),
      { ok: false, reason: 'not_found' }
    );
  });

  // -- interactions ---------------------------------------------------------

  it('keeps poll votes across a restart and totals them from the votes', async () => {
    await ensurePollInteractionForSlide(null, sessionId, { slideId: 'poll-1', optionCount: 3 });
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 2,
      optionCount: 3,
    });
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-b',
      optionIndex: 2,
      optionCount: 3,
    });
    coldStart();

    const agg = await getPollInteractionAggregate(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionCount: 3,
    });
    assert.deepEqual(agg.totals, [0, 0, 2]);
    assert.equal(agg.total, 2);
    assert.equal(agg.myVote, 2);
    assert.equal(agg.open, true);
  });

  it('replaces a device its own vote instead of adding one', async () => {
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 0,
      optionCount: 2,
    });
    const after = await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 1,
      optionCount: 2,
    });
    assert.deepEqual(after.aggregate.totals, [0, 1]);
    assert.equal(after.aggregate.myVote, 1);

    const rows = await db.selectFrom('interaction_votes').selectAll().execute();
    assert.equal(rows.length, 1, 'the primary key is (interaction_id, device_id)');
  });

  it('refuses a vote on a closed interaction and reopens cleanly', async () => {
    await ensurePollInteractionForSlide(null, sessionId, { slideId: 'poll-1', optionCount: 2 });
    await setPollInteractionStatus(null, sessionId, {
      slideId: 'poll-1',
      status: 'closed',
      optionCount: 2,
    });
    coldStart();

    assert.deepEqual(
      await votePollInteraction(null, sessionId, {
        slideId: 'poll-1',
        deviceId: 'dev-a',
        optionIndex: 0,
        optionCount: 2,
      }),
      { ok: false, reason: 'closed' }
    );

    await setPollInteractionStatus(null, sessionId, { slideId: 'poll-1', status: 'open' });
    const ok = await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 0,
      optionCount: 2,
    });
    assert.equal(ok.ok, true);
  });

  it('drops votes for options that no longer exist when a poll shrinks', async () => {
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 3,
      optionCount: 4,
    });
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-b',
      optionIndex: 0,
      optionCount: 4,
    });

    // The deck was edited mid-session: four options became two.
    const agg = await getPollInteractionAggregate(null, sessionId, {
      slideId: 'poll-1',
      optionCount: 2,
    });
    assert.deepEqual(agg.totals, [1, 0]);
    const rows = await db.selectFrom('interaction_votes').select('device_id').execute();
    assert.deepEqual(rows.map((r) => r.device_id), ['dev-b']);
  });

  it('clears every vote on reset without deleting the interaction', async () => {
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 1,
      optionCount: 2,
    });
    const agg = await resetPollInteraction(null, sessionId, {
      slideId: 'poll-1',
      optionCount: 2,
    });
    assert.deepEqual(agg.totals, [0, 0]);
    assert.equal(agg.total, 0);
    assert.equal(
      (await db.selectFrom('interactions').selectAll().execute()).length,
      1,
      'the interaction stays; only the answers go'
    );
  });

  it('keeps poll and likert on the kind the slide says', async () => {
    await voteLikertInteraction(null, sessionId, {
      slideId: 'scale-1',
      deviceId: 'dev-a',
      optionIndex: 4,
      optionCount: 5,
    });
    const row = await db
      .selectFrom('interactions')
      .select(['type', 'option_count'])
      .where('slide_id', '=', 'scale-1')
      .executeTakeFirstOrThrow();
    assert.equal(row.type, 'likert');
    assert.equal(row.option_count, 5);
  });

  // -- feedback -------------------------------------------------------------

  it('keeps one entry per device, editable, across a restart', async () => {
    await submitFeedback(null, sessionId, {
      slideId: 'fb-1',
      deviceId: 'dev-a',
      text: 'First thought',
    });
    await submitFeedback(null, sessionId, {
      slideId: 'fb-1',
      deviceId: 'dev-b',
      text: 'Another voice',
    });
    coldStart();

    const revised = await submitFeedback(null, sessionId, {
      slideId: 'fb-1',
      deviceId: 'dev-a',
      text: 'Second thought',
    });
    assert.equal(revised.ok, true);
    assert.equal(revised.aggregate.total, 2, 'a revision replaces, it does not add');
    assert.equal(revised.aggregate.myText, 'Second thought');

    const entries = await listFeedbackEntries(null, sessionId, { slideId: 'fb-1' });
    assert.equal(entries.length, 2);
    const mine = entries.find((e) => e.deviceId === 'dev-a');
    assert.equal(mine.text, 'Second thought');
    assert.ok(mine.createdAt > 0 && mine.updatedAt >= mine.createdAt);
  });

  it('exports the entries a presenter downloads, oldest first', async () => {
    for (const [deviceId, text] of [
      ['dev-a', 'one'],
      ['dev-b', 'two'],
      ['dev-c', 'three'],
    ]) {
      await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId, text });
    }
    coldStart();

    const entries = await listFeedbackEntries(null, sessionId, { slideId: 'fb-1' });
    assert.deepEqual(
      entries.map((e) => e.text),
      ['one', 'two', 'three']
    );
    assert.deepEqual(
      entries.map((e) => e.slideId),
      ['fb-1', 'fb-1', 'fb-1']
    );
  });

  it('refuses empty text and feedback on a closed slide', async () => {
    assert.deepEqual(
      await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId: 'dev-a', text: '   ' }),
      { ok: false, reason: 'empty' }
    );

    await ensureFeedbackForSlide(null, sessionId, { slideId: 'fb-1' });
    await setFeedbackStatus(null, sessionId, { slideId: 'fb-1', status: 'closed' });
    assert.deepEqual(
      await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId: 'dev-a', text: 'late' }),
      { ok: false, reason: 'closed' }
    );
  });

  it('discards every entry on reset', async () => {
    await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId: 'dev-a', text: 'gone' });
    const agg = await resetFeedback(null, sessionId, { slideId: 'fb-1' });
    assert.equal(agg.total, 0);
    assert.deepEqual(await listFeedbackEntries(null, sessionId, { slideId: 'fb-1' }), []);
    assert.equal(
      (await getFeedbackAggregate(null, sessionId, { slideId: 'fb-1' })).open,
      true,
      'the interaction survives its answers'
    );
  });

  it('gives feedback its lifecycle in the interactions table, as a third kind', async () => {
    await ensureFeedbackForSlide(null, sessionId, { slideId: 'fb-1' });
    const row = await db
      .selectFrom('interactions')
      .select(['type', 'status', 'option_count'])
      .where('slide_id', '=', 'fb-1')
      .executeTakeFirstOrThrow();
    assert.equal(row.type, 'feedback');
    assert.equal(row.status, 'open');
    assert.equal(row.option_count, 0);
  });

  // -- lifetime -------------------------------------------------------------

  it('takes questions, interactions, votes and feedback down with the session', async () => {
    await createQuestion(null, sessionId, { authorId: 'dev-a', text: 'Q' });
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 0,
      optionCount: 2,
    });
    await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId: 'dev-a', text: 'F' });

    assert.equal(closeSession(sessionId, 'closed'), true);
    // The delete is fire-and-forget; give it the event-loop turn it needs.
    await new Promise((resolve) => setTimeout(resolve, 100));

    for (const table of ['questions', 'interactions', 'interaction_votes', 'feedback']) {
      const rows = await db.selectFrom(table).selectAll().execute();
      assert.equal(rows.length, 0, `${table} cascaded with the session`);
    }
  });

  it('lets the TTL sweep collect all four domains in one statement', async () => {
    await createQuestion(null, sessionId, { authorId: 'dev-a', text: 'Q' });
    await votePollInteraction(null, sessionId, {
      slideId: 'poll-1',
      deviceId: 'dev-a',
      optionIndex: 0,
      optionCount: 2,
    });
    await submitFeedback(null, sessionId, { slideId: 'fb-1', deviceId: 'dev-a', text: 'F' });

    await db
      .updateTable('present_sessions')
      .set({ last_activity_at: new Date(Date.now() - TTL_MS - 60_000) })
      .where('session_id', '=', sessionId)
      .execute();
    coldStart();

    const { sessions: swept } = await sweepExpiredLiveSessions();
    assert.equal(swept, 1);

    for (const table of ['questions', 'interactions', 'interaction_votes', 'feedback']) {
      const rows = await db.selectFrom(table).selectAll().execute();
      assert.equal(rows.length, 0, `${table} was collected with its expired session`);
    }
  });

  it('refuses to store anything for a session that does not exist', async () => {
    assert.equal(
      (await createQuestion(null, 'no-such-session', { authorId: 'dev-a', text: 'Q' })).reason,
      'not_found'
    );
    assert.deepEqual(
      await votePollInteraction(null, 'no-such-session', {
        slideId: 'poll-1',
        deviceId: 'dev-a',
        optionIndex: 0,
        optionCount: 2,
      }),
      { ok: false, reason: 'no_session' }
    );
    assert.deepEqual(
      await submitFeedback(null, 'no-such-session', {
        slideId: 'fb-1',
        deviceId: 'dev-a',
        text: 'F',
      }),
      { ok: false, reason: 'no_session' }
    );
  });
});
