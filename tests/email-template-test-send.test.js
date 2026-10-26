import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { handleEmailTemplates } from '../server/routes/api/email-templates.js';

const admin = { email: 'admin@example.test', name: 'Admin', isAdmin: true };
const storedSender = { email: 'stored@example.test', name: 'Stored Sender' };
const envKeys = [
  'MAIL_TRANSPORT',
  'BREVO_API_KEY',
  'MAIL_FROM',
  'MAIL_FROM_NAME',
];
let savedEnv;
let savedFetch;
let payloads;

function seedSender(sender) {
  __setTestDb(
    createFakeDb({
      app_settings: [{ singleton: true, settings: { emailSender: sender } }],
    }),
  );
}

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  savedFetch = globalThis.fetch;
  process.env.MAIL_TRANSPORT = 'brevo';
  process.env.BREVO_API_KEY = 'synthetic-test-key';
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_FROM_NAME;
  seedSender(storedSender);
  payloads = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    payloads.push(JSON.parse(init.body));
    return new Response('', { status: 201 });
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = savedFetch;
  __setTestDb(null);
});

async function sendTest(user = admin) {
  const res = createMockRes();
  const handled = await handleEmailTemplates({
    repoRoot: '/repo',
    req: createMockReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { locale: 'en', to: 'untrusted@example.test' },
    }),
    res,
    url: new URL(
      'http://example.test/api/admin/email-templates/passwordReset/test',
    ),
    authedUser: user,
  });
  assert.equal(handled, true);
  return { status: res.statusCode, body: res.json() };
}

for (const conflictingEnv of [false, true]) {
  test(`test mail uses the stored sender and display name with ${conflictingEnv ? 'conflicting' : 'no'} env sender`, async () => {
    if (conflictingEnv) {
      process.env.MAIL_FROM = 'env@example.test';
      process.env.MAIL_FROM_NAME = 'Environment Sender';
    }
    const result = await sendTest();
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].sender, storedSender);
    assert.deepEqual(payloads[0].to, [
      { email: admin.email, name: admin.name },
    ]);
    assert.match(payloads[0].subject, /^\[TEST\] /);
  });
}

test('test mail without any effective sender returns 501 before network', async () => {
  seedSender(null);
  const result = await sendTest();
  assert.equal(result.status, 501);
  assert.equal(result.body.error, 'email_not_configured');
  assert.equal(payloads.length, 0);
});

test('test mail maps provider refusal to 502', async () => {
  process.env.MAIL_FROM = 'env@example.test';
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return new Response('synthetic refusal', { status: 503 });
  };
  const result = await sendTest();
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'internal_error');
  assert.equal(payloads.length, 1);
});

test('test mail requires an authenticated admin before network', async () => {
  const anonymous = await sendTest(null);
  assert.equal(anonymous.status, 401);
  const member = await sendTest({ ...admin, isAdmin: false });
  assert.equal(member.status, 403);
  assert.equal(payloads.length, 0);
});
