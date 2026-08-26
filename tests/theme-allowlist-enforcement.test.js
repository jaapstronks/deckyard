/**
 * `enabledThemes` is a hard allowlist (B176 / D70).
 *
 * The setting used to be an annotation: `GET /api/themes` returned every theme
 * and tagged the non-allowlisted ones `enabled: false`, which left each picker
 * free to decide how seriously to take it. Two of the three did not take it
 * seriously at all, so unchecking a theme in Settings → Themes hid it from the
 * creation grid (behind a one-click "Show all themes" toggle) and nowhere else.
 *
 * One meaning now: a theme outside the allowlist is not in the response, so no
 * picker can offer it. This file pins that, plus the three things that would
 * otherwise make the rule unusable:
 *
 *   1. The **default theme** is always offered — a workspace must not be able
 *      to allowlist itself out of the theme its own new decks get.
 *   2. **`?current=<id>`** keeps one named theme in the list, so a deck that
 *      predates a withdrawal keeps showing its own selection.
 *   3. **`?all=1`** skips the filter for users who may manage themes, because
 *      the settings tab cannot offer a checkbox for a theme it cannot see —
 *      and honours it for nobody else, or it is the leak this closes.
 *
 * House shape follows `tests/theme-font-routes-authz.test.js`: the exported
 * handler is called directly over `tests/helpers/fake-db.js`. The env-fallback
 * half of the precedence (`ENABLED_THEMES`) needs no database and lives in
 * `tests/app-settings-default-theme.test.js` next to its `DEFAULT_THEME` twin.
 *
 * Run with: node --test tests/theme-allowlist-enforcement.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_ORG_ENABLED; // single-org: canManage tracks the designer flag
delete process.env.ENABLED_THEMES; // the env fallback is tested separately
delete process.env.DEFAULT_THEME;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleThemes } = await import('../server/routes/api/themes.js');
const { DEFAULT_THEME_ID } = await import('../shared/constants/themes.js');

const DESIGNER = {
  email: 'designer@example.com',
  name: 'Dana Designer',
  organizationId: ORG,
  isDesigner: true,
};
const MEMBER = {
  email: 'member@example.com',
  name: 'Mia Member',
  organizationId: ORG,
};

/**
 * Seed a database whose app settings carry the given allowlist.
 * @param {string[]} enabledThemes - Allowlisted theme ids ([] = none configured)
 */
function seed(enabledThemes) {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [],
      app_settings: [{ id: true, settings: { enabledThemes } }],
    }),
  );
}

test.before(async () => {
  seed([]);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

function makeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
}

/**
 * List themes through the real handler.
 * @param {string} path - Request path, query string included
 * @param {Object} [authedUser] - Actor
 * @returns {Promise<{statusCode: number, ids: string[], enabledThemes: string[]}>}
 */
async function listThemes(path, authedUser = MEMBER) {
  const res = makeRes();
  await handleThemes({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL(`http://decks.example.test${path}`),
    authedUser,
  });
  return {
    statusCode: res.statusCode,
    ids: (res.body?.themes || []).map((th) => String(th.id)),
    enabledThemes: res.body?.enabledThemes || [],
  };
}

test('an empty allowlist offers every theme', async () => {
  seed([]);
  const { statusCode, ids, enabledThemes } = await listThemes('/api/themes');
  assert.equal(statusCode, 200);
  assert.deepEqual(enabledThemes, [], 'nothing configured');
  // Not an exhaustive list — the point is that the non-default ones survive.
  for (const id of [DEFAULT_THEME_ID, 'editorial', 'midnight', 'playful']) {
    assert.ok(ids.includes(id), `${id} is offered`);
  }
});

test('a configured allowlist removes the rest from the response', async () => {
  seed(['editorial']);
  const { ids, enabledThemes } = await listThemes('/api/themes');
  assert.deepEqual(enabledThemes, ['editorial']);
  assert.ok(ids.includes('editorial'), 'the allowlisted theme is offered');
  assert.ok(
    !ids.includes('midnight'),
    'a theme outside the allowlist is absent, not annotated',
  );
  assert.ok(
    !ids.includes('playful'),
    'a theme outside the allowlist is absent, not annotated',
  );
});

test('the default theme is offered even when it is not allowlisted', async () => {
  seed(['editorial']);
  const { ids } = await listThemes('/api/themes');
  assert.ok(
    ids.includes(DEFAULT_THEME_ID),
    'the workspace cannot allowlist itself out of its own default',
  );
});

test('no theme carries an `enabled` flag any more', async () => {
  seed(['editorial']);
  const res = makeRes();
  await handleThemes({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(MEMBER, { repoRoot: process.cwd() }),
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL('http://decks.example.test/api/themes'),
    authedUser: MEMBER,
  });
  for (const theme of res.body.themes) {
    assert.ok(
      !('enabled' in theme),
      `${theme.id} carries no soft-visibility annotation`,
    );
  }
});

test('?current= keeps a deck on a withdrawn theme showing its own selection', async () => {
  seed(['editorial']);
  const { ids } = await listThemes('/api/themes?current=midnight');
  assert.ok(ids.includes('midnight'), 'the named theme is back in the list');
  assert.ok(
    !ids.includes('playful'),
    'and only that one — the allowlist still holds for everything else',
  );
});

test('?current= with an unknown id widens nothing', async () => {
  seed(['editorial']);
  const { ids } = await listThemes('/api/themes?current=no-such-theme');
  assert.ok(!ids.includes('midnight'));
  assert.ok(!ids.includes('playful'));
});

test('?all=1 skips the filter for a theme manager', async () => {
  seed(['editorial']);
  const { ids } = await listThemes('/api/themes?all=1', DESIGNER);
  assert.ok(
    ids.includes('midnight') && ids.includes('playful'),
    'the settings tab can see what it has to offer a checkbox for',
  );
});

test('?all=1 is ignored for a user who may not manage themes', async () => {
  seed(['editorial']);
  const { ids } = await listThemes('/api/themes?all=1', MEMBER);
  assert.ok(
    !ids.includes('midnight'),
    'the escape hatch is not a way around the allowlist',
  );
});
