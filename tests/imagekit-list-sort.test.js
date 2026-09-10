/**
 * ImageKit listings are newest-first.
 *
 * `GET /v1/files` without a `sort` returns oldest-first, so a library that
 * grew past one page showed only its oldest uploads and the tag sample only
 * held the oldest tags — the bug reported on slides.ciiic.nl, where a hundred
 * photos uploaded in April were invisible behind the December import.
 *
 * These pin the URL the module builds: the default sort, a caller narrowing
 * it to another accepted value, and the refusal of anything else.
 *
 * Run with: node --test tests/imagekit-list-sort.test.js
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  listImageKitFiles,
  listImageKitTags,
  IMAGEKIT_DEFAULT_SORT,
} from '../server/media/imagekit.js';
import { ValidationError } from '../server/utils/errors.js';

const ENV_KEYS = [
  'IMAGEKIT_PRIVATE_KEY',
  'IMAGEKIT_PUBLIC_KEY',
  'IMAGEKIT_URL_ENDPOINT',
];

let savedEnv;
let savedFetch;
/** @type {string[]} */
let requested;

/** Answer every ImageKit call with `body`, recording the URLs asked for. */
function stubFetch(body) {
  requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

beforeEach(() => {
  savedEnv = ENV_KEYS.map((k) => [k, process.env[k]]);
  process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
  process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = savedFetch;
});

test('listImageKitFiles asks for the newest files by default', async () => {
  stubFetch([]);
  await listImageKitFiles({ limit: 60 });

  assert.equal(requested.length, 1);
  const params = new URL(requested[0]).searchParams;
  assert.equal(params.get('sort'), IMAGEKIT_DEFAULT_SORT);
  assert.equal(IMAGEKIT_DEFAULT_SORT, 'DESC_CREATED');
  assert.equal(params.get('limit'), '60');
  assert.equal(params.get('skip'), '0');
  assert.equal(params.get('includeCustomMetadata'), 'true');
});

test('a caller may narrow the sort to another accepted value', async () => {
  stubFetch([]);
  await listImageKitFiles({ sort: 'asc_name' });

  const params = new URL(requested[0]).searchParams;
  assert.equal(params.get('sort'), 'ASC_NAME');
});

test('an unsupported sort is refused, not silently dropped', async () => {
  stubFetch([]);
  await assert.rejects(
    () => listImageKitFiles({ sort: 'BY_VIBES' }),
    (err) =>
      err instanceof ValidationError &&
      err.statusCode === 400 &&
      /BY_VIBES/.test(err.message),
  );
  assert.equal(requested.length, 0, 'no upstream call for a refused sort');
});

test('the tag sample is drawn from the newest files', async () => {
  // One short batch ends the loop; one URL is enough to pin the sort.
  stubFetch([{ tags: ['jaarevent-2026'] }]);
  const tags = await listImageKitTags();

  assert.deepEqual(tags, [{ tag: 'jaarevent-2026', count: 1 }]);
  assert.equal(requested.length, 1);
  assert.equal(
    new URL(requested[0]).searchParams.get('sort'),
    IMAGEKIT_DEFAULT_SORT,
  );
});
