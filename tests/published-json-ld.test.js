/**
 * The JSON-LD a published deck writes: a real `datePublished` (B448) and no
 * `author` (B459).
 *
 * The published page read `pres.createdAt` off `getPresentation()`, which
 * projects the column as `created`, so `datePublished` was missing from every
 * published deck. It also required a string, while Postgres hands back a
 * `Date`. It likewise read `pres.ownerName`, which `getPresentation()` never
 * projects; that reader is gone rather than fed, because the only identity on
 * the row is the owner's email and no part of it belongs on a public page
 * until identity decoupling yields a real display name.
 *
 * These tests drive the real `/p/:id-:slug` route over the in-memory database
 * double and read the JSON-LD block it writes.
 *
 * House shape: see tests/published-embed-first-party-only.test.js.
 *
 * Run with: node --test tests/published-json-ld.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');
const { toIsoOrNull } = await import('../server/utils/normalize.js');

const PUBLISH_ID = 'abcd1234';
const SLUG = 'my-deck';
const CREATED = '2026-02-01T09:30:00.000Z';

/** Seed one published deck whose `created_at` is `createdAt`. */
function seed(createdAt) {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      presentations: [
        {
          id: 'deck-pub',
          organization_id: ORG,
          title: 'Published deck',
          owner_email: 'owner@example.com',
          created_by: 'owner@example.com',
          updated_by: 'owner@example.com',
          visibility: 'organization',
          theme: 'default',
          lang: 'nl',
          revision: 1,
          is_view_only: false,
          slides: [{ id: 's1', type: 'content-slide', content: {} }],
          i18n: null,
          settings: {},
          created_at: createdAt,
          modified_at: '2026-03-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
      published_presentations: [
        {
          id: PUBLISH_ID,
          organization_id: ORG,
          presentation_id: 'deck-pub',
          title: 'Published deck',
          slug: SLUG,
          og_image_url: null,
          created_at: '2026-02-02T00:00:00.000Z',
          modified_at: '2026-02-02T00:00:00.000Z',
        },
      ],
      app_settings: [{ id: 'singleton', settings: {} }],
    }),
  );
}

/** Drive the published route and hand back the parsed JSON-LD object. */
async function jsonLdFromPublishedPage() {
  const res = {
    statusCode: null,
    headers: {},
    rawBody: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      return this;
    },
  };
  const path = `/p/${PUBLISH_ID}-${SLUG}`;
  const handled = await handlePublished({
    repoRoot: process.cwd(),
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL(`http://decks.example.test${path}`),
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const match = String(res.rawBody || '').match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, 'the published page carries a JSON-LD block');
  return JSON.parse(match[1]);
}

test.before(async () => {
  seed(CREATED);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('datePublished is the deck’s creation time when storage hands back a string', async () => {
  seed(CREATED);
  const ld = await jsonLdFromPublishedPage();
  assert.equal(ld['@type'], 'PresentationDigitalDocument');
  assert.equal(ld.datePublished, CREATED);
});

test('datePublished is one ISO string when storage hands back a Date (Postgres)', async () => {
  seed(new Date(CREATED));
  const ld = await jsonLdFromPublishedPage();
  assert.equal(ld.datePublished, CREATED);
});

test('the JSON-LD names no author, and no part of the owner email', async () => {
  seed(CREATED);
  const ld = await jsonLdFromPublishedPage();
  assert.equal('author' in ld, false);
  const serialized = JSON.stringify(ld);
  assert.equal(serialized.includes('owner@example.com'), false);
  assert.equal(/"owner"/.test(serialized), false);
});

test('toIsoOrNull: one ISO string from either shape, null for nothing usable', () => {
  assert.equal(toIsoOrNull(CREATED), CREATED);
  assert.equal(toIsoOrNull(new Date(CREATED)), CREATED);
  assert.equal(toIsoOrNull(null), null);
  assert.equal(toIsoOrNull(''), null);
  assert.equal(toIsoOrNull('not a date'), null);
});
