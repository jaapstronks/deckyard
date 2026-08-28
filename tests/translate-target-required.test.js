/**
 * The translate endpoints refuse a request that names no target language
 * (B182, D72 phase 1).
 *
 * `POST /api/presentations/:id/translate/missing` and `.../translate/fields`
 * used to fill an absent `to` with `otherLang(from)` — "the other one of the
 * pair". Off the NL/EN pair that is `null`, so a request to translate a
 * German deck reached the translator with no target at all: `translate/fields`
 * asked an LLM to translate into nothing, and `translate/missing` was only
 * saved from persisting a job under the key `"null"` by a guard bolted on
 * afterwards. The axis is open (D61) and cannot guess a target, so naming one
 * is the caller's job.
 *
 * House shape: the exported handler is called directly with a req/res double
 * over `tests/helpers/fake-db.js`. Both branches asserted here return before
 * any LLM call, so no vendor is reached.
 *
 * Run with: node --test tests/translate-target-required.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-de';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handlePresentationTranslateMissing } =
  await import('../server/routes/api/presentations/translate-missing.js');
const { handlePresentationTranslateFields } =
  await import('../server/routes/api/presentations/translate-fields.js');

const AUTHOR = {
  id: 'user-author',
  email: 'author@example.com',
  name: 'Andy Author',
  organizationId: ORG,
};

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/**
 * A German deck owned by the author — a language the retired `otherLang()`
 * had no answer for, which is the whole point of the fixture.
 */
function seed() {
  db.__tables.users = [
    {
      id: AUTHOR.id,
      organization_id: ORG,
      email: AUTHOR.email,
      name: AUTHOR.name,
      role: 'user',
      auth_source: 'database',
      password_hash: null,
      settings: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  db.__tables.presentations = [
    {
      id: DECK,
      organization_id: ORG,
      title: 'Der Plan',
      owner_email: AUTHOR.email,
      created_by: AUTHOR.email,
      updated_by: AUTHOR.email,
      owner_user_id: AUTHOR.id,
      created_by_user_id: AUTHOR.id,
      updated_by_user_id: AUTHOR.id,
      visibility: 'private',
      theme: 'default',
      lang: 'de',
      revision: 1,
      is_view_only: false,
      slides: [
        { id: 's1', type: 'content-slide', content: { title: 'Der Plan' } },
      ],
      i18n: {
        dominant: 'de',
        active: 'de',
        versions: {
          de: {
            title: 'Der Plan',
            slides: [
              {
                id: 's1',
                type: 'content-slide',
                content: { title: 'Der Plan' },
              },
            ],
          },
        },
      },
      settings: {},
      created_at: '2026-02-01T00:00:00.000Z',
      modified_at: '2026-02-01T00:00:00.000Z',
      trashed_at: null,
    },
  ];
}

/** A response double capturing the status/body the http helpers write. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null;
      }
      return this;
    },
  };
}

async function call(handler, body) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const handled = await handler(
    {
      repoRoot: process.cwd(),
      storageScope: createStorageScope(AUTHOR, { repoRoot: process.cwd() }),
      req,
      res,
      authedUser: AUTHOR,
    },
    DECK,
  );
  return { handled, res };
}

test('translate/missing refuses a request without a target language', async () => {
  seed();
  const { res } = await call(handlePresentationTranslateMissing, {
    from: 'de',
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, 'bad_request');
  assert.match(String(res.body?.message || ''), /target language/i);
});

test('translate/missing refuses an off-axis target rather than guessing', async () => {
  seed();
  const { res } = await call(handlePresentationTranslateMissing, {
    from: 'de',
    to: 'zz',
  });

  assert.equal(res.statusCode, 400);
});

test('translate/fields refuses a request without a target language', async () => {
  seed();
  const { res } = await call(handlePresentationTranslateFields, {
    from: 'de',
    fields: { title: 'Der Plan' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, 'bad_request');
  assert.match(String(res.body?.message || ''), /target language/i);
});
