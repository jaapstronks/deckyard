/**
 * `getAllowedHosts()` and the Host-header check that reads it.
 *
 * The accessor moved out of `server/utils/config.js` (deleted) into
 * `server/config/utils.js` and now parses `ALLOWED_HOSTS` through the shared
 * `envList` helper instead of a hand-rolled split/trim/filter — one list
 * parser, not two (D31, A7.22). `envList` lowercases and de-duplicates, so the
 * Host comparison in `buildRequestUrl` lowercases the request host too. This
 * pins that behaviour so the tightening cannot silently regress.
 *
 * Run with: node --test tests/allowed-hosts.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getAllowedHosts } from '../server/config/utils.js';
import { buildRequestUrl } from '../server/utils/request-url.js';

/** Minimal request double with a Host header. */
const reqWithHost = (host) => ({ headers: { host }, socket: {} });

test('unset ALLOWED_HOSTS yields an empty list (allow any host)', () => {
  delete process.env.ALLOWED_HOSTS;
  assert.deepEqual(getAllowedHosts(), []);
});

test('the list is lowercased, de-duplicated, and split on commas or whitespace', () => {
  process.env.ALLOWED_HOSTS = 'Example.com, example.com  DECK.app';
  assert.deepEqual(getAllowedHosts(), ['example.com', 'deck.app']);
  delete process.env.ALLOWED_HOSTS;
});

test('a mixed-case request Host matches a configured host case-insensitively', () => {
  process.env.ALLOWED_HOSTS = 'example.com';
  const url = buildRequestUrl(reqWithHost('Example.com'), '/deck');
  // Accepted (non-null); the URL origin is normalised lowercase by URL parsing.
  assert.equal(url, 'http://example.com/deck');
  delete process.env.ALLOWED_HOSTS;
});

test('a host outside the allow-list is rejected (null URL)', () => {
  process.env.ALLOWED_HOSTS = 'example.com';
  const url = buildRequestUrl(reqWithHost('evil.test'), '/deck');
  assert.equal(url, null);
  delete process.env.ALLOWED_HOSTS;
});
