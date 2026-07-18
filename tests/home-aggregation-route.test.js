/**
 * Tests for the `/api/home` aggregation route.
 *
 * Two concerns:
 * 1. Filter-doorgifte — `buildActivityOpts` threads the activity filter surface
 *    (limit / eventTypes[] / actorEmail / since / until / presentationId) into
 *    the storage opts, and excludes the current user's own events by default
 *    (with an explicit `excludeSelf=false` opt-out).
 * 2. Round-trip — `handleHome` assembles collections, team slides and the
 *    user's usage set into the shape the Home view's loaders consume, against
 *    an initialized file adapter (default OSS mode).
 *
 * Run with: node --test tests/home-aggregation-route.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = path.join(os.tmpdir(), `deckyard-home-${crypto.randomUUID()}`);
process.env.DATA_DIR = path.join(repoRoot, 'data');

const { initializeStorage, closeStorage } = await import(
  '../server/storage/adapters/index.js'
);
const { handleHome, buildActivityOpts } = await import(
  '../server/routes/api/home.js'
);
const { createTeamLibraryItem } = await import('../server/storage/slide-library.js');
const { createTeamCollection } = await import('../server/storage/collections.js');
const { recordSlideLibraryUsage } = await import(
  '../server/storage/slide-library-usage.js'
);

const USER = 'user@example.com';

/** Minimal response stub recording status + parsed JSON body. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

function callHome({ user = { email: USER }, search = '' } = {}) {
  const res = makeRes();
  const url = new URL(`http://localhost/api/home${search}`);
  return handleHome({ repoRoot, req: { method: 'GET' }, res, url, authedUser: user })
    .then((handled) => ({ handled, res }));
}

describe('buildActivityOpts (filter-doorgifte)', () => {
  it('defaults to a 20-item feed excluding the current user', () => {
    const opts = buildActivityOpts(new URLSearchParams(''), USER);
    assert.strictEqual(opts.limit, 20);
    assert.strictEqual(opts.excludeActorEmail, USER);
  });

  it('threads every activity filter into the storage opts', () => {
    const params = new URLSearchParams(
      'limit=5&eventTypes[]=comment.created&eventTypes[]=presentation.updated' +
        '&actorEmail=her@example.com&since=2026-01-01&until=2026-02-01' +
        '&presentationId=deck-1'
    );
    const opts = buildActivityOpts(params, USER);
    assert.strictEqual(opts.limit, 5);
    assert.deepStrictEqual(opts.eventTypes, ['comment.created', 'presentation.updated']);
    assert.strictEqual(opts.actorEmail, 'her@example.com');
    assert.strictEqual(opts.since, '2026-01-01');
    assert.strictEqual(opts.until, '2026-02-01');
    assert.strictEqual(opts.presentationId, 'deck-1');
  });

  it('opts out of self-exclusion with excludeSelf=false', () => {
    const opts = buildActivityOpts(new URLSearchParams('excludeSelf=false'), USER);
    assert.ok(!('excludeActorEmail' in opts), 'own events are not excluded');
  });
});

describe('handleHome (round-trip)', () => {
  before(async () => {
    await fs.mkdir(process.env.DATA_DIR, { recursive: true });
    await initializeStorage(repoRoot);

    await createTeamLibraryItem(
      repoRoot,
      { name: 'Shared title slide', slideType: 'title', content: {} },
      { actorEmail: USER }
    );
    await createTeamCollection(
      repoRoot,
      { name: 'Onboarding kit', slideIds: [] },
      { actorEmail: USER }
    );
    await recordSlideLibraryUsage(repoRoot, USER, [{ type: 'slide', id: 'used-1' }]);
  });

  after(async () => {
    await closeStorage();
    await fs.rm(repoRoot, { recursive: true, force: true });
    delete process.env.DATA_DIR;
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
