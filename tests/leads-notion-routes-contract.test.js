/**
 * The lead-capture and Notion-import route layers (test-coverage gap map, B40 —
 * surface 9, "leads + Notion-import").
 *
 * `server/routes/api/leads.js` is the public lead-capture endpoint, the
 * presentation-scoped lead reads/export, and the GDPR self-service paths.
 * `server/routes/api/notion.js` (+ the `notion/` handlers) is the Notion fetch/
 * publish/import surface. The storage beneath both is exercised elsewhere; the
 * route layer — who may read and export a deck's leads, what the public capture
 * endpoint will and will not accept, and how the Notion routes behave when Notion
 * is not configured — was not.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **A deck's leads inherit the deck's authorization, and export is a
 *      write.** Reading or counting a deck's leads needs read access; exporting
 *      the CSV and deleting a lead need *write* access, which a view-only
 *      collaborator does not have. Another organization's deck does not resolve
 *      at all. The public capture endpoint is anonymous but gated on consent and
 *      a well-formed email, and rate-limited per IP.
 *   2. **The Notion routes are honest about not being configured.** With no
 *      `NOTION_SECRET`, `status` reports `enabled:false` and every fetch/publish/
 *      import route answers 501 `notion_not_configured` — the network is never
 *      touched. With a secret present, the body/id validation ladder answers
 *      before the Notion API is called.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the Notion
 * network seam (`notionFetchJson` → `fetch('https://api.notion.com/v1…')`, the
 * single chokepoint for fetch/publish/import/subjects/compose/suggest) and the
 * `convertNotionPage` AI pipeline are not driven — they need a network peer and,
 * for import, a live LLM vendor. They are pinned only up to the last gate before
 * the call. The Notion handlers carry no per-handler authorization (the login
 * gate sits upstream in the router mount, `routes/api/index.js:159`), so there is
 * no handler-level authz-negative for them — same as the internal AI routes
 * (surface 5). The lead-notification and webhook side-effects on the public
 * capture path are fire-and-forget and not asserted (same class as the other
 * fire-and-forget opt-outs in the brief).
 *
 * House shape (see `tests/analytics-routes-contract.test.js`): the exported mount
 * handler is called directly with a req/res double over `tests/helpers/fake-db.js`,
 * dispatching on the URL and method as the router does. No HTTP server, no browser.
 *
 * Run with: node --test tests/leads-notion-routes-contract.test.js
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
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } = await import(
  '../server/storage/cache/permission-cache.js'
);
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');
const { LEAD_RATE_LIMITS } = await import('../server/config/rate-limits.js');
const { handleLeads, handleLeadsPublic } = await import('../server/routes/api/leads.js');
const { handleNotion } = await import('../server/routes/api/notion.js');

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/** @typedef {{email: string, name: string, organizationId: string}} Actor */

const ACTORS = {
  owner: { email: 'owner@example.com', name: 'Olive', organizationId: ORG },
  viewer: { email: 'viewer@example.com', name: 'Vera', organizationId: ORG },
  stranger: { email: 'stranger@example.com', name: 'Sam', organizationId: ORG },
  outsider: { email: 'outsider@other.example', name: 'Otto', organizationId: OTHER_ORG },
};

const DECKS = ['deck-owned', 'deck-foreign'];

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
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
    id: `user-${actor.email.split('@')[0]}`,
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

/** A `lead_submissions` row, in the shape `createLead` writes. */
function leadRow(overrides) {
  return {
    id: overrides.id,
    organization_id: ORG,
    presentation_id: 'deck-owned',
    slide_id: 'slide-1',
    name: 'Lead Person',
    email: 'lead@example.com',
    consent_given: true,
    consent_text: 'I agree',
    privacy_url: null,
    ip_address: '203.0.113.50',
    user_agent: 'UA/1.0',
    submitted_at: '2026-02-02T00:00:00.000Z',
    retention_expires_at: '2027-02-02T00:00:00.000Z',
    anonymized_at: null,
    created_at: '2026-02-02T00:00:00.000Z',
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
    lead_submissions: [
      leadRow({ id: 'lead-1' }),
      leadRow({ id: 'lead-2', email: 'second@example.com', slide_id: 'slide-2' }),
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
async function call(handle, method, pathAndQuery, { as = null, body, ip = '203.0.113.9' } = {}) {
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

const leadsTable = () => db.__tables.lead_submissions;
const leadById = (id) => leadsTable().find((l) => l.id === id);

/** A valid public-capture body for `deck-owned`. */
function captureBody(overrides = {}) {
  return {
    presentationId: 'deck-owned',
    slideId: 'slide-1',
    name: 'New Lead',
    email: 'new.lead@example.com',
    consentGiven: true,
    consentText: 'I agree to be contacted',
    ...overrides,
  };
}

// ===========================================================================
// leads.js — public capture: anonymous, but gated on consent and a valid email
// ===========================================================================

test('a valid lead submission is stored and returns ok', async () => {
  await seed();
  const before = leadsTable().length;
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', { body: captureBody() });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(leadsTable().length, before + 1, 'the lead landed in storage');
  assert.ok(
    leadsTable().some((l) => l.email === 'new.lead@example.com' && l.presentation_id === 'deck-owned'),
    'with the submitted email and deck'
  );
});

test('capture rejects a body missing the presentation or slide with a 400', async () => {
  await seed();
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody({ slideId: '' }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Missing presentationId or slideId/);
});

test('capture rejects a body missing name or email with a 400', async () => {
  await seed();
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody({ email: '' }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Name and email are required/);
});

test('capture rejects a submission without consent with a 400', async () => {
  await seed();
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody({ consentGiven: false }),
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Consent is required/);
});

test('capture on an unknown presentation is a 404', async () => {
  await seed();
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody({ presentationId: 'no-such-deck' }),
  });

  assert.equal(res.statusCode, 404);
});

test('capture rejects a malformed email with a 400', async () => {
  await seed();
  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody({ email: 'not-an-email' }),
  });

  assert.equal(res.statusCode, 400, 'createLead rejects an address with no @');
  assert.match(res.body.message, /Invalid email address/);
});

test('capture is rate-limited per IP once the burst is spent', async () => {
  await seed();
  const cap = LEAD_RATE_LIMITS.perIp.capacity;
  // Each malformed body still spends a token: the limiter is checked first.
  for (let i = 0; i < cap; i++) {
    const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
      body: { presentationId: '', slideId: '' }, // passes the limiter, then 400s
      ip: '198.51.100.20',
    });
    assert.equal(res.statusCode, 400, `call ${i + 1} within the burst passes the limiter`);
  }

  const { res } = await call(handleLeadsPublic, 'POST', '/api/leads', {
    body: captureBody(),
    ip: '198.51.100.20',
  });
  assert.equal(res.statusCode, 429, 'the call past the burst is refused before the body');
  assert.equal(res.body.error, 'rate_limited');
});

// ===========================================================================
// leads.js — authenticated reads inherit the deck's authorization
// ===========================================================================

test('the authed lead routes fall through (not 401) for an anonymous caller', async () => {
  await seed();
  const { handled, res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads');

  assert.equal(handled, false, 'the module defers the auth decision to the outer gate');
  assert.equal(res.statusCode, null, 'and writes nothing itself');
});

test('listing a deck’s leads returns them for a reader', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads', {
    as: ACTORS.owner,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.leads.length, 2);
});

test('listing a deck’s leads is a 401 for a same-org non-collaborator', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads', {
    as: ACTORS.stranger,
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('a view-only collaborator may read the leads', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads', {
    as: ACTORS.viewer,
  });

  assert.equal(res.statusCode, 200, 'view access is enough to read');
});

test('the lead count is readable, and refused for a non-collaborator', async () => {
  await seed();
  const okRes = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads/count', {
    as: ACTORS.owner,
  });
  assert.equal(okRes.res.statusCode, 200);
  assert.equal(okRes.res.body.count, 2);

  const denied = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads/count', {
    as: ACTORS.stranger,
  });
  assert.equal(denied.res.statusCode, 401);
});

test('another organization’s deck does not resolve for its leads', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-foreign/leads', {
    as: ACTORS.owner,
  });

  assert.equal(res.statusCode, 404, 'a deck in another organization is not found in this scope');
});

// ===========================================================================
// leads.js — export and delete are writes, not reads
// ===========================================================================

test('exporting the CSV needs write access, which a view-only collaborator lacks', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads/export', {
    as: ACTORS.viewer,
  });

  assert.equal(res.statusCode, 401, 'export is a write-level operation');
});

test('exporting the CSV returns text/csv for a writer', async () => {
  await seed();
  const { res } = await call(handleLeads, 'GET', '/api/presentations/deck-owned/leads/export', {
    as: ACTORS.owner,
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /attachment; filename=/);
  assert.match(res.rawBody, /lead@example\.com/, 'the CSV carries the seeded lead');
});

test('deleting a lead needs write access', async () => {
  await seed();
  const { res } = await call(handleLeads, 'DELETE', '/api/leads/lead-1', { as: ACTORS.viewer });

  assert.equal(res.statusCode, 401);
  assert.equal(leadById('lead-1').anonymized_at, null, 'the lead survives a refused delete');
});

test('deleting a lead anonymizes it for a writer', async () => {
  await seed();
  const { res } = await call(handleLeads, 'DELETE', '/api/leads/lead-1', { as: ACTORS.owner });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(leadById('lead-1').anonymized_at, 'the lead is now anonymized');
  assert.equal(leadById('lead-1').email, '[deleted]', 'the email is scrubbed');
});

test('deleting an unknown lead is a 404', async () => {
  await seed();
  const { res } = await call(handleLeads, 'DELETE', '/api/leads/no-such-lead', { as: ACTORS.owner });

  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// leads.js — the GDPR self-service path is token-gated
// ===========================================================================

test('my-data request rejects a malformed email with a 400', async () => {
  await seed();
  const { res } = await call(handleLeads, 'POST', '/api/leads/my-data/request', {
    as: ACTORS.owner,
    body: { email: 'nope' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Valid email required/);
});

test('my-data read refuses a missing or wrong token', async () => {
  await seed();
  const noToken = await call(handleLeads, 'GET', '/api/leads/my-data?email=lead@example.com', {
    as: ACTORS.owner,
  });
  assert.equal(noToken.res.statusCode, 400, 'email and token are both required');

  const wrongToken = await call(
    handleLeads,
    'GET',
    '/api/leads/my-data?email=lead@example.com&token=deadbeef',
    { as: ACTORS.owner }
  );
  assert.equal(wrongToken.res.statusCode, 401, 'a token that was never issued is refused');
});

test('my-data request is an honest 501 when outgoing email is not configured', async () => {
  await seed();
  const previousEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // outside development, no dev-token fallback
  const previousKey = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY; // no mail provider on this install
  try {
    const { res } = await call(handleLeads, 'POST', '/api/leads/my-data/request', {
      as: ACTORS.owner,
      body: { email: 'lead@example.com' },
    });

    assert.equal(res.statusCode, 501, 'production without mail cannot deliver the token, so it must not pretend');
    assert.equal(res.body.error, 'email_not_configured');
    assert.ok(!res.body.devToken, 'the token is never echoed outside development');
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = previousKey;
  }
});

test('the GDPR self-service round-trip: request → read → erase', async () => {
  await seed();
  process.env.NODE_ENV = 'development'; // the dev branch echoes the verification token
  try {
    const request = await call(handleLeads, 'POST', '/api/leads/my-data/request', {
      as: ACTORS.owner,
      body: { email: 'lead@example.com' },
    });
    assert.equal(request.res.statusCode, 200);
    const token = request.res.body.devToken;
    assert.ok(token, 'a verification token is issued in development');

    const read = await call(
      handleLeads,
      'GET',
      `/api/leads/my-data?email=lead@example.com&token=${token}`,
      { as: ACTORS.owner }
    );
    assert.equal(read.res.statusCode, 200);
    assert.equal(read.res.body.leadCount, 1, 'the one lead for this email is returned');

    const erase = await call(
      handleLeads,
      'DELETE',
      `/api/leads/my-data?email=lead@example.com&token=${token}`,
      { as: ACTORS.owner }
    );
    assert.equal(erase.res.statusCode, 200);
    assert.equal(erase.res.body.anonymized, 1, 'the lead is anonymized by email');
    assert.equal(leadById('lead-1').email, '[deleted]');
  } finally {
    delete process.env.NODE_ENV;
  }
});

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
    const { handled, res } = await call(handleNotion, 'POST', '/api/notion/compose', {
      body: { keyword: 'strategy' },
    });

    assert.equal(handled, false, 'the gated table is not dispatched without NOTION_FEATURE');
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
    const missing = await call(handleNotion, 'POST', '/api/notion/fetch', { body: {} });
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
    const { res } = await call(handleNotion, 'POST', '/api/notion/compose', { body: {} });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Expected \{ pageId \} or \{ keyword \}/);
  } finally {
    delete process.env.NOTION_SECRET;
    delete process.env.NOTION_FEATURE;
  }
});
