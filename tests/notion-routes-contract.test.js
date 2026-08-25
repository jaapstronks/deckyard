/**
 * The Notion-import route layer (test-coverage gap map, B40 — surface 9).
 *
 * `server/routes/api/notion/index.js` (+ the `notion/` handlers) is the Notion fetch/
 * publish/import surface. The storage beneath it is exercised elsewhere; the
 * route layer — how the routes behave when Notion is not configured, and what
 * they validate before touching the network — was not.
 *
 * The rule this surface carries, stated here as assertions:
 *
 * > **The Notion routes are honest about not being configured.** With no
 * > `NOTION_SECRET`, `status` reports `enabled:false` and every fetch/publish/
 * > import route answers 501 `notion_not_configured` — the network is never
 * > touched. With a secret present, the body/id validation ladder answers
 * > before the Notion API is called.
 *
 * This file used to cover leads as well (`leads-notion-routes-contract`); that
 * half went with the lead-capture strip (B119 / D50), together with the routes
 * it pinned.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the Notion
 * network seam (`notionFetchJson` → `fetch('https://api.notion.com/v1…')`, the
 * single chokepoint for fetch/publish/import/subjects/compose/suggest) and the
 * `convertNotionPage` AI pipeline are not driven — they need a network peer and,
 * for import, a live LLM vendor. They are pinned only up to the last gate before
 * the call. The Notion handlers carry no per-handler authorization (the login
 * gate sits upstream in the router mount, `routes/api/index.js`), so there is
 * no handler-level authz-negative for them — same as the internal AI routes
 * (surface 5).
 *
 * House shape (see `tests/analytics-routes-contract.test.js`): the exported mount
 * handler is called directly with a req/res double over `tests/helpers/fake-db.js`,
 * dispatching on the URL and method as the router does. No HTTP server, no browser.
 *
 * Run with: node --test tests/notion-routes-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.NOTION_SECRET;
delete process.env.NOTION_FEATURE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { handleNotion } = await import('../server/routes/api/notion/index.js');

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/** @typedef {{id: string, email: string, name: string, organizationId: string}} Actor */

/**
 * The `users.id` behind an address: ownership is keyed on that id and nothing
 * else (shared/identity-match.js), so the seeded rows and the sessions acting
 * on them must agree on it.
 * @param {string} email
 * @param {string} name
 * @param {string} organizationId
 * @returns {Actor}
 */
function person(email, name, organizationId) {
  return {
    id: `user-${email.split('@')[0]}`,
    email,
    name,
    organizationId,
  };
}

const ACTORS = {
  owner: person('owner@example.com', 'Olive', ORG),
  viewer: person('viewer@example.com', 'Vera', ORG),
  stranger: person('stranger@example.com', 'Sam', ORG),
  outsider: person('outsider@other.example', 'Otto', OTHER_ORG),
};

const DECKS = ['deck-owned', 'deck-foreign'];

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test.beforeEach(() => {
  resetRateLimitBuckets();
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** @param {Actor} actor */
function userRow(actor) {
  return {
    id: actor.id,
    organization_id: actor.organizationId,
    email: actor.email,
    name: actor.name,
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** A stored deck, in the shape the presentations adapter reads. */
function deckRow(overrides) {
  return {
    organization_id: ORG,
    title: `Title of ${overrides.id}`,
    owner_email: ACTORS.owner.email,
    created_by: ACTORS.owner.email,
    updated_by: ACTORS.owner.email,
    owner_user_id: ACTORS.owner.id,
    created_by_user_id: ACTORS.owner.id,
    updated_by_user_id: ACTORS.owner.id,
    visibility: 'private',
    theme: 'default',
    lang: 'nl',
    revision: 1,
    is_view_only: false,
    slides: [],
    i18n: null,
    settings: {},
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    trashed_at: null,
    ...overrides,
  };
}

/**
 * Reinstall a freshly seeded double and drop the collaborator permission cache
 * for every (deck, person) pair, so a grant one test relies on cannot answer a
 * lookup in the next (five-minute TTL).
 * @returns {Promise<ReturnType<typeof createFakeDb>>}
 */
async function seed() {
  db = createFakeDb({
    organizations: [
      { id: ORG, name: 'Default', slug: 'default' },
      { id: OTHER_ORG, name: 'Other', slug: 'other' },
    ],
    users: Object.values(ACTORS).map(userRow),
    presentations: [
      deckRow({ id: 'deck-owned' }),
      deckRow({
        id: 'deck-foreign',
        organization_id: OTHER_ORG,
        owner_email: ACTORS.outsider.email,
        owner_user_id: ACTORS.outsider.id,
        created_by_user_id: ACTORS.outsider.id,
        updated_by_user_id: ACTORS.outsider.id,
        created_by: ACTORS.outsider.email,
        updated_by: ACTORS.outsider.email,
      }),
    ],
    presentation_collaborators: [
      {
        id: 'c-viewer',
        organization_id: ORG,
        presentation_id: 'deck-owned',
        user_id: null,
        user_email: ACTORS.viewer.email,
        permission: 'view',
        invited_by: ACTORS.owner.email,
        invited_at: '2026-02-01T00:00:00.000Z',
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        revocation_message: null,
      },
    ],
    app_settings: [{ id: 'singleton', settings: {} }],
  });
  __setTestDb(db);

  for (const deck of DECKS) {
    for (const actor of Object.values(ACTORS)) {
      await invalidatePermission(deck, actor.email);
    }
  }
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** A response double capturing the status/headers/body the helpers write. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
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
      // Node defaults an unwritten status to 200 when end() is called without a
      // prior writeHead — the CSV export path relies on exactly that.
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null; // non-JSON (the CSV export)
      }
      return this;
    },
  };
}

/**
 * Drive a mount handler (`handleLeads`/`handleLeadsPublic`/`handleNotion`) the
 * way the router does: it dispatches on `ctx.url.pathname` and `ctx.req.method`.
 *
 * @param {Function} handle
 * @param {string} method
 * @param {string} pathAndQuery
 * @param {Object} [options]
 * @param {Actor|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @param {string} [options.ip] - Client IP (for the per-IP rate limit).
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(
  handle,
  method,
  pathAndQuery,
  { as = null, body, ip = '203.0.113.9' } = {},
) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handle({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
    authedUser,
  });
  return { handled, res };
}

// ===========================================================================
// notion.js — honest about not being configured, then validates before the API
// ===========================================================================

test('notion status reports disabled when no secret is set', async () => {
  await seed();
  const { res } = await call(handleNotion, 'GET', '/api/notion/status');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.fullFeatures, false);
});

test('notion fetch is a 501 when Notion is not configured', async () => {
  await seed();
  const { res } = await call(handleNotion, 'POST', '/api/notion/fetch', {
    body: { url: 'https://www.notion.so/Some-Page-1234' },
  });

  assert.equal(res.statusCode, 501);
  assert.equal(res.body.error, 'notion_not_configured');
});

test('notion import is a 501 when Notion is not configured', async () => {
  await seed();
  const { res } = await call(handleNotion, 'POST', '/api/notion/import', {
    body: { url: 'https://www.notion.so/Some-Page-1234' },
  });

  assert.equal(res.statusCode, 501);
  assert.equal(res.body.error, 'notion_not_configured');
});

test('a gated notion route (compose) is unreachable while the feature flag is off', async () => {
  await seed();
  process.env.NOTION_SECRET = 'secret_test_value';
  try {
    const { handled, res } = await call(
      handleNotion,
      'POST',
      '/api/notion/compose',
      {
        body: { keyword: 'strategy' },
      },
    );

    assert.equal(
      handled,
      false,
      'the gated table is not dispatched without NOTION_FEATURE',
    );
    assert.equal(res.statusCode, null);
  } finally {
    delete process.env.NOTION_SECRET;
  }
});

// With a secret present the 501 gate opens and the body/id validation ladder
// becomes reachable — proving the 501s above are non-vacuous (flip the secret and
// a different refusal answers) and that validation runs before the Notion API.
test('with a secret, notion fetch validates the url before calling Notion', async () => {
  await seed();
  process.env.NOTION_SECRET = 'secret_test_value';
  try {
    const missing = await call(handleNotion, 'POST', '/api/notion/fetch', {
      body: {},
    });
    assert.equal(missing.res.statusCode, 400);
    assert.match(missing.res.body.message, /Expected \{ url \}/);

    const malformed = await call(handleNotion, 'POST', '/api/notion/fetch', {
      body: { url: 'not a notion url' },
    });
    assert.equal(malformed.res.statusCode, 400);
    assert.match(malformed.res.body.message, /Invalid Notion URL or page ID/);
  } finally {
    delete process.env.NOTION_SECRET;
  }
});

test('with a secret, notion publish validates its required fields before calling Notion', async () => {
  await seed();
  process.env.NOTION_SECRET = 'secret_test_value';
  try {
    const noPage = await call(handleNotion, 'POST', '/api/notion/publish', {
      body: { embedUrl: 'https://decks.example.test/embed/abc' },
    });
    assert.equal(noPage.res.statusCode, 400);
    assert.match(noPage.res.body.message, /Expected \{ pageId \}/);

    const noEmbed = await call(handleNotion, 'POST', '/api/notion/publish', {
      body: { pageId: '11112222333344445555666677778888' },
    });
    assert.equal(noEmbed.res.statusCode, 400);
    assert.match(noEmbed.res.body.message, /Expected \{ embedUrl \}/);
  } finally {
    delete process.env.NOTION_SECRET;
  }
});

test('with a secret, notion import validates the url before the conversion pipeline', async () => {
  await seed();
  process.env.NOTION_SECRET = 'secret_test_value';
  try {
    const { res } = await call(handleNotion, 'POST', '/api/notion/import', {
      body: { url: 'not a notion url' },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid Notion URL or page ID/);
  } finally {
    delete process.env.NOTION_SECRET;
  }
});

test('with the feature flag and a secret on, a gated route validates before the API', async () => {
  await seed();
  process.env.NOTION_SECRET = 'secret_test_value';
  process.env.NOTION_FEATURE = 'true';
  try {
    // compose with neither a pageId nor a usable keyword is a 400, reached only
    // because the gated table is now dispatched.
    const { res } = await call(handleNotion, 'POST', '/api/notion/compose', {
      body: {},
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Expected \{ pageId \} or \{ keyword \}/);
  } finally {
    delete process.env.NOTION_SECRET;
    delete process.env.NOTION_FEATURE;
  }
});
