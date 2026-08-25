/**
 * The audience-question surface has one owner (B153).
 *
 * `/api/follow/:id/questions/events` was subscribed to from several views —
 * the follow page, the presenter's notes panel — and each copy re-derived the
 * model. They had drifted on the field that matters most: which of
 * `item?.original?.text` and `item?.text` carries what was asked.
 *
 * Today those agree, because `publicQuestion()` in server/storage/questions.js
 * fills both from the same column and labels `text` "Back-compat". The
 * divergence is latent, not live — and it stops being latent the moment `text`
 * carries anything but the original (the `texts` map next to it exists for
 * exactly that), at which point a moderator would be deleting a question
 * whose text they never saw.
 *
 * This file pins the consolidation: `client/lib/qa/` owns the accessor, the
 * subscription and the mutation paths, and the views render.
 *
 * Run with: node --test tests/qa-single-owner.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeQuestion,
  normalizeQuestions,
  questionText,
  rankQuestions,
} from '../client/lib/qa/question-model.js';
import { createQuestionsFeed } from '../client/lib/qa/questions-feed.js';
import {
  promoteQuestion,
  removeQuestion,
  upvoteQuestion,
} from '../client/lib/qa/mutations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const OWNER_DIR = 'client/lib/qa';

/** Every hand-authored .js file under client/, vendor excluded. */
function clientFiles(dir = path.join(repoRoot, 'client'), acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) clientFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Files matching `pattern`, as repo-relative paths with line numbers. */
function hits(pattern) {
  const out = [];
  for (const file of clientFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // Prose in a doc comment describes the rule; it does not implement it.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
        if (pattern.test(line)) out.push(`${rel}:${i + 1}`);
      });
  }
  return out;
}

/** Whether every hit is inside the owning directory. */
function onlyInOwner(found) {
  return found.filter((h) => !h.startsWith(`${OWNER_DIR}/`));
}

// ---------------------------------------------------------------------------
// One owner
// ---------------------------------------------------------------------------

test('the question-text accessor lives in exactly one place', () => {
  const found = hits(/\boriginal\??\.text\b/);
  assert.ok(found.length >= 1, 'the accessor must still exist somewhere');
  assert.deepEqual(
    onlyInOwner(found),
    [],
    'reading the question text off the wire object belongs to ' +
      `${OWNER_DIR}/question-model.js — a second reading is how the ` +
      'moderator ended up on a different field than the audience (B153)',
  );
});

test('the questions SSE stream is subscribed to in exactly one place', () => {
  const found = hits(/questions\/events/);
  assert.ok(found.length >= 1, 'the subscription must still exist');
  assert.deepEqual(
    onlyInOwner(found),
    [],
    `the live question feed belongs to ${OWNER_DIR}/questions-feed.js`,
  );
});

test('the question mutation paths are built in exactly one place', () => {
  const found = hits(/\/api\/moderate\//);
  assert.ok(found.length >= 1, 'the moderator paths must still exist');
  assert.deepEqual(
    onlyInOwner(found),
    [],
    `question writes belong to ${OWNER_DIR}/mutations.js`,
  );
});

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

test('questionText prefers the original over the back-compat alias', () => {
  // The case the views disagreed about.
  assert.equal(
    questionText({ text: 'a translation', original: { text: 'as asked' } }),
    'as asked',
  );
  assert.equal(questionText({ text: 'as asked' }), 'as asked');
  assert.equal(questionText({ text: '  padded  ' }), 'padded');
  // An empty original is not an answer; fall through to the alias.
  assert.equal(
    questionText({ text: 'as asked', original: { text: '' } }),
    'as asked',
  );
  assert.equal(questionText({}), '');
  assert.equal(questionText(undefined), '');
});

test('normalizeQuestion derives the fields the views used to derive each', () => {
  assert.deepEqual(
    normalizeQuestion({
      id: ' q1 ',
      text: 'alias',
      original: { text: 'as asked' },
      authorName: '  Ada  ',
      upvotes: 3,
      status: 'promoted',
      createdAt: 1234,
    }),
    {
      id: 'q1',
      text: 'as asked',
      authorName: 'Ada',
      upvotes: 3,
      status: 'promoted',
      isPromoted: true,
      createdAt: 1234,
    },
  );
  assert.deepEqual(normalizeQuestion({}), {
    id: '',
    text: '',
    authorName: '',
    upvotes: 0,
    status: '',
    isPromoted: false,
    createdAt: 0,
  });
  // Nonsense upvotes never render as a negative or NaN vote count.
  assert.equal(normalizeQuestion({ upvotes: -4 }).upvotes, 0);
  assert.equal(normalizeQuestion({ upvotes: 'lots' }).upvotes, 0);
});

test('normalizeQuestions drops non-objects and survives a non-array', () => {
  assert.deepEqual(normalizeQuestions(null), []);
  assert.deepEqual(normalizeQuestions('nope'), []);
  assert.deepEqual(
    normalizeQuestions([{ id: 'a' }, null, 'x', { id: 'b' }]).map((q) => q.id),
    ['a', 'b'],
  );
});

test('rankQuestions matches the order the server lists in', () => {
  // server/storage/questions.js listQuestions: promoted first, then upvotes
  // descending, then oldest first.
  const ranked = rankQuestions(
    normalizeQuestions([
      { id: 'new-quiet', upvotes: 0, createdAt: 300 },
      { id: 'old-quiet', upvotes: 0, createdAt: 100 },
      { id: 'popular', upvotes: 9, createdAt: 200 },
      { id: 'promoted', upvotes: 0, createdAt: 400, status: 'promoted' },
    ]),
  );
  assert.deepEqual(
    ranked.map((q) => q.id),
    ['promoted', 'popular', 'old-quiet', 'new-quiet'],
  );
});

test('rankQuestions does not mutate its input', () => {
  const input = normalizeQuestions([
    { id: 'a', upvotes: 1 },
    { id: 'b', upvotes: 5 },
  ]);
  const before = input.map((q) => q.id);
  rankQuestions(input);
  assert.deepEqual(
    input.map((q) => q.id),
    before,
  );
});

// ---------------------------------------------------------------------------
// The feed's HTTP half (the SSE half needs an EventSource; connect() is not
// exercised here)
// ---------------------------------------------------------------------------

/** A recording api() double. @param {Object} resp @returns {Function} */
function fakeApi(resp) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (resp instanceof Error) throw resp;
    return typeof resp === 'function' ? resp(url, init) : resp;
  };
  fn.calls = calls;
  return fn;
}

test('refresh hands over normalized, ranked questions for a live session', async () => {
  const api = fakeApi({
    status: 'live',
    capabilities: { canUseQa: true },
    questions: [
      { id: 'a', text: 'alias', original: { text: 'first' }, upvotes: 1 },
      { id: 'b', text: 'second', upvotes: 7 },
    ],
  });
  const seen = [];
  const caps = [];
  const feed = createQuestionsFeed({
    api,
    getPresentationId: () => 'deck 1',
    onQuestions: (qs, meta) => seen.push({ qs, meta }),
    onCapabilities: (c) => caps.push(c),
  });

  const result = await feed.refresh();

  assert.equal(api.calls[0].url, '/api/follow/deck%201/questions');
  assert.equal(result.live, true);
  assert.deepEqual(caps, [{ canUseQa: true }]);
  assert.equal(seen.length, 1);
  assert.deepEqual(
    seen[0].qs.map((q) => [q.id, q.text, q.upvotes]),
    [
      ['b', 'second', 7],
      ['a', 'first', 1],
    ],
  );
  assert.equal(seen[0].meta.live, true);
});

test('a dead session and a failed read both emit an empty list', async () => {
  const dead = [];
  await createQuestionsFeed({
    api: fakeApi({ status: 'ended', questions: [{ id: 'a' }] }),
    getPresentationId: () => 'd',
    onQuestions: (qs, meta) => dead.push({ qs, meta }),
  }).refresh();
  assert.deepEqual(dead, [
    { qs: [], meta: { live: false, capabilities: null } },
  ]);

  const broken = [];
  const errors = [];
  const result = await createQuestionsFeed({
    api: fakeApi(new Error('offline')),
    getPresentationId: () => 'd',
    onQuestions: (qs) => broken.push(qs),
    onRefreshError: (e) => errors.push(e.message),
  }).refresh();
  assert.deepEqual(broken, [[]]);
  assert.deepEqual(errors, ['offline']);
  assert.deepEqual(result, { live: false, questions: [], capabilities: null });
});

test('stop() is safe before connect() and idempotent', () => {
  const feed = createQuestionsFeed({
    api: fakeApi({}),
    getPresentationId: () => 'd',
    onQuestions: () => {},
  });
  assert.doesNotThrow(() => {
    feed.stop();
    feed.stop();
    feed.disconnect();
  });
  assert.equal(feed.isConnected(), false);
});

// ---------------------------------------------------------------------------
// The mutations
// ---------------------------------------------------------------------------

test('mutation paths escape their segments and carry the documented body', async () => {
  const api = fakeApi({ ok: true });
  await upvoteQuestion(api, 'deck/1', 'q 2');
  await promoteQuestion(api, 'd', 'q', {
    position: 'next',
    afterSlideIndex: 4,
  });
  await promoteQuestion(api, 'd', 'q', { position: 'end' });
  await removeQuestion(api, 'd', 'q');

  assert.deepEqual(
    api.calls.map((c) => c.url),
    [
      '/api/follow/deck%2F1/questions/q%202/upvote',
      '/api/moderate/d/questions/q/promote',
      '/api/moderate/d/questions/q/promote',
      '/api/moderate/d/questions/q/remove',
    ],
  );
  assert.deepEqual(JSON.parse(api.calls[1].init.body), {
    position: 'next',
    afterSlideIndex: 4,
  });
  // 'end' takes no index — sending one would be a field the route ignores.
  assert.deepEqual(JSON.parse(api.calls[2].init.body), { position: 'end' });
  assert.equal(api.calls[3].init.method, 'POST');
});
