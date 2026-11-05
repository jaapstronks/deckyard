/**
 * What a model answers passes the declared-field validation before anyone
 * receives it (DY-813). `POST /api/ai/convert-slide` hands the editor a slide it
 * renders at once and `POST /api/v1/ai/append-slides` hands an integration a
 * batch nobody reviews; neither route writes, so no write seam stood between
 * the model and a `javascript:` link. The end slide closes the same hole on the
 * other side: a value already stored renders as no link at all.
 *
 * Run with: node --test tests/ai-output-field-validation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
delete process.env.SANDBOX_MODE;
delete process.env.DEMO_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };
const EVIL = 'javascript:alert(1)';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleAi } = await import('../server/routes/public-api/v1/ai.js');
const { handleAiConvertSlide } =
  await import('../server/routes/api/ai/convert-slide.js');
const { SLIDE_TYPES } = await import('../shared/slide-types.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
      themes: [],
      presentations: [],
      api_usage_daily: [],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

function stubModel(t, answer) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  t.after(() => {
    globalThis.fetch = saved;
  });
}

async function convert() {
  const res = createMockRes();
  await handleAiConvertSlide({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({
      method: 'POST',
      body: {
        slide: {
          id: 's1',
          type: 'list-slide',
          content: { title: 'Plan', items: [{ text: 'One' }] },
        },
        toType: 'content-slide',
        lang: 'en',
      },
    }),
    res,
    url: new URL('http://localhost/api/ai/convert-slide'),
    authedUser: AUTHED,
  });
  return res;
}

test('convert-slide refuses a model answer with a javascript: link', async (t) => {
  stubModel(t, {
    title: 'Plan',
    body: 'Text',
    actions: [{ label: 'Open', url: EVIL }],
  });
  const res = await convert();
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().details.field, 'actions');
  assert.equal(res.json().slide, undefined, 'no slide reaches the editor');
});

test('convert-slide still answers a sound conversion', async (t) => {
  stubModel(t, {
    title: 'Plan',
    body: 'Text',
    actions: [{ label: 'Open', url: 'https://example.com/' }],
  });
  const res = await convert();
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().slide.type, 'content-slide');
});

async function appendV1() {
  const req = Readable.from([
    Buffer.from(JSON.stringify({ raw: 'Contact page', lang: 'en' })),
  ]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = createMockRes();
  await handleAi({
    req,
    res,
    url: new URL('http://localhost/api/v1/ai/append-slides'),
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    apiKey: {
      id: 'key-1',
      tier: 'free',
      name: 'Bot',
      ownerEmail: OWNER,
      permissions: ['ai'],
      organizationId: ORG,
    },
    authedUser: AUTHED,
  });
  return res;
}

const endSlideBatch = (contactUrl) => ({
  slides: [{ type: 'end-slide', content: { title: 'Thanks', contactUrl } }],
});

test('v1 append-slides refuses a batch with a javascript: link', async (t) => {
  stubModel(t, endSlideBatch(EVIL));
  const res = await appendV1();
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().details.field, 'contactUrl');
  assert.equal(res.json().slides, undefined, 'no slides reach the integration');
});

test('v1 append-slides still answers a sound batch', async (t) => {
  stubModel(t, endSlideBatch('https://example.com/'));
  const res = await appendV1();
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().slides[0].content.contactUrl, 'https://example.com/');
});

test('the end slide renders no link for a value safeHref refuses', () => {
  const render = (content) =>
    SLIDE_TYPES['end-slide'].renderHtml({ title: 'Thanks', ...content });
  const bad = render({
    contactUrl: EVIL,
    social1Label: 'One',
    social1Url: EVIL,
    social2Label: 'Two',
    social2Url: 'data:text/html,x',
  });
  assert.doesNotMatch(bad, /javascript:|data:text/);
  assert.doesNotMatch(bad, /end-contact|end-social-link/);

  const good = render({
    contactUrl: 'https://example.com/',
    social1Label: 'One',
    social1Url: 'https://example.org/',
  });
  assert.match(good, /href="https:\/\/example\.com\/"/);
  assert.match(good, /class="end-social-link" href="https:\/\/example\.org\/"/);
});
