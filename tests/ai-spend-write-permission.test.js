/**
 * Spending the installation's model budget asks for write (DY-816).
 *
 * `compare-ai`, `description/generate` and `translate/fields` return their
 * answer instead of persisting it, which is how they ended up on read: nothing
 * in the deck changes. But each of them spends tokens, so a collaborator who
 * may only look could run down the budget of the whole installation.
 *
 * House shape: the exported route module is called with a req/res double over
 * `tests/helpers/fake-db.js`, with the storage scope the router builds, so a
 * request goes through the route table and `loadPresentationForActor` rather
 * than a helper called in isolation. The provider's `fetch` is the only way
 * out, so "no model call" is a count, not an inference from the status code.
 * The people who may spend are asserted against the same double: without them
 * a refusal for an unrelated reason would pass this file.
 *
 * Run with: node --test tests/ai-spend-write-permission.test.js
 */

import { createMockRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
delete process.env.SANDBOX_MODE;
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'd0000816-0000-4000-8000-000000000001';
const VERSION = 'd0000816-0000-4000-8000-000000000002';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');

const person = (name) => {
  const email = `${name}@example.com`;
  return {
    id: userIdFor(email),
    email,
    name,
    role: 'user',
    organizationId: ORG,
  };
};
const OWNER = person('owner');
const EDITOR = person('editor');
const COMMENTER = person('commenter');
const VIEWER = person('viewer');
const OUTSIDER = person('outsider');
const EVERYONE = [OWNER, EDITOR, COMMENTER, VIEWER, OUTSIDER];

/** The model's answer: valid for all three, each reads what it needs. */
const MODEL_ANSWER = JSON.stringify({
  description: 'First sentence. Second sentence.',
  summary: 'One change.',
  insights: [],
  translations: { title: 'Plan' },
});

/** The three routes, each with a body it would accept from someone who may. */
const ROUTES = [
  { path: `versions/${VERSION}/compare-ai`, body: {} },
  { path: 'description/generate', body: {} },
  {
    path: 'translate/fields',
    body: { from: 'nl', to: 'en-GB', fields: { title: 'Het plan' } },
  },
];

const slides = (title) => [
  { id: 's1', type: 'content-slide', content: { title, body: 'Tekst.' } },
];

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
});

const collaborator = (actor, permission) => ({
  id: `c-${actor.name}`,
  organization_id: ORG,
  presentation_id: DECK,
  user_id: actor.id,
  user_email: actor.email,
  permission,
  invited_by: OWNER.email,
  created_at: '2026-02-01T00:00:00.000Z',
  revoked_at: null,
});

/**
 * One private Dutch deck with an older snapshot, shared at each level.
 * @param {{isViewOnly?: boolean, visibility?: string}} [deck]
 */
function seed({ isViewOnly = false, visibility = 'private' } = {}) {
  db.__tables.users = userRows(EVERYONE.map((p) => p.email));
  db.__tables.presentations = [
    {
      id: DECK,
      organization_id: ORG,
      title: 'Het plan',
      owner_email: OWNER.email,
      created_by: OWNER.email,
      updated_by: OWNER.email,
      owner_user_id: OWNER.id,
      created_by_user_id: OWNER.id,
      updated_by_user_id: OWNER.id,
      visibility,
      theme: 'default',
      lang: 'nl',
      revision: 1,
      is_view_only: isViewOnly,
      slides: slides('Het plan'),
      i18n: {
        dominant: 'nl',
        active: 'nl',
        versions: { nl: { title: 'Het plan', slides: slides('Het plan') } },
      },
      settings: {},
      created_at: '2026-02-01T00:00:00.000Z',
      modified_at: '2026-02-01T00:00:00.000Z',
      trashed_at: null,
    },
  ];
  db.__tables.presentation_versions = [
    {
      id: VERSION,
      organization_id: ORG,
      presentation_id: DECK,
      presentation_data: { title: 'Oud', slides: slides('Het oude plan') },
      reason: 'manual',
      created_at: '2026-01-15T00:00:00.000Z',
    },
  ];
  db.__tables.presentation_collaborators = [
    collaborator(EDITOR, 'edit'),
    collaborator(COMMENTER, 'comment'),
    collaborator(VIEWER, 'view'),
  ];
  for (const actor of EVERYONE) invalidatePermission(DECK, actor.email);
}

/** Swap the provider's `fetch` for a double for one test; counts the calls. */
function countModelCalls(t) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: MODEL_ANSWER } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

async function post(actor, { path, body }) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = createMockRes();
  await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(actor, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test/api/presentations/${DECK}/${path}`),
    authedUser: actor,
  });
  return res;
}

for (const route of ROUTES) {
  for (const actor of [VIEWER, COMMENTER]) {
    test(`${route.path}: a ${actor.name} is refused and no model call goes out`, async (t) => {
      seed();
      const calls = countModelCalls(t);

      const res = await post(actor, route);

      assert.equal(res.statusCode, 403);
      assert.equal(res.json()?.ok, false);
      assert.equal(calls.length, 0);
    });
  }

  test(`${route.path}: someone with no share gets no model call either`, async (t) => {
    seed();
    const calls = countModelCalls(t);

    const res = await post(OUTSIDER, route);

    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0);
  });

  test(`${route.path}: a colleague on a view-only organization deck is refused`, async (t) => {
    seed({ isViewOnly: true, visibility: 'organization' });
    const calls = countModelCalls(t);

    const res = await post(OUTSIDER, route);

    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0);
  });

  for (const actor of [OWNER, EDITOR]) {
    test(`${route.path}: the ${actor.name} still reaches the model`, async (t) => {
      seed();
      const calls = countModelCalls(t);

      const res = await post(actor, route);

      assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
      assert.equal(res.json()?.ok, true);
      assert.ok(calls.length >= 1);
    });
  }
}
