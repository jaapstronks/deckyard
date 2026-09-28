/**
 * B510 — S3Provider private objects: stored without a public address, and
 * refused when the bucket would serve them anyway.
 *
 * An S3 object's visibility is decided by the bucket policy (or a CDN in front
 * of it), which the app cannot read. So `uploadPrivateBuffer` asks, after the
 * write, anonymously, at every public address the object could have. A 2xx
 * there is a bucket that serves `private/` to the world: the object is deleted
 * and the upload refused. A 403/404 is the proof the briefing asks for
 * ("anonymous GET → 403"), taken on every upload rather than once by hand.
 *
 * The AWS client is replaced by a recorder; no bucket is involved.
 *
 * Run with: node --test tests/s3-private-object.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SAVED = {};
before(() => {
  for (const k of [
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ENDPOINT',
    'S3_PUBLIC_URL',
  ]) {
    SAVED[k] = process.env[k];
  }
  process.env.S3_ACCESS_KEY = 'ak-test';
  process.env.S3_SECRET_KEY = 'sk-test';
  process.env.S3_BUCKET = 'media';
  process.env.S3_REGION = 'nl-ams';
  process.env.S3_ENDPOINT = 'https://s3.nl-ams.example.com';
  process.env.S3_PUBLIC_URL = 'https://cdn.example.com';
});
after(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const { S3Provider } = await import('../server/media/s3.js');

const FONT = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);

/** A provider whose AWS client records commands and whose probe answers `status`. */
async function providerAnswering(status) {
  const provider = new S3Provider();
  await provider._getClient(); // load the SDK command classes
  const sent = [];
  provider._client = {
    async send(cmd) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return {};
    },
  };
  const probed = [];
  provider._fetch = async (url, init) => {
    probed.push({ url, method: init?.method });
    if (status === 'offline') throw new Error('getaddrinfo ENOTFOUND');
    return { ok: status >= 200 && status < 300, status };
  };
  return { provider, sent, probed };
}

test('a private object is written under private/ without an ACL', async () => {
  const { provider, sent, probed } = await providerAnswering(403);
  const out = await provider.uploadPrivateBuffer({
    buffer: FONT,
    filename: 'gt-america-500-normal',
    contentType: 'font/woff2',
    folder: 'fonts',
  });

  assert.match(
    out.key,
    /^private\/fonts\/gt-america-500-normal-[0-9a-f-]+\.woff2$/,
  );
  assert.equal(out.publicUrl, undefined, 'a private object has no public URL');

  const put = sent.find((c) => c.name === 'PutObjectCommand');
  assert.equal(put.input.Key, out.key);
  assert.equal(put.input.ACL, undefined);
  assert.ok(!sent.some((c) => c.name === 'DeleteObjectCommand'));

  assert.deepEqual(
    probed.map((p) => p.url),
    [
      `https://cdn.example.com/${out.key}`,
      `https://media.s3.nl-ams.example.com/${out.key}`,
    ],
    'both the CDN base and the direct bucket URL are probed anonymously',
  );
  assert.ok(probed.every((p) => p.method === 'HEAD'));
});

test('a bucket that serves private/ publicly gets the object deleted and the upload refused', async () => {
  const { provider, sent } = await providerAnswering(200);
  await assert.rejects(
    provider.uploadPrivateBuffer({
      buffer: FONT,
      filename: 'gt-america',
      contentType: 'font/woff2',
      folder: 'fonts',
    }),
    (err) =>
      err.code === 'PRIVATE_OBJECT_PUBLIC' && /uploads\/\*/.test(err.message),
  );
  const put = sent.find((c) => c.name === 'PutObjectCommand');
  const del = sent.find((c) => c.name === 'DeleteObjectCommand');
  assert.ok(del, 'the exposed object is removed again');
  assert.equal(del.input.Key, put.input.Key);
});

test('a probe with no answer does not block the upload', async () => {
  const { provider, sent } = await providerAnswering('offline');
  const out = await provider.uploadPrivateBuffer({
    buffer: FONT,
    filename: 'f',
    contentType: 'font/woff2',
    folder: 'fonts',
  });
  assert.match(out.key, /^private\/fonts\//);
  assert.ok(!sent.some((c) => c.name === 'DeleteObjectCommand'));
});

test('readFile returns the bytes, and null for a missing key', async () => {
  const provider = new S3Provider();
  await provider._getClient();
  provider._client = {
    async send(cmd) {
      if (cmd.input.Key === 'private/fonts/missing.woff2') {
        const err = new Error('nope');
        err.name = 'NoSuchKey';
        throw err;
      }
      return {
        Body: { transformToByteArray: async () => new Uint8Array(FONT) },
      };
    },
  };
  assert.deepEqual(await provider.readFile('private/fonts/a.woff2'), FONT);
  assert.equal(await provider.readFile('private/fonts/missing.woff2'), null);
});
