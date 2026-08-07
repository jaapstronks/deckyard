/**
 * `/api/home` aggregation round-trip against real PostgreSQL, through the facade.
 *
 * The PostgreSQL counterpart of the `handleHome (round-trip)` half of
 * tests/home-aggregation-route.test.js. The pure `buildActivityOpts` filter
 * threading stays DB-less in that file; this asserts the assembly path —
 * `handleHome` fanning team slides, team collections and the user's usage set
 * into the shape the Home loaders consume — against the backend PR G keeps.
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { handleHome } from '../../server/routes/api/home.js';
import { createTeamLibraryItem } from '../../server/storage/slide-library/index.js';
import { createTeamCollection } from '../../server/storage/collections/index.js';
import { recordSlideLibraryUsage } from '../../server/storage/slide-library-usage/index.js';

const storageScope = testScope();
const USER = 'user@example.com';

/** Minimal response stub recording status + parsed JSON body. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function callHome({ user = { email: USER }, search = '' } = {}) {
  const res = makeRes();
  const url = new URL(`http://localhost/api/home${search}`);
  return handleHome({ storageScope: scope, req: { method: 'GET' }, res, url, authedUser: user }).then(
    (handled) => ({ handled, res })
  );
}

pgDescribe('handleHome round-trip (real PostgreSQL, via facade)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);

    await createTeamLibraryItem(
      storageScope,
      { name: 'Shared title slide', slideType: 'title', content: {} },
      { actorEmail: USER }
    );
    await createTeamCollection(storageScope, { name: 'Onboarding kit', slideIds: [] }, { actorEmail: USER });
    await recordSlideLibraryUsage(storageScope, USER, [{ type: 'slide', id: 'used-1' }]);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('rejects an unauthenticated request', async () => {
    const { res } = await callHome({ user: null });
    assert.strictEqual(res.statusCode, 401);
  });

  it('assembles the full home shape in one call', async () => {
    const { handled, res } = await callHome();
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);

    const body = res.body;
    assert.strictEqual(body.ok, true);

    // Sections always present with the shape the client loaders consume.
    assert.ok(Array.isArray(body.popular), 'popular is an array');
    assert.ok(Array.isArray(body.activity.events), 'activity.events is an array');
    assert.ok(body.buildingBlocks.collections, 'has collections');
    assert.ok(Array.isArray(body.buildingBlocks.collections.personal));
    assert.ok(Array.isArray(body.buildingBlocks.collections.team));
    assert.ok(Array.isArray(body.buildingBlocks.teamSlides));
    assert.ok(Array.isArray(body.usage.items));

    // The seeded team building blocks + usage round-trip.
    const teamCollectionNames = body.buildingBlocks.collections.team.map((c) => c.name);
    assert.ok(teamCollectionNames.includes('Onboarding kit'));
    const teamSlideNames = body.buildingBlocks.teamSlides.map((s) => s.name);
    assert.ok(teamSlideNames.includes('Shared title slide'));
    const usedKeys = body.usage.items.map((u) => `${u.itemType}:${u.itemId}`);
    assert.ok(usedKeys.includes('slide:used-1'));
  });
});
