/**
 * Contract tests for the public API v1 translation module (B40 PR 5+):
 * POST /api/v1/presentations/:id/translate and GET /api/v1/translate/languages.
 *
 * The surface these pin, per docs/openapi.yaml: the supported-languages
 * listing, the request-validation ladder of the translate endpoint (permission
 * → daily AI limit → AI kill switch → body → deck access → language
 * validation) and its status codes: 403 without the `ai` permission, 429 with
 * rate-limit headers when the daily AI budget is spent, 503 with AI_ENABLED=false,
 * 400 for invalid/equal languages and for an existing target without
 * overwrite, 403/404 for inaccessible decks.
 *
 * The success path is NOT covered: it calls the configured LLM vendor
 * (`translatePresentationStrings`), and there is no vendor seam to observe
 * without one — noted as an explicit opt-out in the B40 brief's Opt-out-log,
 * like the collaborator invite e-mail in PR 2. Everything up to that call is
 * pinned here, so the endpoint's contract fails loudly if the ladder changes.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-partial-write.test.js). Negative assertions pin the
 * status code, not the error envelope (B39 deel 3 bevinding 11).
 *
 * Run with: node --test tests/public-api-v1-translate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.AI_ENABLED;
delete process.env.DISABLE_AI;
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-to-translate';
const FOREIGN_DECK_ID = 'deck-of-someone-else';
const KEY_ID = 'key-1';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handleTranslation } = await import('../server/routes/public-api/v1/translate.js');
const { TRANSLATION_LANGS } = await import('../server/storage/presentations/i18n.js');

/**
 * Install a freshly seeded double and point the storage facade at Postgres.
 * @param {Object} [options]
 * @param {number} [options.aiUsedToday] - Today's spent AI budget for the key
 * @returns {Promise<Object>} The database double.
 */
async function installDb({ aiUsedToday = 0 } = {}) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [
      deckRow({ id: DECK_ID, owner: KEY_OWNER }),
      deckRow({ id: FOREIGN_DECK_ID, owner: 'someone-else@example.com' }),
    ],
    api_usage_daily: aiUsedToday
      ? [{
          id: 'usage-1',
          api_key_id: KEY_ID,
          date: new Date().toISOString().split('T')[0],
          request_count: aiUsedToday,
          ai_request_count: aiUsedToday,
          export_count: 0,
        }]
      : [],
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: `Title of ${id}`,
    description: null,
    theme: 'default',
    lang: 'nl',
    visibility: 'private',
    revision: 1,
    settings: {},
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: `Title of ${id}`, slides: [] },
        de: { title: `Titel von ${id}`, slides: [] },
      },
    },
    slides: [{ id: 'slide-1', type: 'title-slide', content: { title: 'Hoi' }, parentId: null }],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

/**
 * Request context for the translation handler, with the key already
 * authenticated (authenticateApiKey is a different seam with its own tests).
 * @param {string} method - HTTP method
 * @param {string} pathname - Request path
 * @param {Object} [options]
 * @param {Object|null} [options.body] - JSON body
 * @param {string[]} [options.permissions] - API key permissions
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, { body = null, permissions = ['read', 'ai'] } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { 'content-type': 'application/json' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: { repoRoot: process.cwd(), organizationId: ORG, actorEmail: KEY_OWNER },
    apiKey: { id: KEY_ID, tier: 'free', ownerEmail: KEY_OWNER, permissions, organizationId: ORG },
    authedUser: { id: null, email: KEY_OWNER, role: 'user', organizationId: ORG },
  };
}

function translateCtx(deckId, body, options = {}) {
  return makeCtx('POST', `/api/v1/presentations/${deckId}/translate`, { body, ...options });
}

// ---------------------------------------------------------------------------
// GET /api/v1/translate/languages
// ---------------------------------------------------------------------------

test('GET /translate/languages lists every supported language with a label', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/translate/languages');
  assert.equal(await handleTranslation(ctx), true);

  assert.equal(ctx.res.statusCode, 200);
  const { languages } = ctx.res.body;
  assert.deepEqual(languages.map((l) => l.code), [...TRANSLATION_LANGS]);
  for (const lang of languages) {
    assert.ok(lang.label, `${lang.code} carries a human label`);
  }
  assert.ok(languages.some((l) => l.code === 'nl' && l.label === 'Dutch'));
});

test('GET /translate/languages without the read permission is refused with 403', async () => {
  await installDb();
  const ctx = makeCtx('GET', '/api/v1/translate/languages', { permissions: ['ai'] });
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /translate/languages answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('POST', '/api/v1/translate/languages');
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'GET');
});

// ---------------------------------------------------------------------------
// POST /api/v1/presentations/:id/translate — the validation ladder
// ---------------------------------------------------------------------------

test('POST /translate without the ai permission is refused with 403', async () => {
  await installDb();
  // `read`+`write` is not enough: translation is an AI feature.
  const ctx = translateCtx(DECK_ID, { targetLang: 'fr' }, { permissions: ['read', 'write'] });
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /translate answers 429 with limit details when the daily AI budget is spent', async () => {
  await installDb({ aiUsedToday: 10 }); // free tier: 10 AI calls/day
  const ctx = translateCtx(DECK_ID, { targetLang: 'fr' });
  await handleTranslation(ctx);

  assert.equal(ctx.res.statusCode, 429);
  // B61: the one v1 envelope — machine code in `error`, limit facts in `details`.
  assert.equal(ctx.res.body.error, 'rate_limited');
  assert.equal(ctx.res.body.details.limit, 10);
  assert.equal(ctx.res.body.details.used, 10);
  assert.ok(ctx.res.body.details.resetAt, 'the details name the reset moment');
  assert.equal(ctx.res.headers['X-RateLimit-Limit'], '10');
  assert.equal(ctx.res.headers['X-RateLimit-Remaining'], '0');
  assert.ok(ctx.res.headers['X-RateLimit-Reset']);
});

test('POST /translate answers 503 when AI is disabled on the install', async () => {
  await installDb();
  process.env.AI_ENABLED = 'false';
  try {
    const ctx = translateCtx(DECK_ID, { targetLang: 'fr' });
    await handleTranslation(ctx);
    assert.equal(ctx.res.statusCode, 503);
  } finally {
    delete process.env.AI_ENABLED;
  }
});

test('POST /translate still honors the legacy DISABLE_AI spelling (until 2026-11-01)', async () => {
  await installDb();
  process.env.DISABLE_AI = 'true';
  try {
    const ctx = translateCtx(DECK_ID, { targetLang: 'fr' });
    await handleTranslation(ctx);
    assert.equal(ctx.res.statusCode, 503);
  } finally {
    delete process.env.DISABLE_AI;
  }
});

test('POST /translate with an unsupported targetLang answers 400', async () => {
  await installDb();
  for (const targetLang of [undefined, 'zz', 'en-US']) {
    const ctx = translateCtx(DECK_ID, targetLang === undefined ? {} : { targetLang });
    await handleTranslation(ctx);
    assert.equal(ctx.res.statusCode, 400, `targetLang ${targetLang} must be refused`);
  }
});

test('POST /translate with equal source and target answers 400', async () => {
  await installDb();
  const explicit = translateCtx(DECK_ID, { targetLang: 'de', sourceLang: 'de' });
  await handleTranslation(explicit);
  assert.equal(explicit.res.statusCode, 400);

  // Without a sourceLang the deck's active language (nl) is the source.
  const implicit = translateCtx(DECK_ID, { targetLang: 'nl' });
  await handleTranslation(implicit);
  assert.equal(implicit.res.statusCode, 400);
});

test('POST /translate refuses an existing target without overwrite or fillMissing', async () => {
  await installDb();
  const ctx = translateCtx(DECK_ID, { targetLang: 'de', fillMissing: false });
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 400);
});

test("POST /translate on someone else's private deck is refused with 403", async () => {
  await installDb();
  const ctx = translateCtx(FOREIGN_DECK_ID, { targetLang: 'fr' });
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

test('POST /translate on an unknown deck answers 404', async () => {
  await installDb();
  const ctx = translateCtx('never-a-deck', { targetLang: 'fr' });
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 404);
});

test('GET on the translate endpoint answers 405 with the allowed methods', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}/translate`);
  await handleTranslation(ctx);
  assert.equal(ctx.res.statusCode, 405);
  assert.equal(ctx.res.headers.Allow ?? ctx.res.headers.allow, 'POST');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a pathname outside the translation surface is not handled', async () => {
  await installDb();
  const ctx = makeCtx('GET', `/api/v1/presentations/${DECK_ID}`);
  assert.equal(await handleTranslation(ctx), false);
  assert.equal(ctx.res.statusCode, null, 'no response was written');
});
