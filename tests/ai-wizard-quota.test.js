/**
 * A wizard run that reaches the installation's daily AI ceiling ends in the
 * ceiling's refusal, not in a half-generated deck (DY-859).
 *
 * The ceiling held before (DY-844: nothing goes to the vendor past it), but
 * the outline revision kept its draft on any failure and phase 2 returned
 * fallback slides after its retries, so an `AiQuotaError` from either step
 * disappeared and the author got a deck of unrefined slides with a 201. Both
 * now throw it on, like a cancelled call.
 *
 * Driven through the internal dispatcher (`handleApi`, auth off) over the
 * in-memory database double; the provider's `fetch` is the only way out, so
 * "no model call past the ceiling" is a count.
 *
 * Run with: node --test tests/ai-wizard-quota.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockRes } from './helpers/http-mocks.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ac';
process.env.STORAGE_MODE = 'postgres';
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.AUTH_ENABLED = 'false';
delete process.env.SANDBOX_MODE;
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;
delete process.env.DEMO_MODE;
delete process.env.MULTI_ORG_ENABLED;
delete process.env.AI_DAILY_CALL_LIMIT;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { handleApi } = await import('../server/routes/api/index.js');

/**
 * One answer for every model call: the outline reads `title` and `slides[]`
 * with `intent`/`roughContent`, the revision finds no `operations` (a call
 * that keeps the draft), phase 2 reads `type` and `content` off `slides[]`.
 */
const ANSWER = {
  title: 'Partners',
  subtitle: 'Who we build with',
  sections: [{ heading: 'Partners', keyPoints: ['The partners'] }],
  slides: [
    {
      intent: 'content',
      section: 0,
      roughContent: 'The partners we work with',
      originalIndex: 0,
      type: 'content-slide',
      content: { title: 'Our partners', body: 'Three partners.' },
    },
  ],
};

let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [await brandSeedRow()],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
  delete process.env.AUTH_ENABLED;
});

function seed(limit) {
  db.__tables.ai_usage_daily = [];
  db.__tables.ai_usage_instance_daily = [];
  db.__tables.presentations = [];
  process.env.AI_DAILY_CALL_LIMIT = String(limit);
}

/** Answer every model call with {@link ANSWER}; returns the request bodies. */
function stubModel(t) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(ANSWER) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
    delete process.env.AI_DAILY_CALL_LIMIT;
  });
  return calls;
}

async function runWizard() {
  const payload = JSON.stringify({ raw: 'The partners we work with.' });
  const res = createMockRes();
  await handleApi({
    repoRoot: process.cwd(),
    req: {
      method: 'POST',
      headers: {
        host: 'decks.example.test',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '203.0.113.9' },
      on() {},
      once() {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload, 'utf8');
      },
    },
    res,
    url: new URL('http://decks.example.test/api/ai/wizard'),
  });
  return res;
}

/** Only the revision's system prompt has this line. */
const REVISION_MARKER = 'reviewing a draft outline';
/** Only the phase 2 system prompt has this header. */
const PHASE2_MARKER = 'PRESENTATION CONTEXT';

/**
 * How many model calls a full run makes before the first call of a step,
 * measured on a run below the ceiling, so the ceiling lands exactly on that
 * step whatever the outline phase spends.
 */
let callsBefore;

function assertRefused(res, calls, limit) {
  assert.equal(res.statusCode, 429, JSON.stringify(res.json()));
  assert.equal(res.json().error, 'ai_quota_exceeded');
  assert.equal(calls.length, limit, 'nothing went out past the ceiling');
  assert.equal(db.__tables.presentations.length, 0, 'no deck was stored');
}

test('below the ceiling the wizard creates the deck', async (t) => {
  seed(50);
  const calls = stubModel(t);
  const res = await runWizard();
  assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
  assert.equal(db.__tables.presentations.length, 1);
  const first = (marker) => calls.findIndex((body) => body.includes(marker));
  callsBefore = {
    revision: first(REVISION_MARKER),
    phase2: first(PHASE2_MARKER),
  };
  assert.ok(callsBefore.revision > 0, 'the run revised its outline');
  assert.ok(callsBefore.phase2 > callsBefore.revision, 'and then ran phase 2');
});

test('the ceiling at the outline revision refuses the wizard with 429', async (t) => {
  seed(callsBefore.revision);
  const calls = stubModel(t);
  assertRefused(await runWizard(), calls, callsBefore.revision);
});

test('the ceiling at phase 2 refuses the wizard with 429, not fallback slides', async (t) => {
  seed(callsBefore.phase2);
  const calls = stubModel(t);
  assertRefused(await runWizard(), calls, callsBefore.phase2);
});
