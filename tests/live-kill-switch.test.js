/**
 * The live cluster switch (`LIVE_ENABLED=false`) reaches every live surface on
 * the server (B524, D258, D260, D261).
 *
 * With the cluster off, the installation answers as if it never had live
 * presenting:
 *
 *  - the six mounts (follow, the follow-code resolve, the session audience in
 *    front of the login gate; live sessions, questions and the follow-code
 *    mint behind it) are skipped by `dispatchMounts`, so `handleApi` reaches
 *    its 404, and the static chain does not mount `/go`;
 *  - the app shell is not served for `/follow/:id`, `/notes/:session` and
 *    `/notes-join/:session`;
 *  - the five types that declare `feature: 'live'` count as org-disabled for
 *    the AI catalogue and `get_slide_types`, while an existing slide renders
 *    exactly as it does with the cluster on: its static form;
 *  - the live-session sweep keeps running and the boot line counts the
 *    sessions still stored.
 *
 * With it on, nothing changes: the existing follow and live tests run with the
 * default. The client half (no entry) is in
 * `tests/feature-entries-follow-flags.test.js`.
 *
 * Run with: node --test tests/live-kill-switch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.AUTH_SECRET = ['deckyard', 'test', 'live-killswitch']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
delete process.env.LIVE_ENABLED;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { dispatchMounts } = await import('../server/utils/router.js');
const { PUBLIC_MOUNTS, MOUNTS } = await import('../server/routes/api/index.js');
const { STATIC_MOUNTS } = await import('../server/routes/static/index.js');
const { getFeatureFlags, isFeatureEnabled } =
  await import('../server/config/flags-snapshot.js');
const { handleAppRoutes } =
  await import('../server/routes/static/app-shell.js');
const { loadDisabledSlideTypes } =
  await import('../server/utils/org-slide-types.js');
const { SLIDE_TYPES, renderSlideHtml } =
  await import('../shared/slide-types.js');
const { clusterOffSlideTypes, isInsertableSlideType } =
  await import('../shared/slide-types/policy.js');
const { filterForShareViewer } =
  await import('../server/utils/public-output.js');

test.afterEach(() => {
  delete process.env.LIVE_ENABLED;
});

/** A response double capturing status/headers/body. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
    rawBody: null,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.rawBody = payload ?? null;
      return this;
    },
  };
}

function ctx(method, pathname) {
  return {
    req: { method, headers: {}, on() {}, once() {} },
    res: makeRes(),
    url: new URL(`http://localhost${pathname}`),
    authedUser: { id: 'u-1', email: 'owner@example.com', role: 'admin' },
    storageScope: null,
    repoRoot: process.cwd(),
    clientDir: process.cwd(),
  };
}

test('the snapshot carries enableLive, default on', () => {
  assert.equal(getFeatureFlags().enableLive, true);
  process.env.LIVE_ENABLED = 'false';
  assert.equal(getFeatureFlags().enableLive, false);
  assert.equal(isFeatureEnabled('live'), false);
});

const P = '123e4567-e89b-42d3-a456-426614174000';
const S = 'sess-1';
const PATHS = [
  ['PUBLIC_MOUNTS', 'GET', `/api/follow/${P}/state`],
  ['PUBLIC_MOUNTS', 'POST', `/api/follow/${P}/interactions/s1/vote`],
  ['PUBLIC_MOUNTS', 'GET', '/api/follow-codes/ABCD'],
  ['PUBLIC_MOUNTS', 'GET', `/api/live-sessions/${S}/state`],
  ['PUBLIC_MOUNTS', 'GET', `/api/live-sessions/${S}/notes/s1`],
  ['MOUNTS', 'POST', '/api/live-sessions'],
  ['MOUNTS', 'POST', `/api/live-sessions/${S}/control/enable`],
  ['MOUNTS', 'GET', `/api/moderate/${P}/questions/capabilities`],
  ['MOUNTS', 'POST', '/api/follow-codes'],
];

for (const [table, method, path] of PATHS) {
  test(`${method} ${path}: no mount takes it with LIVE_ENABLED=false`, async () => {
    process.env.LIVE_ENABLED = 'false';
    const mounts = table === 'PUBLIC_MOUNTS' ? PUBLIC_MOUNTS : MOUNTS;
    const c = ctx(method, path);
    assert.equal(await dispatchMounts(mounts, c), false);
    assert.equal(c.res.statusCode, null, 'nothing was written');
  });
}

test('the six live mounts, and only they, carry the feature', () => {
  const live = [...PUBLIC_MOUNTS, ...MOUNTS].filter(
    (m) => m.feature === 'live',
  );
  assert.equal(live.length, 6);
});

test('/go is not mounted with the cluster off', async () => {
  const go = STATIC_MOUNTS.filter((m) => m.feature === 'live');
  assert.equal(go.length, 1, 'one static live mount');
  process.env.LIVE_ENABLED = 'false';
  const off = ctx('GET', '/go');
  assert.equal(await dispatchMounts(go, off), false);
  assert.equal(off.res.statusCode, null);
  assert.equal(await handleAppRoutes(ctx('GET', '/go')), false);
});

test('the app shell is not served for the audience pages with the cluster off', async () => {
  for (const path of [`/follow/${P}`, `/notes/${S}`, `/notes-join/${S}`]) {
    process.env.LIVE_ENABLED = 'false';
    const c = ctx('GET', path);
    assert.equal(await handleAppRoutes(c), false, `${path} not served`);
  }
});

// ------------------------------------------------------------ slide types

const LIVE_TYPES = [
  'poll-slide',
  'likert-slide',
  'likert-slider-slide',
  'feedback-slide',
  'follow-invite-slide',
];

test('the five live types declare the cluster on their spec', () => {
  assert.deepEqual(
    Object.entries(SLIDE_TYPES)
      .filter(([, def]) => def.feature === 'live')
      .map(([type]) => type)
      .sort(),
    [...LIVE_TYPES].sort(),
  );
});

test('clusterOffSlideTypes: only types whose declared cluster is off', () => {
  const types = {
    a: { feature: 'live' },
    b: { feature: 'ai' },
    c: {},
    d: null,
  };
  assert.deepEqual(
    clusterOffSlideTypes(types, (key) => key !== 'live'),
    ['a'],
  );
  assert.deepEqual(
    clusterOffSlideTypes(types, () => true),
    [],
  );
  assert.deepEqual(
    clusterOffSlideTypes(null, () => false),
    [],
  );
});

test('the catalogue counts the live types as org-disabled only with the cluster off', async (t) => {
  __setTestDb(
    createFakeDb({
      organizations: [
        {
          id: ORG,
          name: 'Default',
          slug: 'default',
          settings: { disabledSlideTypes: ['quote-slide'] },
        },
      ],
    }),
  );
  t.after(() => __setTestDb(null));

  const on = await loadDisabledSlideTypes({ organizationId: ORG });
  for (const type of LIVE_TYPES) assert.ok(!on.includes(type), type);

  process.env.LIVE_ENABLED = 'false';
  const off = await loadDisabledSlideTypes({ organizationId: ORG });
  for (const type of LIVE_TYPES) assert.ok(off.includes(type), type);
  assert.equal(
    off.includes('quote-slide'),
    on.includes('quote-slide'),
    "the organization's own curation is kept as it was",
  );
  assert.ok(
    !isInsertableSlideType({
      type: 'poll-slide',
      def: SLIDE_TYPES['poll-slide'],
      disabledSlideTypes: off,
    }),
    'the picker policy refuses it',
  );
});

for (const type of LIVE_TYPES) {
  test(`${type}: an existing slide renders its static form with the cluster off`, () => {
    const slide = {
      id: 's1',
      type,
      content: structuredClone(SLIDE_TYPES[type].defaults || {}),
    };
    // Editor, present, export and thumbnail all render through this one
    // function; none of them hands it session state without a session.
    for (const mode of ['edit', 'present', 'export', 'thumb']) {
      const withLive = renderSlideHtml(slide, { mode, lang: 'en' });
      process.env.LIVE_ENABLED = 'false';
      const without = renderSlideHtml(slide, { mode, lang: 'en' });
      delete process.env.LIVE_ENABLED;
      assert.match(without, /class="slide /, `${mode}: a slide`);
      assert.equal(without, withLive, `${mode}: the same markup`);
    }
  });
}

test('the anonymous share viewer gets no live-only slide with the cluster off', () => {
  // The viewer has no feature snapshot, so the server answers for it: with
  // live on the invite is served and its runtime draws the QR; with live off
  // the invite leaves the payload, like it leaves every published output.
  const pres = {
    id: 'p1',
    slides: [
      { id: 'a', type: 'title-slide', content: {} },
      { id: 'b', type: 'follow-invite-slide', content: {} },
      { id: 'c', type: 'poll-slide', content: {} },
    ],
  };
  const ids = (p) => p.slides.map((s) => s.id);
  assert.deepEqual(ids(filterForShareViewer(pres)), ['a', 'b', 'c']);
  process.env.LIVE_ENABLED = 'false';
  assert.deepEqual(
    ids(filterForShareViewer(pres)),
    ['a', 'c'],
    'the invite leaves, the poll stays in its static form',
  );
});

// ------------------------------------------------------------ boot

test('boot: the live-session sweep always runs; the boot line only with the cluster off (D261)', () => {
  const src = readFileSync(new URL('../server/server.js', import.meta.url), {
    encoding: 'utf8',
  });
  assert.match(src, /^\s*scheduleLiveSessionCleanup\(\),/m);
  assert.match(
    src,
    /if \(!isFeatureEnabled\('live'\)\) await warnLiveSessionsWhileOff\(\)/,
  );
});
