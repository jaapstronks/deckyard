/**
 * The public viewer routes and the email-delivery route (test-coverage gap map,
 * B40 — surface 10, "publieke viewer-routes + e-mail-uitlevering").
 *
 * `server/routes/static/published.js` answers the old publication addresses
 * (`/p/:id-:slug`, `/p/:id-:slug/reader`, `/embed/:id-:slug`) for anonymous web
 * visitors — no session, the old publish id is the whole authorization. Since
 * T1.5 it renders nothing: a converted id is a 301 to its first edition, any
 * other id a 404, and the deck is never read. The email side is
 * `server/routes/api/email-templates.js`, whose one handler that actually hands a
 * message to an external provider (`…/:type/test`) is pinned at its admin gate,
 * its validation, and its "email not configured" refusal.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **An old URL resolves only through its legacy link.** An old id without a
 *      link is a 404 on every subresource, even when an old index row and its
 *      deck still exist; a linked id is a 301 to the edition, whatever slug
 *      it carries. (The redirect targets are pinned in
 *      `tests/published-legacy-redirect.test.js`.)
 *   2. **Sending email is admin-only and honest about not being configured.** The
 *      email-template routes refuse a non-authenticated (401) and a
 *      non-admin (403) caller before dispatch; the test-send validates the
 *      template type and locale; and with no `BREVO_API_KEY` it answers 501
 *      `email_not_configured` rather than pretending a message went out.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the
 * test-send success (200) and upstream-failure (502) branches need a configured
 * Brevo peer; the `sendEmail` result typing behind them already has its own file
 * (`tests/email-send-failure-typing.test.js`), so only the network-free 501 is
 * pinned at the handler. The guest-verification email on the `/api/share/*` path
 * is fire-and-forget (no HTTP status reflection) and the `/api/share/*` JSON
 * contract is already covered by `tests/share-links-public-path.test.js` (#622);
 * neither is repeated here.
 *
 * House shape: the exported handler is called directly with a req/res double over
 * `tests/helpers/fake-db.js`, dispatching on the URL and method. No HTTP server,
 * no browser.
 *
 * Run with: node --test tests/viewer-email-routes-contract.test.js
 */

import { createMockStreamRes } from './helpers/http-mocks.js';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// The test-send 501 is answered only when outgoing email is unconfigured; make
// that state explicit rather than depend on the shell.
delete process.env.BREVO_API_KEY;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');
const { handleEmailTemplates } =
  await import('../server/routes/api/email-templates.js');

const PUBLISH_ID = 'abcd1234'; // 8 hex chars, matches the route regexes
const SLUG = 'my-deck';
const UNCONVERTED_ID = 'beef1234'; // old index row and deck exist, no link
const UNKNOWN_ID = 'deadbeef'; // well-formed, never published
const PUB = '0b6f0c2e-6a59-4a7e-9d2a-1f0c5e7d9a10';
const ED1 = '11111111-1111-4111-8111-111111111111';

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
  __setTestDb(null);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** A stored deck, in the shape the presentations adapter reads. */
function deckRow(overrides) {
  return {
    organization_id: ORG,
    title: `Title of ${overrides.id}`,
    owner_email: 'owner@example.com',
    created_by: 'owner@example.com',
    updated_by: 'owner@example.com',
    visibility: 'organization',
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

/** A `published_presentations` row, in the shape `upsertPublished` writes. */
function publishedRow(overrides) {
  return {
    id: overrides.id,
    organization_id: ORG,
    presentation_id: 'deck-pub',
    title: 'Published deck',
    slug: SLUG,
    og_image_url: null,
    created_at: '2026-02-01T00:00:00.000Z',
    modified_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [deckRow({ id: 'deck-pub' })],
    published_presentations: [
      publishedRow({ id: PUBLISH_ID }),
      // Never converted: the old route must not fall back to the deck.
      publishedRow({ id: UNCONVERTED_ID }),
    ],
    publication_editions: [
      { id: ED1, publication_id: PUB, organization_id: ORG, version: 1 },
    ],
    publication_legacy_links: [
      { legacy_id: PUBLISH_ID, organization_id: ORG, edition_id: ED1 },
    ],
    app_settings: [{ id: 'singleton', settings: {} }],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** Drive the old-address handler with a static-route context. */
async function callViewer(handle, method, pathAndQuery) {
  const req = { method, headers: { host: 'decks.example.test' } };
  const res = createMockStreamRes();
  const handled = await handle({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
  });
  return { handled, res };
}

/**
 * Drive the email-templates mount handler with an authenticated context.
 * @param {Object|null} user - Acting user; omit for anonymous.
 */
async function callEmail(method, pathAndQuery, { as = null, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = createMockStreamRes();
  const handled = await handleEmailTemplates({
    repoRoot: process.cwd(),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
    authedUser: as || undefined,
  });
  return { handled, res };
}

// ===========================================================================
// published.js — an old id resolves through its legacy link, or not at all
// ===========================================================================

for (const [label, path] of [
  ['canvas', `/p/${UNCONVERTED_ID}-${SLUG}`],
  ['reader', `/p/${UNCONVERTED_ID}-${SLUG}/reader`],
  ['embed', `/embed/${UNCONVERTED_ID}`],
  ['unknown id', `/p/${UNKNOWN_ID}-${SLUG}`],
]) {
  test(`an old ${label} address without a legacy link is a 404`, async () => {
    seed();
    const { handled, res } = await callViewer(handlePublished, 'GET', path);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 404);
  });
}

test('a converted id is a 301 to its edition, whatever the slug', async () => {
  seed();
  for (const slug of ['', `-${SLUG}`, '-not-the-slug']) {
    const { res } = await callViewer(
      handlePublished,
      'GET',
      `/p/${PUBLISH_ID}${slug}`,
    );
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.Location, `/p/${PUB}/1`);
  }
});

test('a non-GET method on an old path falls through unmatched', async () => {
  seed();
  const { handled } = await callViewer(
    handlePublished,
    'POST',
    `/p/${PUBLISH_ID}-${SLUG}`,
  );
  assert.equal(handled, false);
});

// ===========================================================================
// email-templates.js — sending email is admin-only and configuration-honest
// ===========================================================================

const ADMIN = { email: 'admin@example.com', name: 'Ada', isAdmin: true };
const PLAIN = { email: 'user@example.com', name: 'Uma', isAdmin: false };

test('the email-template routes refuse an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await callEmail('GET', '/api/admin/email-templates/metadata');

  assert.equal(res.statusCode, 401);
  assert.match(res.json().message, /Authentication required/);
});

test('the email-template routes refuse a non-admin caller with a 403', async () => {
  seed();
  const { res } = await callEmail(
    'GET',
    '/api/admin/email-templates/metadata',
    { as: PLAIN },
  );

  assert.equal(res.statusCode, 403);
  assert.match(res.json().message, /Admin access required/);
});

test('an admin may read the template metadata', async () => {
  seed();
  const { res } = await callEmail(
    'GET',
    '/api/admin/email-templates/metadata',
    { as: ADMIN },
  );

  assert.equal(res.statusCode, 200, 'the admin gate opens for an admin');
});

test('the test-send rejects an unknown template type with a 400', async () => {
  seed();
  const { res } = await callEmail(
    'POST',
    '/api/admin/email-templates/no-such-type/test',
    {
      as: ADMIN,
      body: { locale: 'en' },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /Invalid template type/);
});

test('the test-send rejects an unsupported locale with a 400', async () => {
  seed();
  const { res } = await callEmail(
    'POST',
    '/api/admin/email-templates/userInvitation/test',
    {
      as: ADMIN,
      body: { locale: 'zz' },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /Invalid locale/);
});

test('the test-send is a 501 when outgoing email is not configured', async () => {
  seed();
  const { res } = await callEmail(
    'POST',
    '/api/admin/email-templates/userInvitation/test',
    {
      as: ADMIN,
      body: { locale: 'en' },
    },
  );

  assert.equal(
    res.statusCode,
    501,
    'no BREVO_API_KEY means nothing was attempted',
  );
  assert.equal(res.json().error, 'email_not_configured');
});
