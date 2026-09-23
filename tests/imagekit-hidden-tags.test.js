/**
 * `IMAGEKIT_HIDDEN_TAGS` keeps tagged files out of the picker, not out of reach.
 *
 * An installation can tag files that must stay resolvable (existing slides
 * point at them) but no longer belong in the image picker — the CIIIC
 * beeldbank tags its de-duplicated copies `_duplicaat`. These pin the URLs the
 * module builds: listings and the tag sample get a `tags NOT IN [...]` clause,
 * lookups by id do not, and an unset value changes no request at all.
 *
 * Run with: node --test tests/imagekit-hidden-tags.test.js
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  getImageKitConfigFromEnv,
  listImageKitFiles,
  listImageKitTags,
  getImageKitFileDetails,
  patchImageKitFileDetails,
} from '../server/media/imagekit.js';

const ENV_KEYS = [
  'IMAGEKIT_PRIVATE_KEY',
  'IMAGEKIT_PUBLIC_KEY',
  'IMAGEKIT_URL_ENDPOINT',
  'IMAGEKIT_HIDDEN_TAGS',
];

let savedEnv;
let savedFetch;
/** @type {Array<{ url: string, method: string }>} */
let requested;

/** Answer every ImageKit call with `body`, recording what was asked for. */
function stubFetch(body) {
  requested = [];
  globalThis.fetch = async (url, opts = {}) => {
    requested.push({ url: String(url), method: opts.method || 'GET' });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** @returns {string | null} */
function searchQueryOf(i = 0) {
  return new URL(requested[i].url).searchParams.get('searchQuery');
}

/** Every request the listing/lookup surface makes, for before/after comparison. */
async function exerciseAll() {
  stubFetch([{ fileId: 'f1', tags: ['team'] }]);
  await listImageKitFiles({});
  await listImageKitFiles({ q: 'Esther' });
  await listImageKitFiles({ searchQuery: 'format = "png"' });
  await listImageKitTags();
  await getImageKitFileDetails('f1');
  await patchImageKitFileDetails('f1', { tags: ['x'] });
  return requested.map((r) => `${r.method} ${r.url}`);
}

beforeEach(() => {
  savedEnv = ENV_KEYS.map((k) => [k, process.env[k]]);
  process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
  process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';
  delete process.env.IMAGEKIT_HIDDEN_TAGS;
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = savedFetch;
});

test('the env value is read as a trimmed, de-duplicated list', () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = ' _duplicaat, ,_unsorted,_duplicaat ';
  assert.deepEqual(getImageKitConfigFromEnv().hiddenTags, [
    '_duplicaat',
    '_unsorted',
  ]);
  delete process.env.IMAGEKIT_HIDDEN_TAGS;
  assert.deepEqual(getImageKitConfigFromEnv().hiddenTags, []);
});

test('unset or empty: no request differs from not having the setting', async () => {
  const unset = await exerciseAll();
  assert.equal(
    new URL(unset[0].slice(4)).searchParams.has('searchQuery'),
    false,
    'a bare listing carries no searchQuery',
  );
  process.env.IMAGEKIT_HIDDEN_TAGS = ' , ';
  assert.deepEqual(await exerciseAll(), unset);
  process.env.IMAGEKIT_HIDDEN_TAGS = '';
  assert.deepEqual(await exerciseAll(), unset);
});

test('a bare listing gets the exclusion as its whole query', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = '_duplicaat,_unsorted';
  stubFetch([]);
  await listImageKitFiles({});
  assert.equal(searchQueryOf(), 'tags NOT IN ["_duplicaat", "_unsorted"]');
});

test('a free search term is ANDed with the exclusion', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = '_duplicaat';
  stubFetch([]);
  await listImageKitFiles({ q: 'esther' });
  const sq = searchQueryOf();
  assert.match(sq, /^\(\(name HAS "esther" OR tags HAS "esther" OR /);
  assert.ok(sq.endsWith(') AND tags NOT IN ["_duplicaat"]'), sq);
});

test('a caller searchQuery is parenthesised and ANDed', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = '_duplicaat';
  stubFetch([]);
  await listImageKitFiles({ searchQuery: 'tags IN ["a"] OR format = "png"' });
  assert.equal(
    searchQueryOf(),
    '(tags IN ["a"] OR format = "png") AND tags NOT IN ["_duplicaat"]',
  );
});

test('a quote or backslash in a tag cannot break out of the query', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = 'a"] OR name HAS "x,b\\';
  stubFetch([]);
  await listImageKitFiles({});
  assert.equal(
    searchQueryOf(),
    'tags NOT IN ["a\\"] OR name HAS \\"x", "b\\\\"]',
  );
});

test('the tag sample excludes hidden files, and never suggests the tag', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = '_duplicaat';
  // The stub ignores the query, so it also proves the client-side guard:
  // a file carrying the tag (in any case) contributes nothing.
  stubFetch([{ tags: ['team', 'event'] }, { tags: ['team', '_Duplicaat'] }]);
  const tags = await listImageKitTags();
  assert.equal(searchQueryOf(), 'tags NOT IN ["_duplicaat"]');
  assert.deepEqual(tags, [
    { tag: 'event', count: 1 },
    { tag: 'team', count: 1 },
  ]);
});

test('lookups by id are never filtered', async () => {
  process.env.IMAGEKIT_HIDDEN_TAGS = '_duplicaat';
  const file = { fileId: 'dup1', tags: ['_duplicaat'], customMetadata: {} };
  stubFetch(file);
  assert.deepEqual(await getImageKitFileDetails('dup1'), file);
  assert.deepEqual(await patchImageKitFileDetails('dup1', {}), file);
  for (const r of requested) {
    assert.equal(new URL(r.url).search, '', `${r.method} ${r.url}`);
    assert.equal(new URL(r.url).pathname, '/v1/files/dup1/details');
  }
});
