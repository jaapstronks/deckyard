/**
 * The theme + font-family CRUD route layer (test-coverage gap map, B40 —
 * surface 7, "Thema-/font-CRUD-routes + storage").
 *
 * `server/routes/api/themes.js` and `server/routes/api/font-families.js` are the
 * organization-scoped design-resource endpoints: custom themes and managed font
 * families. Their storage and the `canManage`/`isDesigner` capability resolution
 * are tested elsewhere (`tests/change-theme-gated.test.js`,
 * `tests/designer-capability-org-scope*.test.js`), and the dispatch wiring +
 * guard short-circuit has `tests/c8-routes-batch-5-dispatch.test.js`. What was
 * untested is the handlers' own contract: happy-path CRUD over a real storage
 * scope, the read/write authorization split, and the per-reason 400/404s.
 *
 * Two rules carry this surface and are stated here as assertions:
 *
 *   1. **Reading is broad, managing needs the designer capability.** Any
 *      authenticated user may list and read themes and font families; creating,
 *      updating, deleting, setting a default or previewing a draft needs
 *      `canManage` (designer, or — single-org — an admin). A plain member is
 *      refused every mutation.
 *   2. **The two modules refuse a non-manager differently.** A theme mutation
 *      without the capability is a **403** (`forbidden`, "Admin access
 *      required"); the identical denial on a font family is a **401**
 *      (`unauthorized`). That asymmetry is a known pre-existing inconsistency —
 *      a beta-doctrine tidy-up candidate, logged in
 *      briefs/test-coverage-gaps.md — not a designed contract.
 *      `c8-routes-batch-5-dispatch` pins it at the guard; pinning it here at
 *      the handler contract keeps the eventual convergence from silently
 *      changing one surface's status code without the other.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): three
 * font-family paths cross a boundary this recipe cannot drive — `discover-adobe`
 * (a live `fetch` to use.typekit.net) and `upload-variant` / the file-cleanup
 * branch of remove/delete (a configured media provider). Those are pinned at
 * their `canManage` gate and their pre-boundary validation (missing projectId,
 * missing dataUrl format) only; the network call and the media upload are the
 * opt-out, same class as the SSO/Sharp and LLM seams already in the brief.
 *
 * House shape (see `tests/collaborators-permission-model.test.js`): the exported
 * handler is called directly with a req/res double over `tests/helpers/fake-db.js`
 * and the router's own `createStorageScope`. No HTTP server, no browser.
 *
 * Run with: node --test tests/theme-font-routes-authz.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_ORG_ENABLED; // single-org: canManage tracks the designer flag

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/lifecycle.js'
);
const { createStorageScope } = await import('../server/utils/context.js');
const { handleThemes } = await import('../server/routes/api/themes.js');
const { handleFontFamilies } = await import('../server/routes/api/font-families.js');

/** @typedef {{email: string, name: string, organizationId: string, isDesigner?: boolean}} Actor */

const ACTORS = {
  designer: { email: 'designer@example.com', name: 'Dana Designer', organizationId: ORG, isDesigner: true },
  member: { email: 'member@example.com', name: 'Mia Member', organizationId: ORG },
};

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

function seed() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: 'user-designer',
        organization_id: ORG,
        email: ACTORS.designer.email,
        name: ACTORS.designer.name,
        role: 'user',
        auth_source: 'database',
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    themes: [],
    font_families: [],
    font_variants: [],
    app_settings: [],
  });
  __setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Driving the handlers
// ---------------------------------------------------------------------------

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
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

/**
 * Call `handleThemes` / `handleFontFamilies` the way `routes/api/index.js` does
 * — the module self-dispatches on method + path, so the id captures ride the URL.
 *
 * @param {Function} handler
 * @param {string} method
 * @param {string} path
 * @param {Object} [options]
 * @param {Actor|null} [options.as]
 * @param {Object} [options.body]
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handler, method, path, { as = null, body } = {}) {
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
  const authedUser = as || undefined;
  const handled = await handler({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${path}`),
    authedUser,
  });
  return { handled, res };
}

// ===========================================================================
// themes.js — reads open, mutations need the designer capability (403 on deny)
// ===========================================================================

test('any authed user can list themes and the curated font catalog', async () => {
  seed();
  const themes = await call(handleThemes, 'GET', '/api/themes', { as: ACTORS.member });
  assert.equal(themes.res.statusCode, 200);
  assert.ok(Array.isArray(themes.res.body.themes), 'a themes array is returned');

  const fonts = await call(handleThemes, 'GET', '/api/themes/fonts', { as: ACTORS.member });
  assert.equal(fonts.res.statusCode, 200);
  assert.ok(Array.isArray(fonts.res.body.fonts));
});

test('any authed user can list custom themes', async () => {
  seed();
  const { res } = await call(handleThemes, 'GET', '/api/themes/custom', { as: ACTORS.member });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.themes, []);
});

test('a designer can create a custom theme; a plain member gets a 403', async () => {
  seed();
  const denied = await call(handleThemes, 'POST', '/api/themes/custom', {
    as: ACTORS.member,
    body: { label: 'Brand One' },
  });
  assert.equal(denied.res.statusCode, 403, 'theme mutations deny with forbidden');
  assert.equal(denied.res.body.error, 'forbidden');

  const created = await call(handleThemes, 'POST', '/api/themes/custom', {
    as: ACTORS.designer,
    body: { label: 'Brand One' },
  });
  assert.equal(created.res.statusCode, 201);
  assert.ok(created.res.body.id, 'the new theme id is returned');
  assert.equal(created.res.body.label, 'Brand One');
});

test('create rejects an empty label with a 400', async () => {
  seed();
  const { res } = await call(handleThemes, 'POST', '/api/themes/custom', {
    as: ACTORS.designer,
    body: { label: '' },
  });
  assert.equal(res.statusCode, 400);
});

test('a designer can preview a draft config; a member cannot', async () => {
  seed();
  const denied = await call(handleThemes, 'POST', '/api/themes/custom/preview-config', {
    as: ACTORS.member,
    body: { label: 'Draft' },
  });
  assert.equal(denied.res.statusCode, 403);

  const ok = await call(handleThemes, 'POST', '/api/themes/custom/preview-config', {
    as: ACTORS.designer,
    body: { label: 'Draft' },
  });
  assert.equal(ok.res.statusCode, 200);
  assert.ok(ok.res.body.theme, 'a built theme config comes back');
});

test('reading, updating, deleting and defaulting a custom theme by id', async () => {
  seed();
  const created = await call(handleThemes, 'POST', '/api/themes/custom', {
    as: ACTORS.designer,
    body: { label: 'Brand Two' },
  });
  const id = created.res.body.id;

  // Read: open to any authed user.
  const read = await call(handleThemes, 'GET', `/api/themes/custom/${id}`, { as: ACTORS.member });
  assert.equal(read.res.statusCode, 200);
  assert.equal(read.res.body.id, id);

  // A missing id is a 404.
  const missing = await call(handleThemes, 'GET', '/api/themes/custom/deadbeef', { as: ACTORS.member });
  assert.equal(missing.res.statusCode, 404);

  // Update: designer only.
  const memberUpdate = await call(handleThemes, 'PUT', `/api/themes/custom/${id}`, {
    as: ACTORS.member,
    body: { label: 'Renamed' },
  });
  assert.equal(memberUpdate.res.statusCode, 403);

  const update = await call(handleThemes, 'PUT', `/api/themes/custom/${id}`, {
    as: ACTORS.designer,
    body: { label: 'Renamed' },
  });
  assert.equal(update.res.statusCode, 200);
  assert.equal(update.res.body.label, 'Renamed');

  // Set default: designer only.
  const memberDefault = await call(handleThemes, 'POST', `/api/themes/custom/${id}/set-default`, {
    as: ACTORS.member,
  });
  assert.equal(memberDefault.res.statusCode, 403);
  const setDefault = await call(handleThemes, 'POST', `/api/themes/custom/${id}/set-default`, {
    as: ACTORS.designer,
  });
  assert.equal(setDefault.res.statusCode, 200);

  // Delete: designer only, then it is gone.
  const memberDelete = await call(handleThemes, 'DELETE', `/api/themes/custom/${id}`, { as: ACTORS.member });
  assert.equal(memberDelete.res.statusCode, 403);
  const del = await call(handleThemes, 'DELETE', `/api/themes/custom/${id}`, { as: ACTORS.designer });
  assert.equal(del.res.statusCode, 200);

  const gone = await call(handleThemes, 'GET', `/api/themes/custom/${id}`, { as: ACTORS.member });
  assert.equal(gone.res.statusCode, 404);
});

test('clearing the org default needs the designer capability', async () => {
  seed();
  const denied = await call(handleThemes, 'POST', '/api/themes/custom/clear-default', { as: ACTORS.member });
  assert.equal(denied.res.statusCode, 403);

  const ok = await call(handleThemes, 'POST', '/api/themes/custom/clear-default', { as: ACTORS.designer });
  assert.equal(ok.res.statusCode, 200);
});

test('setting a default on a missing theme is a 404', async () => {
  seed();
  const { res } = await call(handleThemes, 'POST', '/api/themes/custom/deadbeef/set-default', {
    as: ACTORS.designer,
  });
  assert.equal(res.statusCode, 404);
});

// ===========================================================================
// font-families.js — reads need a session, mutations need canManage (401 on deny)
// ===========================================================================

test('listing font families needs a session', async () => {
  seed();
  const anon = await call(handleFontFamilies, 'GET', '/api/font-families');
  assert.equal(anon.res.statusCode, 401, 'the list is not anonymous');

  const member = await call(handleFontFamilies, 'GET', '/api/font-families', { as: ACTORS.member });
  assert.equal(member.res.statusCode, 200);
  assert.ok(Array.isArray(member.res.body.fontFamilies));
});

test('a designer can create a font family; a member gets a 401 (not 403)', async () => {
  seed();
  const denied = await call(handleFontFamilies, 'POST', '/api/font-families', {
    as: ACTORS.member,
    body: { name: 'Brand Sans', source: 'upload', category: 'sans-serif' },
  });
  assert.equal(denied.res.statusCode, 401, 'font mutations deny with unauthorized — the known asymmetry with themes (see header rule 2)');
  assert.equal(denied.res.body.error, 'unauthorized');

  const created = await call(handleFontFamilies, 'POST', '/api/font-families', {
    as: ACTORS.designer,
    body: { name: 'Brand Sans', source: 'upload', category: 'sans-serif' },
  });
  assert.equal(created.res.statusCode, 201);
  assert.ok(created.res.body.id);
});

test('reading, updating and deleting a font family by id', async () => {
  seed();
  const created = await call(handleFontFamilies, 'POST', '/api/font-families', {
    as: ACTORS.designer,
    body: { name: 'Brand Serif', source: 'upload', category: 'serif' },
  });
  const id = created.res.body.id;

  // Read: any authed user; anonymous is 401; missing is 404.
  const anon = await call(handleFontFamilies, 'GET', `/api/font-families/${id}`);
  assert.equal(anon.res.statusCode, 401);
  const read = await call(handleFontFamilies, 'GET', `/api/font-families/${id}`, { as: ACTORS.member });
  assert.equal(read.res.statusCode, 200);
  assert.equal(read.res.body.id, id);
  const missing = await call(handleFontFamilies, 'GET', '/api/font-families/deadbeef', { as: ACTORS.member });
  assert.equal(missing.res.statusCode, 404);

  // Update: designer only.
  const memberUpdate = await call(handleFontFamilies, 'PUT', `/api/font-families/${id}`, {
    as: ACTORS.member,
    body: { name: 'Renamed Serif' },
  });
  assert.equal(memberUpdate.res.statusCode, 401);
  const update = await call(handleFontFamilies, 'PUT', `/api/font-families/${id}`, {
    as: ACTORS.designer,
    body: { name: 'Renamed Serif' },
  });
  assert.equal(update.res.statusCode, 200);

  // Delete: designer only.
  const memberDelete = await call(handleFontFamilies, 'DELETE', `/api/font-families/${id}`, { as: ACTORS.member });
  assert.equal(memberDelete.res.statusCode, 401);
  const del = await call(handleFontFamilies, 'DELETE', `/api/font-families/${id}`, { as: ACTORS.designer });
  assert.equal(del.res.statusCode, 200);

  const gone = await call(handleFontFamilies, 'GET', `/api/font-families/${id}`, { as: ACTORS.member });
  assert.equal(gone.res.statusCode, 404);
});

test('importing an Adobe family creates it without a font file', async () => {
  seed();
  const denied = await call(handleFontFamilies, 'POST', '/api/font-families/import-adobe-family', {
    as: ACTORS.member,
    body: { projectId: 'abc123', familyName: 'Acumin' },
  });
  assert.equal(denied.res.statusCode, 401);

  const missing = await call(handleFontFamilies, 'POST', '/api/font-families/import-adobe-family', {
    as: ACTORS.designer,
    body: { projectId: 'abc123' }, // no familyName
  });
  assert.equal(missing.res.statusCode, 400);

  const ok = await call(handleFontFamilies, 'POST', '/api/font-families/import-adobe-family', {
    as: ACTORS.designer,
    body: { projectId: 'abc123', familyName: 'Acumin', variants: [{ weight: 400, style: 'normal' }] },
  });
  assert.equal(ok.res.statusCode, 201);
  assert.equal(ok.res.body.source, 'adobe');
});

test('the Adobe discovery route gates and validates before it reaches the network', async () => {
  seed();
  const denied = await call(handleFontFamilies, 'POST', '/api/font-families/discover-adobe', {
    as: ACTORS.member,
    body: { projectId: 'abc123' },
  });
  assert.equal(denied.res.statusCode, 401, 'the canManage gate runs before any fetch');

  const missing = await call(handleFontFamilies, 'POST', '/api/font-families/discover-adobe', {
    as: ACTORS.designer,
    body: {},
  });
  assert.equal(missing.res.statusCode, 400, 'a missing projectId is a 400 before any fetch');

  const malformed = await call(handleFontFamilies, 'POST', '/api/font-families/discover-adobe', {
    as: ACTORS.designer,
    body: { projectId: 'not a valid id!' },
  });
  assert.equal(malformed.res.statusCode, 400, 'a malformed projectId is a 400 before any fetch');
});

test('the file-upload variant route is gated before it reaches the media provider', async () => {
  seed();
  const created = await call(handleFontFamilies, 'POST', '/api/font-families', {
    as: ACTORS.designer,
    body: { name: 'Upload Target', source: 'upload' },
  });
  const id = created.res.body.id;

  const denied = await call(handleFontFamilies, 'POST', `/api/font-families/${id}/upload-variant`, {
    as: ACTORS.member,
    body: { dataUrl: 'data:font/woff2;base64,AAAA' },
  });
  assert.equal(denied.res.statusCode, 401, 'the canManage gate runs before the media provider is touched');

  // A designer with a malformed dataUrl is a 400 — still before the provider.
  const badData = await call(handleFontFamilies, 'POST', `/api/font-families/${id}/upload-variant`, {
    as: ACTORS.designer,
    body: { dataUrl: 'not-a-data-url' },
  });
  assert.equal(badData.res.statusCode, 400);
});

test('removing a variant is designer-gated', async () => {
  seed();
  const { res } = await call(handleFontFamilies, 'DELETE', '/api/font-families/aaa111/variants/bbb222', {
    as: ACTORS.member,
  });
  assert.equal(res.statusCode, 401);
});
