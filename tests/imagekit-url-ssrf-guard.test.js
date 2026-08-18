/**
 * B84 — SSRF guard on the ImageKit re-host path.
 *
 * `uploadImageKitUrl` fetches an image URL server-side to push it to ImageKit.
 * When importing from Notion that URL can be an attacker-controlled `external`
 * image URL, so one resolving to a private/link-local address must be refused
 * before the fetch, falling back to the original URL (the existing pattern).
 *
 * Run with: node --test tests/imagekit-url-ssrf-guard.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert';

// Configure ImageKit so uploadImageKitUrl takes the fetch-and-upload path
// (unconfigured, it returns the original URL before the guard even runs).
process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';

const { uploadImageKitUrl } = await import('../server/media/imagekit.js');

const savedFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = savedFetch;
});

test('SSRF: a private-range image URL is refused before fetch and the original URL is returned', async () => {
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error('fetch must not be called for a blocked URL');
  };

  const METADATA_URL = 'http://169.254.169.254/latest/meta-data/img.jpg';
  const result = await uploadImageKitUrl(METADATA_URL, 'notion-x.jpg');

  assert.equal(fetched, false, 'the blocked URL is never fetched');
  assert.equal(result, METADATA_URL, 'falls back to the original URL when blocked');
});

test('the image fetch goes through the hardened helper: no redirects, with a timeout', async () => {
  // A redirect from a public host into private space would bypass a
  // check-then-plain-fetch sequence, so the call site must use
  // safeFetchRemoteImage, which fetches with redirect: 'error' and a signal.
  let imageFetchOpts;
  globalThis.fetch = async (url, opts) => {
    if (imageFetchOpts === undefined) imageFetchOpts = opts;
    return {
      ok: true,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
      arrayBuffer: async () => new ArrayBuffer(4),
    };
  };

  await uploadImageKitUrl(
    'https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/img.png',
    'notion-z.png'
  );

  assert.equal(imageFetchOpts?.redirect, 'error', 'the image fetch must refuse redirects');
  assert.ok(imageFetchOpts?.signal, 'the image fetch must carry a timeout signal');
});

test('SSRF: a loopback URL is refused too', async () => {
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error('fetch must not be called for a blocked URL');
  };

  const LOOPBACK = 'http://127.0.0.1:8080/secret.jpg';
  const result = await uploadImageKitUrl(LOOPBACK, 'notion-y.jpg');

  assert.equal(fetched, false);
  assert.equal(result, LOOPBACK);
});
