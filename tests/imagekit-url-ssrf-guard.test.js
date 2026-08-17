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

import { test, before, after } from 'node:test';
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
