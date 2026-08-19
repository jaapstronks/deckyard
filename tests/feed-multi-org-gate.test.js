/**
 * The public RSS feed is instance-global, so it has no home under
 * multi-organization (A1 org-scoping, deelbesluit 4).
 *
 * `handleFeed` and the app-shell's `injectFeedDiscovery` both resolve "which
 * presentations" from `getDefaultOrganizationId()` — they have no session to
 * take an organization from. That is a valid answer only in single-organization
 * mode; once an instance holds several organizations, serving one organization's
 * presentations under the instance-global `/feed/*.xml` URL (and advertising it
 * with `<link rel="alternate">`) would leak that organization across the instance.
 * So under `MULTI_ORG_ENABLED` the feed routes 404 and the autodiscovery
 * links are omitted.
 *
 * These assertions distinguish the *gate* 404 from any other 404 by checking the
 * database was never queried: the gate short-circuits before the organization is
 * ever resolved, so a fake db installed here records no `organizations` lookup.
 * The single-organization mirror — same setup, gate transparent — is in
 * feed-single-org.test.js.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/feed-multi-org-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
delete process.env.RSS_FEED_ENABLED; // default: RSS on, so only the multi-organization gate can 404

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { handleFeed } = await import('../server/routes/feed.js');
const { injectFeedDiscovery } =
  await import('../server/routes/static/app-shell.js');

// An org that *would* serve a feed if it were reachable — RSS enabled — so a 404
// here can only be the multi-organization gate, never a missing/disabled org.
function installDb() {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Alpha',
        slug: 'alpha',
        settings: { rss: { enabled: true } },
      },
    ],
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

for (const [pathname, format] of [
  ['/feed/rss.xml', 'rss'],
  ['/feed/atom.xml', 'atom'],
  ['/feed/feed.json', 'json'],
]) {
  test(`handleFeed 404s ${format} under multi-organization, before touching the database`, async () => {
    const db = installDb();
    const res = mockRes();
    const handled = await handleFeed({
      repoRoot: null,
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://localhost${pathname}`),
    });

    assert.equal(handled, true, 'the feed route is still owned by handleFeed');
    assert.equal(res.statusCode, 404, 'the feed 404s under multi-organization');
    assert.ok(
      !touchedTables(db).includes('organizations'),
      'the 404 came from the gate, before any organization was resolved',
    );
  });
}

test('injectFeedDiscovery omits the autodiscovery links under multi-organization', async () => {
  const db = installDb();
  const html = await injectFeedDiscovery('<head></head>', null);

  assert.ok(
    !html.includes('rel="alternate"'),
    'no feed <link> is advertised under multi-organization',
  );
  assert.ok(
    !touchedTables(db).includes('organizations'),
    'discovery short-circuits before resolving an organization',
  );
});
