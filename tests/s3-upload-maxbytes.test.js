/**
 * B84 meelift — S3Provider.uploadBuffer honours the `maxBytes` ceiling.
 *
 * LocalProvider enforced a caller's `maxBytes`; the remote provider silently
 * ignored it, so a bound like the Notion re-host's 20MB cap held only on local
 * storage. The check runs before any S3 client is built, so this needs no AWS
 * mock.
 *
 * Run with: node --test tests/s3-upload-maxbytes.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';

// Minimal S3_* config so getS3Config() resolves in the constructor.
const SAVED = {};
before(() => {
  for (const k of [
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ENDPOINT',
  ]) {
    SAVED[k] = process.env[k];
  }
  process.env.S3_ACCESS_KEY = 'ak-test';
  process.env.S3_SECRET_KEY = 'sk-test';
  process.env.S3_BUCKET = 'bucket-test';
  process.env.S3_REGION = 'nl-ams';
  process.env.S3_ENDPOINT = 'https://s3.nl-ams.example.com';
});
after(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { S3Provider } = await import('../server/media/s3.js');

test('rejects a buffer over the caller-supplied maxBytes before uploading', async () => {
  const provider = new S3Provider();
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
  const provider = new S3Provider();
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
