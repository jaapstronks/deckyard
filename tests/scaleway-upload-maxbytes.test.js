/**
 * B84 meelift — ScalewayProvider.uploadBuffer honours the `maxBytes` ceiling.
 *
 * LocalProvider enforced a caller's `maxBytes`; Scaleway silently ignored it, so
 * a bound like the Notion re-host's 20MB cap held only on local storage. The
 * check runs before any S3 client is built, so this needs no AWS mock.
 *
 * Run with: node --test tests/scaleway-upload-maxbytes.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';

// Minimal SCW_* config so getScalewayConfig() resolves in the constructor.
const SAVED = {};
before(() => {
  for (const k of [
    'SCW_ACCESS_KEY',
    'SCW_SECRET_KEY',
    'SCW_BUCKET',
    'SCW_REGION',
  ]) {
    SAVED[k] = process.env[k];
  }
  process.env.SCW_ACCESS_KEY = 'ak-test';
  process.env.SCW_SECRET_KEY = 'sk-test';
  process.env.SCW_BUCKET = 'bucket-test';
  process.env.SCW_REGION = 'nl-ams';
});
after(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { ScalewayProvider } = await import('../server/media/scaleway.js');

test('rejects a buffer over the caller-supplied maxBytes before uploading', async () => {
  const provider = new ScalewayProvider();
  const buffer = Buffer.alloc(1024, 0x41); // 1KB
  await assert.rejects(
    () =>
      provider.uploadBuffer({
        buffer,
        filename: 'big',
        contentType: 'image/png',
        maxBytes: 512,
      }),
    /File too large/,
    'a 1KB buffer must be refused under a 512-byte cap, without reaching S3',
  );
});

test('rejects a buffer over the 20MB default when no maxBytes is given', async () => {
  const provider = new ScalewayProvider();
  const buffer = Buffer.alloc(20 * 1024 * 1024 + 1, 0x41); // just over 20MB
  await assert.rejects(
    () =>
      provider.uploadBuffer({
        buffer,
        filename: 'huge',
        contentType: 'image/png',
      }),
    /File too large/,
  );
});
