/**
 * The storage scope contract (A1 follow-up: the presentations facade).
 *
 * `server/storage/presentations.js` used to build its own storage context with
 * a hardcoded `getDefaultOrganizationId()`, so `getPresentation(repoRoot, id)`
 * read out of the default organization no matter which one the session was
 * working in. The facade now takes a scope and has no default left to fall back
 * to; `server/storage/scope.js` is where that rule lives.
 *
 * This file pins the rule itself, in single-workspace mode — the mode every
 * current installation runs in, where the *behaviour* is unchanged and only the
 * shape of the call differs. The multi-organization consequences (organization A
 * cannot read organization B's deck through the facade) live in
 * tests/storage-scope-multi-org.test.js, which needs the feature flag set before
 * import and therefore its own process.
 *
 * **Which assertions fail without the change**: every one that expects a throw.
 * Restore the old `getStorageContext()` and they go green-by-accident, because
 * the facade would answer with the default organization instead of refusing.
 *
 * Run with: node --test tests/storage-scope-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_WORKSPACE_ENABLED;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const {
  resolveScope,
  repoRootOf,
  crossOrganizationScope,
  singleWorkspaceScope,
  jobScope,
} = await import('../server/storage/scope.js');
const { createRouteContext } = await import('../server/utils/context.js');
const facade = await import('../server/storage/presentations.js');

// ─── the rule: no scope, no answer ──────────────────────────────────────────

test('a bare repoRoot string is refused, and says what to pass instead', () => {
  assert.throws(
    () => resolveScope('/srv/deckyard', 'getPresentation'),
    (err) =>
      err instanceof TypeError &&
      /takes a storage scope, not a repoRoot string/.test(err.message) &&
      /createRouteContext/.test(err.message),
    'the old call shape must fail loudly, not read the default organization'
  );
});

test('null and undefined are refused', () => {
  for (const value of [null, undefined]) {
    assert.throws(
      () => resolveScope(value, 'getPresentation'),
      /requires a storage scope/,
      `${value} must not resolve to anything`
    );
  }
});

test('a scope that states no organization is refused', () => {
  assert.throws(
    () => resolveScope({ repoRoot: '/srv/deckyard' }, 'listPresentations'),
    /no organizationId/,
    'the facade may not fill in the default organization for a caller that gave none'
  );
});

test('an empty-string organization counts as none', () => {
  assert.throws(() => resolveScope({ organizationId: '' }, 'getPresentation'), /no organizationId/);
});

test('an organization-scoped scope resolves to exactly what it stated', () => {
  const resolved = resolveScope(
    { repoRoot: '/srv/deckyard', organizationId: ORG, actorEmail: 'alice@example.com' },
    'getPresentation'
  );
  assert.equal(resolved.organizationId, ORG);
  assert.equal(resolved.actorEmail, 'alice@example.com');
  assert.equal(resolved.crossOrganization, undefined);
});

// ─── cross-organization is a declaration, and it is read-only ───────────────

test('a cross-organization read is allowed when the operation permits it', () => {
  const resolved = resolveScope(
    crossOrganizationScope('/srv/deckyard', 'share link: the share token is the authorization'),
    'getPresentation',
    { allowCrossOrganization: true }
  );
  assert.equal(resolved.organizationId, undefined, 'no organization filter is applied');
  assert.match(resolved.crossOrganization, /share token/);
});

test('a cross-organization scope cannot reach an operation that writes', () => {
  assert.throws(
    () =>
      resolveScope(
        crossOrganizationScope(null, 'lead capture from a published deck'),
        'updatePresentation'
      ),
    /cannot run cross-organization/,
    'an unscoped write would land wherever the storage layer guessed'
  );
});

test('cross-organization cannot reach a listing either', () => {
  assert.throws(
    () => resolveScope(crossOrganizationScope(null, 'anything'), 'listPresentations'),
    /cannot run cross-organization/
  );
});

test('crossOrganizationScope insists on a reason, so unscoped reads stay countable', () => {
  assert.throws(() => crossOrganizationScope('/srv', ''), /requires a reason/);
  assert.throws(() => crossOrganizationScope('/srv'), /requires a reason/);
});

test('a stated organization wins over a cross-organization declaration', () => {
  const resolved = resolveScope(
    { organizationId: ORG, crossOrganization: 'belt and braces' },
    'updatePresentation'
  );
  assert.equal(resolved.organizationId, ORG, 'the write stays scoped');
});

// ─── the entry points that have no session ─────────────────────────────────

test('singleWorkspaceScope answers with the configured organization', () => {
  const scope = singleWorkspaceScope('/srv/deckyard', 'MCP stdio session');
  assert.equal(scope.organizationId, ORG);
  assert.equal(scope.repoRoot, '/srv/deckyard');
});

test('jobScope prefers the organization the job payload carries', () => {
  const scope = jobScope(
    { repoRoot: '/srv', organizationId: 'org-from-payload', actorEmail: 'a@b.c' },
    'export job'
  );
  assert.equal(scope.organizationId, 'org-from-payload');
  assert.equal(scope.actorEmail, 'a@b.c');
});

test('a job enqueued before the organization travelled still runs single-workspace', () => {
  const scope = jobScope({ repoRoot: '/srv', ownerEmail: 'a@b.c' }, 'export job');
  assert.equal(scope.organizationId, ORG, 'exact here: this instance has one organization');
  assert.equal(scope.actorEmail, 'a@b.c');
});

// ─── the route context doubles as a scope ──────────────────────────────────

test('createRouteContext produces a scope the facade accepts', () => {
  const scope = createRouteContext(
    { email: 'alice@example.com', organizationId: ORG },
    { repoRoot: '/srv/deckyard' }
  );
  const resolved = resolveScope(scope, 'getPresentation');
  assert.equal(resolved.organizationId, ORG);
  assert.equal(resolved.actorEmail, 'alice@example.com');
  assert.equal(repoRootOf(scope), '/srv/deckyard', 'the file fallback still gets its path');
});

test('a session pending database validation cannot smuggle an organization through', () => {
  const scope = createRouteContext(
    { email: 'mallory@example.com', organizationId: 'org-unverified', _needsDbValidation: true },
    { repoRoot: '/srv' }
  );
  assert.equal(
    scope.organizationId,
    ORG,
    'the unverified claim is dropped, exactly as it was before scopes existed'
  );
});

// ─── the facade refuses the old call shape end to end ──────────────────────

test('every facade entry point refuses a bare repoRoot', async () => {
  const calls = [
    ['listPresentations', (fn) => fn('/srv')],
    ['getPresentation', (fn) => fn('/srv', 'deck-1')],
    ['createPresentation', (fn) => fn('/srv', { title: 'x' })],
    ['updatePresentation', (fn) => fn('/srv', 'deck-1', { title: 'x' })],
    ['deletePresentation', (fn) => fn('/srv', 'deck-1')],
    ['listTrashedPresentations', (fn) => fn('/srv')],
    ['restorePresentation', (fn) => fn('/srv', 'deck-1')],
    ['permanentlyDeletePresentation', (fn) => fn('/srv', 'deck-1')],
    ['duplicatePresentation', (fn) => fn('/srv', 'deck-1')],
    ['getFirstSlidesForIds', (fn) => fn('/srv', ['deck-1'])],
    ['listPresentationVersions', (fn) => fn('/srv', 'deck-1')],
    ['getPresentationVersion', (fn) => fn('/srv', 'deck-1', 'v1')],
    ['createPresentationVersion', (fn) => fn('/srv', 'deck-1', {})],
    ['prunePresentationVersions', (fn) => fn('/srv', 'deck-1')],
  ];

  for (const [name, invoke] of calls) {
    await assert.rejects(
      async () => invoke(facade[name]),
      /takes a storage scope, not a repoRoot string/,
      `${name}() must refuse the pre-scope call shape`
    );
  }
});

// ─── the read funnels in FRONT of the facade take a scope too ──────────────
//
// The short-TTL cache (server/storage/presentation-cache.js) calls
// getPresentation on the audience hot paths — follow status ticks, interaction
// state, votes. It kept passing a bare repoRoot after the facade stopped
// accepting one, which turned every follow-along audience request into a 500.
// The facade contract above cannot catch that: the cache reaches the facade
// through a dynamic import, so nothing type-checks the hand-off. These pin it.

const { getPresentationCached } = await import('../server/storage/presentation-cache.js');
const { followAudienceScope } = await import('../server/routes/api/follow/helpers.js');

test('the presentation cache passes its caller scope through to the facade', async () => {
  // Resolves to null (no storage, no file) — what matters is that it resolves
  // at all instead of throwing the scope TypeError at the audience.
  const pres = await getPresentationCached(followAudienceScope('/srv'), 'deck-1');
  assert.equal(pres, null);
});

test('the presentation cache refuses a bare repoRoot, like the facade does', async () => {
  await assert.rejects(
    async () => getPresentationCached('/srv', 'deck-1'),
    /takes a storage scope, not a repoRoot string/
  );
});

// The cross-organization half of the cache contract — that organization B is
// never served the entry read for organization A — needs two organizations with
// real decks behind them, so it lives in tests/storage-scope-multi-org.test.js.
