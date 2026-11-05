/**
 * The AI call meter (DY-844): every model call is counted per organization and
 * person on the transport, the organization's admins read the day's spend, and
 * the installation's daily ceiling refuses with 429 before anything is sent.
 *
 * House shape: the route modules are called with a req/res double over
 * `tests/helpers/fake-db.js`. The provider's `fetch` is the only way out, so
 * "no model call" is a count. The internal dispatcher (`handleApi`) is driven
 * once with auth off, so the attribution it binds is the one under test rather
 * than one this file wraps around a handler.
 *
 * Run with: node --test tests/ai-usage-meter.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ab';
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
const DECK = 'd0000844-0000-4000-8000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleApi } = await import('../server/routes/api/index.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleSettings } = await import('../server/routes/api/settings.js');
const { requestChatCompletionContent, runWithAiAttribution, AiQuotaError } =
  await import('../server/utils/llm/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { usageDay } = await import('../server/storage/ai-usage.js');

const person = (name, extra = {}) => {
  const email = `${name}@example.com`;
  return {
    id: userIdFor(email),
    email,
    name,
    role: 'user',
    organizationId: ORG,
    ...extra,
  };
};
const OWNER = person('owner', { role: 'admin', isAdmin: true });
const EDITOR = person('editor');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
  delete process.env.AUTH_ENABLED;
});

const slides = [
  { id: 's1', type: 'content-slide', content: { title: 'Plan', body: 'X' } },
];

function seed() {
  delete process.env.AI_DAILY_CALL_LIMIT;
  db.__tables.ai_usage_daily = [];
  db.__tables.ai_usage_instance_daily = [];
  db.__tables.users = userRows([OWNER.email, EDITOR.email]);
  db.__tables.presentations = [
    {
      id: DECK,
      organization_id: ORG,
      title: 'Plan',
      owner_email: OWNER.email,
      created_by: OWNER.email,
      updated_by: OWNER.email,
      owner_user_id: OWNER.id,
      created_by_user_id: OWNER.id,
      updated_by_user_id: OWNER.id,
      visibility: 'organization',
      theme: 'default',
      lang: 'en',
      revision: 1,
      is_view_only: false,
      slides,
      i18n: {
        dominant: 'en',
        active: 'en',
        versions: { en: { title: 'Plan', slides } },
      },
      settings: {},
      created_at: '2026-02-01T00:00:00.000Z',
      modified_at: '2026-02-01T00:00:00.000Z',
      trashed_at: null,
    },
  ];
  db.__tables.presentation_collaborators = [];
}

/** Swap the provider's `fetch` for a double that reports tokens; counts calls. */
function countModelCalls(t) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"description":"One. Two."}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

function jsonReq(method, body = null) {
  const payload = body ? JSON.stringify(body) : '';
  return {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    on() {},
    once() {},
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
}

/** Generate a description as the internal dispatcher would, for `actor`. */
async function generateDescription(actor) {
  const res = createMockRes();
  const storageScope = createStorageScope(actor, { repoRoot: process.cwd() });
  await runWithAiAttribution(storageScope, () =>
    handlePresentations({
      repoRoot: process.cwd(),
      storageScope,
      req: jsonReq('POST', {}),
      res,
      url: new URL(
        `http://decks.example.test/api/presentations/${DECK}/description/generate`,
      ),
      authedUser: actor,
    }),
  );
  return res;
}

async function readUsage(actor) {
  const res = createMockRes();
  await handleSettings({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(actor, { repoRoot: process.cwd() }),
    req: jsonReq('GET'),
    res,
    url: new URL(
      'http://decks.example.test/api/settings/organization/ai-usage?days=7',
    ),
    authedUser: actor,
  });
  return res;
}

const today = () => usageDay();

test('each model call is counted for its organization and person, with tokens', async (t) => {
  seed();
  const calls = countModelCalls(t);

  assert.equal((await generateDescription(OWNER)).statusCode, 200);
  assert.equal((await generateDescription(OWNER)).statusCode, 200);
  assert.equal((await generateDescription(EDITOR)).statusCode, 200);

  assert.equal(calls.length, 3);
  const rows = db.__tables.ai_usage_daily;
  const owner = rows.find((r) => r.actor_email === OWNER.email);
  const editor = rows.find((r) => r.actor_email === EDITOR.email);
  assert.equal(owner.organization_id, ORG);
  assert.equal(owner.date, today());
  assert.equal(owner.calls, 2);
  assert.equal(owner.input_tokens, 200);
  assert.equal(owner.output_tokens, 40);
  assert.equal(editor.calls, 1);
  assert.equal(db.__tables.ai_usage_instance_daily[0].calls, 3);
});

test("the organization's admin reads today's spend per day and per person", async (t) => {
  seed();
  countModelCalls(t);
  await generateDescription(OWNER);
  await generateDescription(EDITOR);
  await generateDescription(EDITOR);

  const res = await readUsage(OWNER);

  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  const body = res.json();
  assert.deepEqual(body.days, [
    {
      day: today(),
      calls: 3,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ]);
  assert.equal(body.today.total.calls, 3);
  assert.deepEqual(
    body.today.people.map((p) => [p.person?.id, p.calls]),
    [
      [EDITOR.id, 2],
      [OWNER.id, 1],
    ],
  );
  assert.ok(
    !JSON.stringify(body).includes('@'),
    'no address crosses the boundary',
  );
  assert.deepEqual(body.ceiling, { limit: 0, used: 3 });
});

test('a member who does not administer the organization is refused the read', async () => {
  seed();
  const res = await readUsage(EDITOR);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json()?.error, 'forbidden');
});

test('the daily ceiling refuses with 429 ai_quota_exceeded and sends nothing', async (t) => {
  seed();
  process.env.AI_DAILY_CALL_LIMIT = '2';
  t.after(() => delete process.env.AI_DAILY_CALL_LIMIT);
  const calls = countModelCalls(t);

  assert.equal((await generateDescription(OWNER)).statusCode, 200);
  assert.equal((await generateDescription(EDITOR)).statusCode, 200);
  const refused = await generateDescription(OWNER);

  assert.equal(refused.statusCode, 429);
  const body = refused.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'ai_quota_exceeded');
  assert.equal(body.details.limit, 2);
  assert.equal(body.details.used, 2);
  assert.ok(body.details.retryAfter > 0 && body.details.retryAfter <= 86400);
  assert.equal(calls.length, 2, 'the refused call never reached the vendor');
  const owner = db.__tables.ai_usage_daily.find(
    (r) => r.actor_email === OWNER.email,
  );
  assert.equal(owner.calls, 1, 'a refused call is not counted as spend');
});

test('the ceiling holds for concurrent calls: exactly the limit goes out', async (t) => {
  seed();
  process.env.AI_DAILY_CALL_LIMIT = '3';
  t.after(() => delete process.env.AI_DAILY_CALL_LIMIT);
  const calls = countModelCalls(t);
  const scope = createStorageScope(OWNER, { repoRoot: process.cwd() });

  const results = await runWithAiAttribution(scope, () =>
    Promise.allSettled(
      Array.from({ length: 6 }, () =>
        requestChatCompletionContent({
          vendor: 'openai',
          apiKey: 'test-key',
          model: 'test-model',
          messages: [{ role: 'system', content: 'Answer.' }],
        }),
      ),
    ),
  );

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(refused.length, 3);
  assert.ok(refused.every((r) => r.reason instanceof AiQuotaError));
  assert.equal(calls.length, 3);
});

test('the internal dispatcher binds the request scope to every model call', async (t) => {
  seed();
  const calls = countModelCalls(t);
  const res = createMockRes();

  await handleApi({
    repoRoot: process.cwd(),
    req: jsonReq('POST', {}),
    res,
    url: new URL(
      `http://decks.example.test/api/presentations/${DECK}/description/generate`,
    ),
  });

  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  assert.equal(calls.length, 1);
  const [row] = db.__tables.ai_usage_daily;
  assert.equal(row.organization_id, ORG);
  assert.equal(row.actor_email, 'anonymous');
  assert.equal(row.calls, 1);
});

test('an MCP tools/call is counted for the scope registerTools names', async (t) => {
  seed();
  countModelCalls(t);
  const server = new McpServer();
  server.attributeCallsWith((context) => ({
    organizationId: ORG,
    actorEmail: context.ownerEmail,
    repoRoot: process.cwd(),
  }));
  server.tool(
    'ask',
    'Ask the model.',
    { type: 'object' },
    async () =>
      requestChatCompletionContent({
        vendor: 'openai',
        apiKey: 'test-key',
        model: 'test-model',
        messages: [{ role: 'system', content: 'Answer.' }],
      }),
    { readOnly: true },
  );

  await server._handleToolsCall(
    1,
    { name: 'ask', arguments: {} },
    {
      ownerEmail: EDITOR.email,
    },
  );

  const [row] = db.__tables.ai_usage_daily;
  assert.equal(row?.actor_email, EDITOR.email);
  assert.equal(row.calls, 1);
});

test('a call outside any attribution counts on the instance total only', async (t) => {
  seed();
  countModelCalls(t);

  await requestChatCompletionContent({
    vendor: 'openai',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [{ role: 'system', content: 'Answer.' }],
  });

  assert.deepEqual(db.__tables.ai_usage_daily, []);
  assert.equal(db.__tables.ai_usage_instance_daily[0].calls, 1);
});
