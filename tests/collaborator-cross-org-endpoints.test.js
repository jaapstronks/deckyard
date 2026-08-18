/**
 * One collaborator row, every presentation-scoped endpoint, one answer.
 *
 * A collaborator row grants access to a *deck*. Which organization the grantee
 * happens to be signed into is not part of that grant — but for a while the
 * code disagreed with itself about that. #623 moved nine authorization reads
 * onto the deck's organization while ~25 others still passed the session's, and
 * `addCollaborator` stamped the row with the *inviter's* session organization.
 * One concept, three scopes.
 *
 * `server/storage/collaborators.js` now scopes on the presentation alone —
 * `(presentation_id, user_email)` is unique and a presentation id names exactly
 * one deck in exactly one organization — so there is no session organization
 * left for an endpoint to disagree about. This file pins that from three
 * directions.
 *
 * ## What "cross-organization" actually means here
 *
 * The brief that opened this item expected a live defect: a cross-organization
 * collaborator able to open a deck but not its versions or thumbnail. That is
 * **not reachable**, and the difference matters for anyone reading this later.
 * Every endpoint below loads the deck through `getPresentation(storageScope,
 * id)` first, and that scope carries the *session's* organization, so a deck in
 * another organization is already absent — 404 — before a collaborator row is ever
 * consulted. `ALLOW_CROSS_ORG` on that read only relaxes the *token-addressed*
 * case (a scope carrying no organization at all), and no such path resolves a
 * collaborator permission.
 *
 * So the change this file guards is a surface change, not a fix to a live hole:
 * two spellings of one lookup collapsed into one, and a stamp that could
 * disagree with its deck made unable to. The one behaviour that does change is
 * pinned below on its own — a row stamped with a foreign organization is no
 * longer inert.
 *
 * Multi-organization mode is *on*, which is what gives the organization anything
 * to say at all; with it off `isSameOrganization()` answers yes unconditionally.
 * The decks are `visibility: 'private'` so the organization grant is out of the picture
 * and the collaborator row is the only thing that can grant — every assertion
 * is then about that row and nothing else.
 *
 * The structural test at the bottom is what keeps this from rotting: the
 * behavioural cases cover the endpoints that are cheap to drive, while the
 * source-level guard covers *all* of them — export, render-slide, the collab
 * websocket handshake — by refusing any call site that passes a scope again.
 *
 * MULTI_ORG_ENABLED and DEFAULT_ORGANIZATION_ID are read at module scope,
 * so the environment is set before any import and this file relies on
 * node --test giving it its own process.
 *
 * Run with: node --test tests/collaborator-cross-org-endpoints.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

/** The organization both people are signed into. */
const HOME_ORG = process.env.DEFAULT_ORGANIZATION_ID;
/** A second organization, for the deck and the stamp that must not matter. */
const AWAY_ORG = '00000000-0000-0000-0000-0000000000bb';
const DECK = 'deck-under-test';

import { callArguments, walkJsFiles } from './helpers/call-sites.js';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/lifecycle.js'
);
const { isMultiOrgEnabled } = await import('../server/config/features.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } = await import(
  '../server/storage/cache/permission-cache.js'
);
const { canActorAccessPresentation } = await import(
  '../server/utils/presentation-authz/actor-access.js'
);
const { withPresentationAuth } = await import('../server/utils/route-middleware.js');
const { addCollaborator, getCollaboratorPermission } = await import(
  '../server/storage/collaborators.js'
);
const { handlePresentationItem } = await import(
  '../server/routes/api/presentations/presentation.js'
);
const { handlePresentationVersions } = await import(
  '../server/routes/api/presentations/versions.js'
);
const { handlePresentationThumbnail } = await import(
  '../server/routes/api/presentations/thumbnail.js'
);
const { handlePresentationDuplicate } = await import(
  '../server/routes/api/presentations/duplicate.js'
);

/** Holds an `edit` row on the deck. */
const COLLABORATOR = { email: 'partner@home.example', name: 'Pia', organizationId: HOME_ORG };
/** Holds nothing, and is otherwise indistinguishable. */
const COLLEAGUE = { email: 'colleague@home.example', name: 'Cas', organizationId: HOME_ORG };
const OWNER_EMAIL = 'owner@example.test';

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  assert.equal(isMultiOrgEnabled(), true, 'multi-organization mode for this file');
  __setTestDb(createFakeDb({}));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/**
 * A stored deck. No slides on purpose: the thumbnail route then has nothing to
 * rasterize and lands on its deterministic `thumbnail_pending` 404, which is
 * the answer this file needs to be able to tell apart from a 401.
 *
 * @param {string} organizationId - The organization that owns the deck.
 * @returns {Object}
 */
function deckRow(organizationId) {
  return {
    id: DECK,
    organization_id: organizationId,
    title: 'A deck with one collaborator',
    owner_email: OWNER_EMAIL,
    created_by: OWNER_EMAIL,
    updated_by: OWNER_EMAIL,
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
  };
}

/**
 * Reinstall a freshly seeded double and clear the permission cache, which is
 * module-level with a five-minute TTL and would otherwise answer a later test
 * from an earlier test's grant.
 *
 * @param {Object} [options]
 * @param {string} [options.deckOrg=HOME_ORG] - Organization that owns the deck.
 * @param {string} [options.rowOrg=HOME_ORG] - Organization stamped on the collaborator row.
 * @param {boolean} [options.revoked=false] - Whether the row is revoked.
 * @returns {Promise<void>}
 */
async function seed({ deckOrg = HOME_ORG, rowOrg = HOME_ORG, revoked = false } = {}) {
  db = createFakeDb({
    organizations: [
      { id: HOME_ORG, name: 'Home', slug: 'home' },
      { id: AWAY_ORG, name: 'Away', slug: 'away' },
    ],
    users: [COLLABORATOR, COLLEAGUE].map((actor) => ({
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
    })),
    presentations: [deckRow(deckOrg)],
    presentation_collaborators: [
      {
        id: 'c-1',
        organization_id: rowOrg,
        presentation_id: DECK,
        user_email: COLLABORATOR.email,
        user_id: null,
        permission: 'edit',
        invited_by: OWNER_EMAIL,
        invited_at: '2026-02-02T00:00:00.000Z',
        accepted_at: null,
        revoked_at: revoked ? '2026-03-01T00:00:00.000Z' : null,
        revoked_by: revoked ? OWNER_EMAIL : null,
        revocation_message: null,
      },
    ],
    presentation_versions: [],
    presentation_tags: [],
    tags: [],
    activity_events: [],
    user_notifications: [],
    app_settings: [],
  });
  __setTestDb(db);

  for (const actor of [COLLABORATOR, COLLEAGUE]) {
    await invalidatePermission(DECK, actor.email);
  }
}

/**
 * Call an endpoint handler the way `routes/api/index.js` does. The storage
 * scope is `createStorageScope(user)`, so it carries the *session's*
 * organization — which for the cross-organization cases below deliberately differs
 * from the deck's, and must not be papered over here.
 *
 * @param {Function} handler - The route handler under test.
 * @param {Object} user - The authenticated user.
 * @param {Object} [options]
 * @param {string} [options.method='GET'] - HTTP method.
 * @returns {Promise<{status: number|null, body: Object|null}>}
 */
async function call(handler, user, { method = 'GET' } = {}) {
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = {
    status: null,
    chunks: [],
    writeHead(status) {
      this.status = status;
      return this;
    },
    setHeader() {},
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
    },
  };

  await handler(
    {
      repoRoot: process.cwd(),
      storageScope: createStorageScope(user, { repoRoot: process.cwd() }),
      req,
      res,
      url: new URL(`http://decks.example.test/api/presentations/${DECK}`),
      authedUser: user,
    },
    DECK
  );

  const raw = res.chunks.length ? res.chunks.join('') : null;
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/**
 * Every presentation-scoped endpoint this file can drive, and the status each
 * sends when the caller is authorized. They are listed together because the
 * point of the file is that they never diverge.
 */
const ENDPOINTS = [
  { name: 'the deck itself', handler: handlePresentationItem, granted: 200 },
  { name: 'the version history', handler: handlePresentationVersions, granted: 200 },
  // A slideless deck has nothing to rasterize, so the authorized answer here is
  // the route's own "nothing to show yet" 404 — distinct from its 401.
  { name: 'the thumbnail', handler: handlePresentationThumbnail, granted: 404 },
  {
    name: 'duplicating the deck',
    handler: handlePresentationDuplicate,
    granted: 201,
    method: 'POST',
  },
];

// ---------------------------------------------------------------------------
// One row, one answer, every endpoint
// ---------------------------------------------------------------------------

for (const { name, handler, granted, method } of ENDPOINTS) {
  test(`${name}: an edit collaborator is admitted`, async () => {
    await seed();
    const { status, body } = await call(handler, COLLABORATOR, { method });
    assert.equal(status, granted);
    if (handler === handlePresentationThumbnail) {
      assert.equal(body?.error, 'thumbnail_pending', 'refused at rendering, not at the door');
    }
  });

  test(`${name}: a colleague holding no row is refused`, async () => {
    await seed();
    const { status } = await call(handler, COLLEAGUE, { method });
    assert.equal(status, 401);
  });

  test(`${name}: a revoked row grants nothing`, async () => {
    await seed({ revoked: true });
    const { status } = await call(handler, COLLABORATOR, { method });
    assert.equal(status, 401);
  });
}

test('the deck read reports the permission the row actually grants', async () => {
  await seed();
  const { body } = await call(handlePresentationItem, COLLABORATOR);
  assert.equal(body?._userPermission, 'edit');
});

test('the shared route middleware admits the same person for a write', async () => {
  await seed();
  const res = {
    status: null,
    writeHead(s) {
      this.status = s;
      return this;
    },
    end() {},
  };
  const pres = await withPresentationAuth({
    storageScope: createStorageScope(COLLABORATOR, { repoRoot: process.cwd() }),
    id: DECK,
    authedUser: COLLABORATOR,
    res,
    permission: 'write',
  });
  assert.equal(res.status, null, 'no error response was sent');
  assert.equal(pres?.id, DECK);
});

test('the machine-client seam gives the same answer as the routes', async () => {
  await seed();
  const pres = { id: DECK, visibility: 'private', ownerEmail: OWNER_EMAIL, organizationId: HOME_ORG };
  // A machine actor states its own organization (an API key belongs to one), which
  // on a private deck changes nothing: the collaborator row is the only thing
  // that can grant here, and it is a relation to the deck, not to an organization.
  // The collaborator is signed into AWAY_ORG and still gets in.
  const collaborator = { email: COLLABORATOR.email, organizationId: AWAY_ORG };
  assert.equal(await canActorAccessPresentation(pres, collaborator, 'read'), true);
  assert.equal(await canActorAccessPresentation(pres, collaborator, 'write'), true);
  assert.equal(
    await canActorAccessPresentation(pres, { email: COLLEAGUE.email, organizationId: HOME_ORG }, 'read'),
    false
  );
});

// ---------------------------------------------------------------------------
// The organization stamp is not part of the lookup
// ---------------------------------------------------------------------------

test('a row stamped with a foreign organization still grants — on every endpoint', async () => {
  // The one behaviour this normalisation changes. Such a row is what the old
  // write path produced when the inviter acted from another organization: the
  // grant was made, and then silently did nothing. It now means what it says.
  await seed({ rowOrg: AWAY_ORG });

  assert.equal(await getCollaboratorPermission(DECK, COLLABORATOR.email), 'edit');
  for (const { name, handler, granted, method } of ENDPOINTS) {
    const { status } = await call(handler, COLLABORATOR, { method });
    assert.equal(status, granted, `${name} disagreed with the others`);
  }
});

test('a new invite is stamped with the deck, not with the inviter', async () => {
  await seed({ deckOrg: AWAY_ORG });
  const result = await addCollaborator(DECK, {
    userEmail: 'fresh@home.example',
    permission: 'view',
    invitedBy: COLLABORATOR.email,
  });
  assert.equal(result.ok, true);

  const row = db.__tables.presentation_collaborators.find(
    (r) => r.user_email === 'fresh@home.example'
  );
  assert.equal(row.organization_id, AWAY_ORG, "the deck's organization, not the session's");
});

test('inviting onto a deck that does not exist is refused rather than guessed at', async () => {
  await seed();
  const result = await addCollaborator('no-such-deck', {
    userEmail: 'fresh@home.example',
    permission: 'view',
  });
  assert.deepEqual(result, { ok: false, reason: 'not_found' });
});

// ---------------------------------------------------------------------------
// A deck in another organization is absent, not forbidden — uniformly
// ---------------------------------------------------------------------------

test('a deck in another organization is absent on every endpoint, row or no row', async () => {
  // The storage scope filters on the session's organization before any
  // collaborator row is consulted, so this is 404 (absent) rather than 401
  // (forbidden) — and the collaborator row does not turn into a way around the
  // organization filter. The uniformity is the assertion.
  await seed({ deckOrg: AWAY_ORG, rowOrg: AWAY_ORG });

  for (const { name, handler, method } of ENDPOINTS) {
    for (const person of [COLLABORATOR, COLLEAGUE]) {
      const { status } = await call(handler, person, { method });
      assert.equal(status, 404, `${name} answered differently for ${person.email}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The structural half: no call site can re-introduce a scope
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// The bracket-depth scanner is shared with the share-link access-log guard,
// which pins the same "the identifier is the scope" contract.
const permissionCallArgs = (source) => callArguments(source, 'getCollaboratorPermission');

test('no getCollaboratorPermission() call site passes a scope', () => {
  const offenders = [];

  for (const file of walkJsFiles(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const args of permissionCallArgs(fs.readFileSync(file, 'utf8'))) {
      if (args.length > 2) offenders.push(`${rel}  (${args.length} arguments)`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'getCollaboratorPermission takes a presentation and an email — the deck is the scope. ' +
      'A third argument is the session organization creeping back in:\n  ' +
      offenders.join('\n  ')
  );
});

test('the guard would catch a re-introduced scope argument', () => {
  const planted =
    'await getCollaboratorPermission(pres.id, user.email, { organizationId: ctx.organizationId });';
  assert.equal(permissionCallArgs(planted)[0].length, 3, 'the parser sees all three arguments');
  assert.equal(
    permissionCallArgs('await getCollaboratorPermission(pres.id, user.email);')[0].length,
    2,
    'and exactly two on the canonical form'
  );
});
