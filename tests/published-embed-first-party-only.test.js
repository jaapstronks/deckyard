/**
 * A published deck and an embed talk to this server and nobody else (D56).
 *
 * External analytics used to be injected into `/p/…` and `/embed/…` too, gated
 * by `ANALYTICS_INCLUDE_EMBEDS` / `ANALYTICS_INCLUDE_EXPORTS`. The document CSP
 * those pages carry has blocked every such tag since it landed (#912), and the
 * decision was that the block is the wanted end state, not a bug: a published
 * deck is where strangers land, there is no consent seam left on it, and the
 * first-party `/api/track/*` tracker already measures that surface with a
 * retention and an erasure story. The normative rule lives in
 * `docs/reference/no-third-party-origins.md` § *A published deck and an embed
 * are first-party-only*; this file is that rule as assertions.
 *
 * The load-bearing test is the first one: it configures **every** external
 * provider, loudly enough that the app shell would emit five tags, drives the
 * real published and embed routes, and reads the documents they write. Not one
 * external script may appear. It fails the day the injection comes back,
 * whatever route or helper reintroduces it.
 *
 * House shape: the exported handler called directly with a req/res double over
 * `tests/helpers/fake-db.js` (see tests/viewer-email-routes-contract.test.js).
 *
 * Run with: node --test tests/published-embed-first-party-only.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handlePublishedPage } =
  await import('../server/routes/static/published.js');
const { handleEmbed } = await import('../server/routes/static/embed.js');
const { analyticsHeadHtml } = await import('../server/analytics/head.js');

const PUBLISH_ID = 'abcd1234';
const SLUG = 'my-deck';

/**
 * Every provider at once, each pointing at an origin that would be
 * unmistakable in the output.
 */
const LOUD_ANALYTICS = {
  ANALYTICS_HEAD_HTML:
    '<script defer src="https://tag.example.net/t.js"></script>',
  GTM_CONTAINER_ID: 'GTM-ABCDEF',
  MATOMO_URL: 'https://stats.example.com',
  MATOMO_SITE_ID: '7',
  PLAUSIBLE_DOMAIN: 'decks.example.com',
  UMAMI_WEBSITE_ID: '11111111-2222-3333-4444-555555555555',
  GA4_MEASUREMENT_ID: 'G-ABCDEF1234',
  // The two gates D56 removed. Set to their most permissive value: if either
  // still governs anything, this is the run that would show it.
  ANALYTICS_INCLUDE_EMBEDS: 'true',
  ANALYTICS_INCLUDE_EXPORTS: 'true',
};

const saved = {};

test.before(async () => {
  for (const [k, v] of Object.entries(LOUD_ANALYTICS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  for (const k of Object.keys(LOUD_ANALYTICS)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetStorageForTests();
  __setTestDb(null);
});

function seed() {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      presentations: [
        {
          id: 'deck-pub',
          organization_id: ORG,
          title: 'Published deck',
          owner_email: 'owner@example.com',
          created_by: 'owner@example.com',
          updated_by: 'owner@example.com',
          visibility: 'organization',
          theme: 'default',
          lang: 'nl',
          revision: 1,
          is_view_only: false,
          slides: [{ id: 's1', type: 'content-slide', content: {} }],
          i18n: null,
          settings: {},
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
      published_presentations: [
        {
          id: PUBLISH_ID,
          organization_id: ORG,
          presentation_id: 'deck-pub',
          title: 'Published deck',
          slug: SLUG,
          og_image_url: null,
          created_at: '2026-02-01T00:00:00.000Z',
          modified_at: '2026-02-01T00:00:00.000Z',
        },
      ],
      app_settings: [{ id: 'singleton', settings: {} }],
    }),
  );
}

/** A response double capturing status/headers/body. */
function makeRes() {
  return {
    statusCode: null,
    headers: {},
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
      return this;
    },
  };
}

/** Drive a viewer handler and hand back the document it wrote. */
async function documentFrom(handle, pathAndQuery) {
  const res = makeRes();
  const handled = await handle({
    repoRoot: process.cwd(),
    req: { method: 'GET', headers: { host: 'decks.example.test' } },
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
  });
  assert.equal(handled, true, `${pathAndQuery} was handled`);
  assert.equal(res.statusCode, 200, `${pathAndQuery} answered 200`);
  return String(res.rawBody || '');
}

/** Every absolute `src` on a `<script>` tag in a document. */
function externalScriptSrcs(html) {
  return [
    ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi),
  ]
    .map((m) => m[1])
    .filter((src) => /^(https?:)?\/\//i.test(src));
}

test('neither served surface carries an external script, however loud the analytics config', async () => {
  // The configuration is real: the shell would emit tags for it.
  assert.ok(
    externalScriptSrcs(analyticsHeadHtml()).length > 0,
    'the fixture must actually configure external providers, or this test ' +
      'passes for the wrong reason',
  );

  seed();
  for (const [surface, handle, path] of [
    ['published', handlePublishedPage, `/p/${PUBLISH_ID}-${SLUG}`],
    ['embed', handleEmbed, `/embed/${PUBLISH_ID}-${SLUG}`],
  ]) {
    const html = await documentFrom(handle, path);
    assert.deepEqual(
      externalScriptSrcs(html),
      [],
      `${surface} must load script from this server only`,
    );
    // The known offenders by name, so a failure reads as what it is.
    for (const host of [
      'googletagmanager.com',
      'plausible.io',
      'umami.is',
      'stats.example.com',
      'tag.example.net',
    ]) {
      assert.ok(!html.includes(host), `${surface} must not name ${host}`);
    }
  }
});

test('the first-party tracker is still there — this is a strip, not a blackout', async () => {
  seed();
  const html = await documentFrom(
    handlePublishedPage,
    `/p/${PUBLISH_ID}-${SLUG}`,
  );
  assert.match(
    html,
    /\/api\/track\//,
    'the inline first-party tracker keeps measuring published views',
  );
});

test('the two routes no longer reach for the analytics head at all', async () => {
  const { readFileSync } = await import('node:fs');
  for (const rel of [
    'server/routes/static/published.js',
    'server/routes/static/embed.js',
  ]) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.ok(
      !src.includes('analytics/head.js') && !src.includes('analyticsHeadHtml'),
      `${rel} must not import the third-party analytics head`,
    );
  }
});
