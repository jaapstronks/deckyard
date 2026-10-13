import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleAdminUsers } from '../server/routes/api/admin-users.js';
import { resetRateLimitBuckets } from '../server/utils/rate-limit.js';
import { closeRedis } from '../server/utils/redis-client.js';

test('admin creates await the shared email bucket across organizations', async (t) => {
  const originalNow = Date.now;
  const originalUrl = process.env.REDIS_URL;
  const originalEnabled = process.env.REDIS_ENABLED;
  let now = 1_000_000;
  Date.now = () => now;
  if (process.env.RATE_LIMIT_TEST_REDIS_URL) {
    process.env.REDIS_URL = process.env.RATE_LIMIT_TEST_REDIS_URL;
    process.env.REDIS_ENABLED = 'true';
  } else process.env.REDIS_ENABLED = 'false';
  resetRateLimitBuckets();
  t.after(async () => {
    Date.now = originalNow;
    resetRateLimitBuckets();
    await closeRedis();
    for (const [name, value] of [
      ['REDIS_URL', originalUrl],
      ['REDIS_ENABLED', originalEnabled],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const email = `admin-${process.pid}@example.test`;
  async function create(adminEmail, organizationId) {
    const req = Readable.from([JSON.stringify({ email: 'invalid' })]);
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json' };
    let payload;
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(status, headers) {
        this.statusCode = status;
        for (const [name, value] of Object.entries(headers || {}))
          this.setHeader(name, value);
      },
      end(body) {
        payload = JSON.parse(body);
      },
    };
    await handleAdminUsers({
      req,
      res,
      repoRoot: process.cwd(),
      url: new URL('http://localhost/api/admin/users'),
      authedUser: { email: adminEmail, isAdmin: true },
      storageScope: { organizationId },
    });
    return { status: res.statusCode, headers: res.headers, body: payload };
  }
  // Invalid form attempts still consume, matching the original guard position.
  for (let i = 0; i < 20; i++) {
    assert.equal((await create(email, i % 2 ? 'org-a' : 'org-b')).status, 400);
  }
  const refused = await create(email, 'org-b');
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, 'rate_limited');
  assert.equal(refused.headers['retry-after'], '3600');
  assert.equal((await create('other-' + email, 'org-a')).status, 400);
  now += 179_999;
  assert.equal((await create(email, 'org-a')).status, 429);
  now += 1;
  assert.equal((await create(email, 'org-b')).status, 400);
});
