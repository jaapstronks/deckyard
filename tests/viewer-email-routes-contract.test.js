/**
 * The public viewer routes and the email-delivery route (test-coverage gap map,
 * B40 — surface 10, "publieke viewer-routes + e-mail-uitlevering").
 *
 * `server/routes/static/{published,embed}.js` serve a published deck to anonymous
 * web visitors (`/p/:id-:slug`, `/p/:id-:slug/reader`, `/embed/:id-:slug`) — no
 * session, the publish id is the whole authorization. Because the surface is
 * anonymous, its *refusal* paths are the contract: an unknown publish id, a
 * publish entry whose deck is gone, and a wrong/absent slug. The email side is
 * `server/routes/api/email-templates.js`, whose one handler that actually hands a
 * message to an external provider (`…/:type/test`) is pinned at its admin gate,
 * its validation, and its "email not configured" refusal.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **A published/embed URL resolves the publish id, then the deck, then the
 *      slug — refusing at each step.** A publish id that names nothing is a 404;
 *      a publish entry pointing at a deck that no longer exists is a 404; a
 *      canvas/reader URL with a wrong or missing slug is a 302 to the canonical
 *      path. Embed deliberately differs on one point — it only redirects when a
 *      slug is *supplied* and wrong — and that difference is pinned.
 *   2. **Sending email is admin-only and honest about not being configured.** The
 *      email-template routes refuse a non-authenticated (401) and a
 *      non-admin (401) caller before dispatch; the test-send validates the
 *      template type and locale; and with no `BREVO_API_KEY` it answers 501
 *      `email_not_configured` rather than pretending a message went out.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the 200
 * happy paths of the viewer routes render full deck HTML (themes, merged slide
 * types, standalone/embed/reader builders) — driven only up to the last refusal
 * before the render here; the render itself is an export/browser concern. The
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

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// The test-send 501 is answered only when outgoing email is unconfigured; make
// that state explicit rather than depend on the shell.
delete process.env.BREVO_API_KEY;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { handlePublishedPage, handlePublishedReader } = await import(
  '../server/routes/static/published.js'
);
const { handleEmbed } = await import('../server/routes/static/embed.js');
const { handleEmailTemplates } = await import('../server/routes/api/email-templates.js');

const PUBLISH_ID = 'abcd1234'; // 8 hex chars, matches the route regexes
const SLUG = 'my-deck';
const GHOST_PUBLISH_ID = 'beef1234'; // entry exists, its deck is gone
const UNKNOWN_ID = 'deadbeef'; // well-formed, never published

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
      // A live publish entry whose deck exists.
      publishedRow({ id: PUBLISH_ID }),
      // A publish entry whose deck no longer exists.
      publishedRow({ id: GHOST_PUBLISH_ID, presentation_id: 'ghost-deck' }),
    ],
    app_settings: [{ id: 'singleton', settings: {} }],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

/** A response double capturing status/headers/body the helpers write. */
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
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      try {
        this.body = payload ? JSON.parse(payload) : null;
      } catch {
        this.body = null; // HTML / non-JSON
      }
      return this;
    },
  };
}

/**
 * Drive a viewer handler (`handlePublishedPage`/`handlePublishedReader`/
 * `handleEmbed`) with a static-route context.
 */
async function callViewer(handle, method, pathAndQuery) {
  const req = { method, headers: { host: 'decks.example.test' } };
  const res = makeRes();
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
  const res = makeRes();
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
// published.js — resolve publish id → deck → slug, refusing at each step
// ===========================================================================

test('a published page for an unknown publish id is a 404', async () => {
  seed();
  const { handled, res } = await callViewer(handlePublishedPage, 'GET', `/p/${UNKNOWN_ID}-${SLUG}`);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 404);
});

test('a published page whose deck no longer exists is a 404', async () => {
  seed();
  const { res } = await callViewer(handlePublishedPage, 'GET', `/p/${GHOST_PUBLISH_ID}-${SLUG}`);

  assert.equal(res.statusCode, 404, 'the publish entry resolves, but its deck is gone');
});

test('a published page with a missing slug redirects to the canonical path', async () => {
  seed();
  const { res } = await callViewer(handlePublishedPage, 'GET', `/p/${PUBLISH_ID}`);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, `/p/${PUBLISH_ID}-${SLUG}`);
});

test('a published page with the wrong slug redirects to the canonical path', async () => {
  seed();
  const { res } = await callViewer(handlePublishedPage, 'GET', `/p/${PUBLISH_ID}-not-the-slug`);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, `/p/${PUBLISH_ID}-${SLUG}`);
});

test('a non-GET method on a published path falls through unmatched', async () => {
  seed();
  const { handled, res } = await callViewer(handlePublishedPage, 'POST', `/p/${PUBLISH_ID}-${SLUG}`);

  assert.equal(handled, false, 'only GET is served');
  assert.equal(res.statusCode, null);
});

test('the reader view refuses an unknown publish id with a 404', async () => {
  seed();
  const { res } = await callViewer(handlePublishedReader, 'GET', `/p/${UNKNOWN_ID}-${SLUG}/reader`);

  assert.equal(res.statusCode, 404);
});

test('the reader view redirects a wrong slug to the canonical reader path', async () => {
  seed();
  const { res } = await callViewer(handlePublishedReader, 'GET', `/p/${PUBLISH_ID}-wrong/reader`);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, `/p/${PUBLISH_ID}-${SLUG}/reader`);
});

// ===========================================================================
// embed.js — same id→deck ladder, but slug redirect only when a slug is given
// ===========================================================================

test('an embed for an unknown publish id is a 404', async () => {
  seed();
  const { res } = await callViewer(handleEmbed, 'GET', `/embed/${UNKNOWN_ID}-${SLUG}`);

  assert.equal(res.statusCode, 404);
});

test('an embed whose deck no longer exists is a 404', async () => {
  seed();
  const { res } = await callViewer(handleEmbed, 'GET', `/embed/${GHOST_PUBLISH_ID}-${SLUG}`);

  assert.equal(res.statusCode, 404);
});

test('an embed with a wrong slug redirects to the canonical embed path', async () => {
  seed();
  const { res } = await callViewer(handleEmbed, 'GET', `/embed/${PUBLISH_ID}-not-the-slug`);

  assert.equal(res.statusCode, 302, 'a supplied-but-wrong slug is corrected');
  assert.equal(res.headers.Location, `/embed/${PUBLISH_ID}-${SLUG}`);
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
  assert.match(res.body.message, /Authentication required/);
});

test('the email-template routes refuse a non-admin caller with a 401', async () => {
  seed();
  const { res } = await callEmail('GET', '/api/admin/email-templates/metadata', { as: PLAIN });

  assert.equal(res.statusCode, 401);
  assert.match(res.body.message, /Admin access required/);
});

test('an admin may read the template metadata', async () => {
  seed();
  const { res } = await callEmail('GET', '/api/admin/email-templates/metadata', { as: ADMIN });

  assert.equal(res.statusCode, 200, 'the admin gate opens for an admin');
});

test('the test-send rejects an unknown template type with a 400', async () => {
  seed();
  const { res } = await callEmail('POST', '/api/admin/email-templates/no-such-type/test', {
    as: ADMIN,
    body: { locale: 'en' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Invalid template type/);
});

test('the test-send rejects an unsupported locale with a 400', async () => {
  seed();
  const { res } = await callEmail('POST', '/api/admin/email-templates/userInvitation/test', {
    as: ADMIN,
    body: { locale: 'zz' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Invalid locale/);
});

test('the test-send is a 501 when outgoing email is not configured', async () => {
  seed();
  const { res } = await callEmail('POST', '/api/admin/email-templates/userInvitation/test', {
    as: ADMIN,
    body: { locale: 'en' },
  });

  assert.equal(res.statusCode, 501, 'no BREVO_API_KEY means nothing was attempted');
  assert.equal(res.body.error, 'email_not_configured');
});
