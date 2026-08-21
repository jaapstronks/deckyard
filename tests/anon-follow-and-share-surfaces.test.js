/**
 * Behaviour coverage for the anonymous, capability-authorized surfaces (B77):
 * the follow-along audience write paths and the public share-link viewer. None
 * of these carry a session — the live follow code and the share token *are* the
 * authorization — so their gates are the whole security story, and until now no
 * test imported the handlers.
 *
 *   - server/routes/api/follow/questions.js  — audience Q&A (list / ask / upvote /
 *     cancel)
 *   - server/routes/api/follow/interactions.js — audience poll/likert/feedback
 *     (current / state / vote / feedback)
 *   - server/routes/static/share-viewer.js   — token → app shell + og: metadata
 *
 * B114 added the four handlers this file did not reach when it was written —
 * `handleFollowCancel`, `handleFollowInteractionState` and
 * `handleFollowInteractionFeedback` — which were left with only their
 * `c8-routes-follow-dispatch` shape row: a table proving a path maps to a
 * handler *name*, and nothing about what the handler does.
 *
 * The handlers run against the real storage layer on the in-memory database
 * double (as the live-session and authz tests do), so these assert real
 * behaviour, not source shape. The boundary pinned throughout:
 *
 *   - a live session with a valid follow state accepts writes; a not-live deck
 *     refuses them (400), so a stale or wrong id never addresses a session;
 *   - the Q&A capability gate is honoured (disabled → refused, and an
 *     interactive current slide suppresses Q&A);
 *   - the share viewer serves the shell with *escaped* og: metadata for a valid
 *     token, and leaks no presentation data for an unknown one.
 *
 * Run with: node --test tests/anon-follow-and-share-surfaces.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-anon-surfaces-test';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createShareLink } =
  await import('../server/storage/share-links/index.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');

const { handleFollowQuestions, handleFollowUpvote, handleFollowCancel } =
  await import('../server/routes/api/follow/questions.js');
const {
  handleFollowInteractionsCurrent,
  handleFollowInteractionState,
  handleFollowInteractionVote,
  handleFollowInteractionFeedback,
} = await import('../server/routes/api/follow/interactions.js');
const { handleShareLink } =
  await import('../server/routes/static/share-viewer.js');
const { getErrorStatus } = await import('../server/utils/http.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});
test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});
test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeReq({ method = 'GET', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    socket: {},
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

const jsonBody = (res) => JSON.parse(String(res.body || '{}'));

/** Presenter scope (states its organization — a state push is not anonymous). */
const presenterScope = { repoRoot: REPO_ROOT, organizationId: ORG };

/**
 * A deck with a live session pushed onto the given slide, so
 * `getFollowStateForPresentation` reports `status: 'live'`.
 */
async function seedLiveDeck({
  slides,
  currentSlide = 0,
  slideType,
  settings,
} = {}) {
  const pres = await createPresentation(testScope(), {
    title: 'Live deck',
    ownerEmail: OWNER,
    slides: slides || [{ type: 'content-slide', content: { title: 'A' } }],
  });
  if (settings) {
    // qaEnabled is not on the create-time settings allowlist, so it has to be
    // set through an update.
    await updatePresentation(
      testScope(null, { actorEmail: OWNER }),
      pres.id,
      { settings },
      { actorEmail: OWNER, user: { email: OWNER } },
    );
  }
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  const slide = pres.slides[currentSlide];
  await updateLiveSessionState(presenterScope, session.sessionId, {
    slideId: slide.id,
    slideIndex: currentSlide,
    slideType: slideType || slide.type,
    updatedAt: Date.now(),
  });
  return {
    pres,
    sessionId: session.sessionId,
    slideId: slide.id,
    slideIds: pres.slides.map((s) => s.id),
  };
}

// ---------------------------------------------------------------------------
// Follow Q&A (questions.js)
// ---------------------------------------------------------------------------

async function callQuestions({
  method = 'GET',
  presentationId,
  body,
  headers,
}) {
  const res = fakeRes();
  const handled = await handleFollowQuestions(
    { repoRoot: REPO_ROOT, req: fakeReq({ method, body, headers }), res },
    presentationId,
  );
  return { res, handled };
}

test('Q&A GET on a live, non-interactive slide reports canUseQa and an empty list', async () => {
  const { pres } = await seedLiveDeck();
  const { res } = await callQuestions({
    method: 'GET',
    presentationId: pres.id,
  });
  assert.equal(res.statusCode, 200);
  const out = jsonBody(res);
  assert.equal(out.status, 'live');
  assert.equal(out.capabilities.canUseQa, true);
  assert.deepEqual(out.questions, []);
});

test('Q&A POST with a valid live session accepts the question', async () => {
  const { pres } = await seedLiveDeck();
  const { res } = await callQuestions({
    method: 'POST',
    presentationId: pres.id,
    body: { text: 'What is the roadmap?', authorName: 'Anon' },
  });
  assert.equal(res.statusCode, 201);
  const out = jsonBody(res);
  assert.equal(out.ok, true);
  assert.equal(out.question.text, 'What is the roadmap?');

  // And it now shows up in the list.
  const list = jsonBody(
    (await callQuestions({ method: 'GET', presentationId: pres.id })).res,
  );
  assert.equal(list.questions.length, 1);
  assert.equal(list.questions[0].text, 'What is the roadmap?');
});

test('Q&A POST on a deck that is not live is refused (400)', async () => {
  // A presentation with no live session at all.
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck',
    ownerEmail: OWNER,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const { res } = await callQuestions({
    method: 'POST',
    presentationId: pres.id,
    body: { text: 'anyone there?' },
  });
  assert.equal(res.statusCode, 400);
});

test('Q&A is suppressed and writes refused when the deck disables it', async () => {
  const { pres } = await seedLiveDeck({ settings: { qaEnabled: false } });

  const getOut = jsonBody(
    (await callQuestions({ method: 'GET', presentationId: pres.id })).res,
  );
  assert.equal(getOut.capabilities.canUseQa, false);
  assert.deepEqual(getOut.questions, [], 'a disabled deck leaks no questions');

  const { res } = await callQuestions({
    method: 'POST',
    presentationId: pres.id,
    body: { text: 'should be refused' },
  });
  assert.equal(res.statusCode, 400);
});

test('Q&A is suppressed while an interactive slide is current', async () => {
  const { pres } = await seedLiveDeck({
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Pick', option1: 'A', option2: 'B' },
      },
    ],
    slideType: 'poll-slide',
  });
  const out = jsonBody(
    (await callQuestions({ method: 'GET', presentationId: pres.id })).res,
  );
  assert.equal(
    out.capabilities.canUseQa,
    false,
    'the live interaction owns the audience',
  );
  assert.equal(out.capabilities.interaction.type, 'poll');
});

test('Q&A rejects an unsupported method (405)', async () => {
  const { pres } = await seedLiveDeck();
  const { res } = await callQuestions({
    method: 'PUT',
    presentationId: pres.id,
  });
  assert.equal(res.statusCode, 405);
});

test('an upvote on a deck that is not live is refused (400)', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck 2',
    ownerEmail: OWNER,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const res = fakeRes();
  await handleFollowUpvote(
    { repoRoot: REPO_ROOT, req: fakeReq({ method: 'POST' }), res },
    pres.id,
    'some-question-id',
  );
  assert.equal(res.statusCode, 400);
});

// --- cancel: only the device that asked may withdraw the question ----------
// The whole authorization here is a cookie the audience member was handed when
// they asked. There is no session and no account, so "is this your question?"
// is `sb_qa` against `questions.author_id` and nothing else — which makes the
// wrong-device case the security cell of this endpoint.

/** The `sb_qa=` cookie a Set-Cookie header hands back, ready to send again. */
function qaCookieFrom(res) {
  const raw = res.headers?.['Set-Cookie'];
  const set = Array.isArray(raw) ? raw.join(';') : String(raw || '');
  const m = /sb_qa=([^;]+)/.exec(set);
  return m ? `sb_qa=${m[1]}` : null;
}

async function callCancel({
  presentationId,
  questionId,
  headers,
  method = 'POST',
}) {
  const res = fakeRes();
  await handleFollowCancel(
    { repoRoot: REPO_ROOT, req: fakeReq({ method, headers }), res },
    presentationId,
    questionId,
  );
  return res;
}

test('the device that asked a question may withdraw it', async () => {
  const { pres } = await seedLiveDeck();
  const asked = await callQuestions({
    method: 'POST',
    presentationId: pres.id,
    body: { text: 'Withdrawn in a moment' },
  });
  const cookie = qaCookieFrom(asked.res);
  assert.ok(cookie, 'asking hands the device its sb_qa cookie');
  const questionId = jsonBody(asked.res).question.id;

  const res = await callCancel({
    presentationId: pres.id,
    questionId,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200);

  const list = jsonBody(
    (await callQuestions({ method: 'GET', presentationId: pres.id })).res,
  );
  assert.deepEqual(list.questions, [], 'the withdrawn question is gone');
});

test('another device may not withdraw someone else’s question', async () => {
  const { pres } = await seedLiveDeck();
  const asked = await callQuestions({
    method: 'POST',
    presentationId: pres.id,
    body: { text: 'Not yours to withdraw' },
  });
  const questionId = jsonBody(asked.res).question.id;

  // A different `sb_qa` — the shape a second audience member arrives in.
  const res = await callCancel({
    presentationId: pres.id,
    questionId,
    headers: { cookie: 'sb_qa=some-other-device' },
  });
  assert.notEqual(res.statusCode, 200);

  const list = jsonBody(
    (await callQuestions({ method: 'GET', presentationId: pres.id })).res,
  );
  assert.equal(list.questions.length, 1, 'the question is still there');
});

test('cancelling on a deck that is not live is refused (400)', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck 4',
    ownerEmail: OWNER,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const res = await callCancel({
    presentationId: pres.id,
    questionId: 'whatever',
    headers: { cookie: 'sb_qa=some-device' },
  });
  assert.equal(res.statusCode, 400);
});

test('cancelling is refused when the deck disables Q&A (400)', async () => {
  // The gate is re-checked on the write, not only on the read that hid the UI.
  const { pres } = await seedLiveDeck({ settings: { qaEnabled: false } });
  const res = await callCancel({
    presentationId: pres.id,
    questionId: 'whatever',
    headers: { cookie: 'sb_qa=some-device' },
  });
  assert.equal(res.statusCode, 400);
});

test('cancel rejects an unsupported method (405)', async () => {
  const { pres } = await seedLiveDeck();
  const res = await callCancel({
    presentationId: pres.id,
    questionId: 'whatever',
    method: 'GET',
  });
  assert.equal(res.statusCode, 405);
});

// ---------------------------------------------------------------------------
// Follow interactions (interactions.js)
// ---------------------------------------------------------------------------

async function callInteractionsCurrent({ presentationId, headers } = {}) {
  const res = fakeRes();
  await handleFollowInteractionsCurrent(
    {
      repoRoot: REPO_ROOT,
      req: fakeReq({ method: 'GET', headers }),
      res,
      url: new URL(
        `/api/follow/${presentationId}/interactions/current`,
        'http://localhost',
      ),
    },
    presentationId,
  );
  return res;
}

async function callVote({ presentationId, slideId, body }) {
  const res = fakeRes();
  await handleFollowInteractionVote(
    { repoRoot: REPO_ROOT, req: fakeReq({ method: 'POST', body }), res },
    presentationId,
    slideId,
  );
  return res;
}

// The interaction *gates* (not-live, wrong-slide, non-interactive) are pinned
// here. The accepted-vote happy path and the poll/likert/feedback aggregate
// shapes read through raw `sql` queries the in-memory double does not run, so
// they live in tests/pg/live-interactions.pgtest.js against real Postgres.

test('interactions/current on a non-interactive live slide carries no interaction', async () => {
  const { pres } = await seedLiveDeck(); // content-slide
  const out = jsonBody(
    await callInteractionsCurrent({ presentationId: pres.id }),
  );
  assert.equal(out.status, 'live');
  assert.equal(out.interaction, null);
});

test('voting on a deck that is not live is refused (400)', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck 3',
    ownerEmail: OWNER,
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
    ],
  });
  const res = await callVote({
    presentationId: pres.id,
    slideId: pres.slides[0].id,
    body: { optionIndex: 0 },
  });
  assert.equal(res.statusCode, 400);
});

test('voting on a slide other than the current one is refused (400)', async () => {
  const { pres } = await seedLiveDeck({
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
      {
        type: 'poll-slide',
        content: { question: 'Q2', option1: 'C', option2: 'D' },
      },
    ],
    currentSlide: 0,
    slideType: 'poll-slide',
  });
  // Vote targets the *other* slide, which is not the presenter's current one.
  const res = await callVote({
    presentationId: pres.id,
    slideId: pres.slides[1].id,
    body: { optionIndex: 0 },
  });
  assert.equal(res.statusCode, 400);
});

// --- state and feedback: the two gates the dispatch table could not show ----
// `handleFollowInteractionState` is a *read* on a public endpoint, so its rule
// is a leak rule: only the presenter's current slide, never session-wide
// history. `handleFollowInteractionFeedback` is the write beside it, and both
// re-derive live-ness rather than trusting the caller's slide id.
//
// The *gates* are what live here. Both handlers finish in an aggregate query
// written with raw `sql`, which the in-memory double does not run — the same
// boundary the vote path above already sits on — so the accepted-write and
// aggregate-shape halves stay in tests/pg/live-interactions.pgtest.js against
// real PostgreSQL. Every cell below therefore ends before that line, which is
// also where the authorization decisions are.

async function callInteractionState({
  presentationId,
  slideId,
  method = 'GET',
  headers,
}) {
  const res = fakeRes();
  await handleFollowInteractionState(
    { repoRoot: REPO_ROOT, req: fakeReq({ method, headers }), res },
    presentationId,
    slideId,
  );
  return res;
}

async function callFeedback({
  presentationId,
  slideId,
  body,
  method = 'POST',
}) {
  const res = fakeRes();
  await handleFollowInteractionFeedback(
    { repoRoot: REPO_ROOT, req: fakeReq({ method, body }), res },
    presentationId,
    slideId,
  );
  return res;
}

test('interaction state on a deck that is not live carries no state and does not 404', async () => {
  // A 200 with `interactionState: null` rather than an error: the audience page
  // polls this, and "the talk has not started" is an answer, not a failure.
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck 5',
    ownerEmail: OWNER,
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
    ],
  });
  const res = await callInteractionState({
    presentationId: pres.id,
    slideId: pres.slides[0].id,
  });
  assert.equal(res.statusCode, 200);
  const out = jsonBody(res);
  assert.notEqual(out.status, 'live');
  assert.equal(out.interactionState, null);
});

test('interaction state for a slide other than the current one is refused (400)', async () => {
  // The leak rule: asking for slide 2 while the presenter is on slide 1 would
  // hand out the tally of a poll the room has not been shown yet.
  const { pres } = await seedLiveDeck({
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
      {
        type: 'poll-slide',
        content: { question: 'Q2', option1: 'C', option2: 'D' },
      },
    ],
    currentSlide: 0,
    slideType: 'poll-slide',
  });
  const res = await callInteractionState({
    presentationId: pres.id,
    slideId: pres.slides[1].id,
  });
  assert.equal(res.statusCode, 400);
});

test('interaction state with no slide id at all is refused (400)', async () => {
  const { pres, slideId } = await seedLiveDeck({
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
    ],
    slideType: 'poll-slide',
  });
  assert.ok(slideId);
  const res = await callInteractionState({
    presentationId: pres.id,
    slideId: '',
  });
  assert.equal(res.statusCode, 400);
});

test('interaction state on a live but non-interactive slide is refused (400)', async () => {
  const { pres, slideId } = await seedLiveDeck(); // content-slide
  const res = await callInteractionState({
    presentationId: pres.id,
    slideId,
  });
  assert.equal(res.statusCode, 400);
});

test('interaction state rejects an unsupported method (405)', async () => {
  const { pres, slideId } = await seedLiveDeck();
  const res = await callInteractionState({
    presentationId: pres.id,
    slideId,
    method: 'POST',
  });
  assert.equal(res.statusCode, 405);
});

test('feedback on a deck that is not live is refused (400)', async () => {
  const pres = await createPresentation(testScope(), {
    title: 'Dormant deck 6',
    ownerEmail: OWNER,
    slides: [{ type: 'feedback-slide', content: { question: 'How was it?' } }],
  });
  const res = await callFeedback({
    presentationId: pres.id,
    slideId: pres.slides[0].id,
    body: { text: 'great' },
  });
  assert.equal(res.statusCode, 400);
});

test('feedback on a slide other than the current one is refused (400)', async () => {
  const { pres } = await seedLiveDeck({
    slides: [
      { type: 'feedback-slide', content: { question: 'How was it?' } },
      { type: 'feedback-slide', content: { question: 'And now?' } },
    ],
    currentSlide: 0,
    slideType: 'feedback-slide',
  });
  const res = await callFeedback({
    presentationId: pres.id,
    slideId: pres.slides[1].id,
    body: { text: 'sneaking one in early' },
  });
  assert.equal(res.statusCode, 400);
});

test('feedback on a current slide that is not a feedback slide is refused (400)', async () => {
  // Slide *type* is re-read from the live state, so posting free text at a poll
  // does not become a write just because the ids line up.
  const { pres, slideId } = await seedLiveDeck({
    slides: [
      {
        type: 'poll-slide',
        content: { question: 'Q', option1: 'A', option2: 'B' },
      },
    ],
    slideType: 'poll-slide',
  });
  const res = await callFeedback({
    presentationId: pres.id,
    slideId,
    body: { text: 'not a poll answer' },
  });
  assert.equal(res.statusCode, 400);
});

test('feedback rejects an unsupported method (405)', async () => {
  const { pres, slideId } = await seedLiveDeck();
  const res = await callFeedback({
    presentationId: pres.id,
    slideId,
    method: 'GET',
  });
  assert.equal(res.statusCode, 405);
});

// The storage reasons these two handlers forward (B93). The handlers pre-check
// live-ness, the current slide and the slide type, so `voteInteraction` /
// `submitFeedback` can only fail underneath them on a race — the session
// disappearing, or the pool going down, between the follow-state read and the
// write. That makes the branches unreachable from a driven request, so what is
// pinned here is the mapping the handlers apply to them: `jsonError(res,
// getErrorStatus(reason), reason)`. The statuses are deliberate — a session
// that is gone is a 404, not a 400, and a pool that is down must not answer
// 4xx at all.
test('the audience write paths map their storage reasons to deliberate statuses', () => {
  assert.equal(getErrorStatus('invalid'), 400); // blank slide/device id, empty text
  assert.equal(getErrorStatus('not_found'), 404); // the session is gone
  assert.equal(getErrorStatus('closed'), 409); // the presenter shut the interaction
  assert.equal(getErrorStatus('unavailable'), 503); // ours, not the caller's
});

// ---------------------------------------------------------------------------
// Share-link viewer (share-viewer.js)
// ---------------------------------------------------------------------------

const CLIENT_DIR = path.join(process.cwd(), 'client');

async function callShare({ token, method = 'GET' }) {
  const res = fakeRes();
  const handled = await handleShareLink({
    repoRoot: process.cwd(),
    req: fakeReq({ method, headers: { host: 'example.com' } }),
    res,
    url: new URL(`/s/${token}`, 'http://example.com'),
    clientDir: CLIENT_DIR,
  });
  return { res, handled };
}

async function seedShareLink(title) {
  const pres = await createPresentation(testScope(), {
    title,
    ownerEmail: OWNER,
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  const link = await createShareLink(testScope(), pres.id, {
    permission: 'view',
  });
  return {
    pres,
    token: link.token || link.shareLink?.token || link?.link?.token,
  };
}

test('a valid share token serves the shell with escaped og: metadata', async () => {
  const { token } = await seedShareLink('<script>alert(1)</script> deck');
  assert.ok(token, 'share link created with a token');

  const { res, handled } = await callShare({ token });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const html = String(res.body || '');
  // The title is present, HTML-escaped, and never as raw markup.
  assert.match(
    html,
    /og:title" content="&lt;script&gt;alert\(1\)&lt;\/script&gt; deck"/,
  );
  assert.doesNotMatch(html, /content="<script>alert\(1\)<\/script> deck"/);
});

test('an unknown share token serves the shell but leaks no presentation', async () => {
  // A real deck exists, but we request a token that resolves to nothing.
  await seedShareLink('Secret quarterly numbers');
  const { res, handled } = await callShare({
    token: 'this-token-does-not-exist',
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const html = String(res.body || '');
  assert.doesNotMatch(
    html,
    /Secret quarterly numbers/,
    'no deck title leaks for an unknown token',
  );
});

test('the share viewer ignores a non-GET request', async () => {
  const { token } = await seedShareLink('Any deck');
  const { handled } = await callShare({ token, method: 'POST' });
  assert.equal(handled, false, 'only GET is a share-viewer request');
});
