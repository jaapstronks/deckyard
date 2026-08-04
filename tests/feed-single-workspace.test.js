/**
 * The single-workspace mirror of feed-multi-workspace-gate.test.js: with
 * `MULTI_WORKSPACE_ENABLED` off, the default organization *is* the instance, so
 * the public feed is exactly its feed — the multi-workspace gate must be
 * transparent and change nothing for existing installations.
 *
 * Both halves resolve the feed's organization from `getDefaultOrganizationId()`.
 * Here that resolution must happen (the gate does not short-circuit): the feed
 * route reaches the organization lookup, and the app-shell advertises the
 * autodiscovery links for an org that has RSS enabled. None of this is new
 * behaviour — the point is that the gate added for multi-workspace leaves it
 * intact.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js),
 * so this file unsets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/feed-single-workspace.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MULTI_WORKSPACE_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
delete process.env.RSS_FEED_ENABLED; // default: RSS on

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handleFeed } = await import('../server/routes/feed.js');
const { injectFeedDiscovery } = await import('../server/routes/static/app-shell.js');

function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings: { rss: { enabled: true } } }],
  });
  __setTestDb(db);
  return db;
}

function mockRes() {
  return {
    statusCode: null,
    body: '',
    writeHead(code) {
      this.statusCode = code;
      return this;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
}

test('handleFeed passes the gate in single-workspace and resolves the organization', async () => {
  const db = installDb();
  const res = mockRes();
  // The route builds the feed from the storage abstraction, which is not wired
  // up in this unit test — so it may throw once it gets *past* the gate. That is
  // fine: reaching the organization lookup at all is the proof that the
  // multi-workspace gate (which 404s before any DB access) stayed transparent.
  try {
    await handleFeed({
      repoRoot: null,
      req: { method: 'GET', headers: {} },
      res,
      url: new URL('http://localhost/feed/rss.xml'),
    });
  } catch {
    /* storage abstraction not initialized in this unit test — see above */
  }

  assert.notEqual(res.statusCode, 404, 'the feed was not gated off in single-workspace');
  assert.ok(
    touchedTables(db).includes('organizations'),
    'the feed resolved its organization instead of being gated off'
  );
});

test('injectFeedDiscovery advertises the feed links in single-workspace', async () => {
  installDb();
  const html = await injectFeedDiscovery('<head></head>', null);

  assert.ok(html.includes('/feed/rss.xml'), 'RSS autodiscovery link present');
  assert.ok(html.includes('/feed/atom.xml'), 'Atom autodiscovery link present');
  assert.ok(html.includes('/feed/feed.json'), 'JSON autodiscovery link present');
});
