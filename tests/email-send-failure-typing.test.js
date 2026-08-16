/**
 * sendEmail failure typing (B60).
 *
 * The email test-send route used to answer 502 internal_error for every
 * sendEmail failure — including "BREVO_API_KEY not configured", which is an
 * operator problem, not an upstream one. `sendEmail` now types its failures
 * via `reason`, and these tests pin the two shapes so the route mapping
 * (501 email_not_configured vs 502 internal_error) stays honest.
 *
 * Run with: node --test tests/email-send-failure-typing.test.js
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../server/integrations/email/core.js';

const savedKey = process.env.BREVO_API_KEY;
const savedFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.BREVO_API_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = savedKey;
  globalThis.fetch = savedFetch;
});

const args = {
  to: 'test@example.com',
  subject: 'x',
  htmlContent: '<p>x</p>',
};

test('a missing Brevo key resolves as not_configured without touching the network', async () => {
  globalThis.fetch = () => {
    throw new Error('network must not be touched');
  };
  const result = await sendEmail(args);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_configured');
  assert.match(result.error, /BREVO_API_KEY/);
});

test('a provider HTTP error resolves as upstream with the status', async () => {
  process.env.BREVO_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'unauthorized',
  });
  const result = await sendEmail(args);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'upstream');
  assert.equal(result.status, 401);
  assert.equal(result.error, 'unauthorized');
});

test('a network failure resolves as upstream', async () => {
  process.env.BREVO_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.brevo.com');
  };
  const result = await sendEmail(args);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'upstream');
  assert.match(result.error, /ENOTFOUND/);
});

test('a successful send carries no reason', async () => {
  process.env.BREVO_API_KEY = 'test-key';
  globalThis.fetch = async () => ({ ok: true, status: 201 });
  const result = await sendEmail(args);
  assert.deepEqual(result, { ok: true, status: 201 });
});
