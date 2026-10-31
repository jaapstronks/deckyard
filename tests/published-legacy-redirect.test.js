/**
 * Old publication links after T1.5: `/p/{publishId}-{slug}`, its reader and
 * `/embed/{publishId}-{slug}` answer a permanent redirect to the same
 * subresource of the first edition the conversion made of their deck
 * (`publication_legacy_links`, migration 105), never to a later edition and
 * never to the deck. The slug is ignored, `?lang=` is carried over, and an
 * old id that was never converted is a 404.
 *
 * Drives the real route over the in-memory database double.
 *
 * Run with: node --test tests/published-legacy-redirect.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');

const PUB = '0b6f0c2e-6a59-4a7e-9d2a-1f0c5e7d9a10';
const ED1 = '11111111-1111-4111-8111-111111111111';
const ED2 = '22222222-2222-4222-8222-222222222222';

test.before(() => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      publication_editions: [
        { id: ED1, publication_id: PUB, organization_id: ORG, version: 1 },
        { id: ED2, publication_id: PUB, organization_id: ORG, version: 2 },
      ],
      publication_legacy_links: [
        { legacy_id: 'abcd1234', organization_id: ORG, edition_id: ED1 },
      ],
    }),
  );
});
test.after(() => __setTestDb(null));

async function get(pathAndQuery) {
  const url = new URL(pathAndQuery, 'http://localhost');
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end() {},
  };
  const handled = await handlePublished({
    repoRoot: process.cwd(),
    req: { method: 'GET', url: pathAndQuery, headers: {} },
    res,
    url,
  });
  return { handled, res };
}

test('an old canvas link redirects to its first edition, slug ignored', async () => {
  const { handled, res } = await get('/p/abcd1234-whatever-slug');
  assert.equal(handled, true);
  assert.equal(res.status, 301);
  assert.equal(res.headers.Location, `/p/${PUB}/1`);
});

test('the reader and the embed go to the same edition, with ?lang= kept', async () => {
  const reader = await get('/p/abcd1234-x/reader?lang=en');
  assert.equal(reader.res.status, 301);
  assert.equal(reader.res.headers.Location, `/p/${PUB}/1/reader?lang=en`);
  const embed = await get('/embed/abcd1234?lang=nl&controls=1');
  assert.equal(embed.res.status, 301);
  assert.equal(embed.res.headers.Location, `/embed/${PUB}/1?lang=nl`);
});

test('an old id that was never converted is a 404, not the deck', async () => {
  const { handled, res } = await get('/p/deadbeef-some-deck');
  assert.equal(handled, true);
  assert.equal(res.status, 404);
});

test('an edition address is not an old link', async () => {
  const { handled } = await get(`/p/${PUB}/2`);
  assert.equal(handled, false);
});
