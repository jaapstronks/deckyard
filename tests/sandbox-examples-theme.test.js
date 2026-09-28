/**
 * B332 umbrella review: the sandbox example shelf hands the browser record
 * UUIDs, never seed slugs.
 *
 * The committed example decks name their theme by seed slug (`editorial`),
 * because a record UUID differs per installation. After the theme-record
 * cutover the browser loader and every write route accept only a UUID or
 * `default`, so the shelf served three examples that neither rendered a
 * thumbnail nor opened (400 `invalid` on `theme`). The slug is deployment
 * config and is resolved once, in `listSandboxExamples`; this drives the real
 * examples through the real `/api/sandbox/examples` and
 * `/api/presentations/import/json` routes against all six seeds.
 *
 * Run with: node --test tests/sandbox-examples-theme.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b332-sandbox']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'guest@example.com';
const SLUGS = [
  'amethyst',
  'brand',
  'corporate',
  'editorial',
  'midnight',
  'playful',
];
const SEEDS = await Promise.all(SLUGS.map(seedRow));
const idOf = (slug) => SEEDS.find((row) => row.slug === slug).id;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { getPresentation } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handleSandbox } = await import('../server/routes/api/sandbox.js');
const { listSandboxExamples } = await import('../server/sandbox/examples.js');

const savedSandbox = process.env.SANDBOX_MODE;

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
      themes: SEEDS,
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

/**
 * GET the shelf in sandbox mode. Sandbox mode is on for this call only: the
 * import below does not depend on it, and its per-guest quota query is raw SQL
 * the fake database does not run.
 */
async function getExamples() {
  const res = mockRes();
  process.env.SANDBOX_MODE = '1';
  try {
    await handleSandbox({
      repoRoot: process.cwd(),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL('http://test.local/api/sandbox/examples'),
      authedUser: sessionFor(OWNER, { isAdmin: false }),
    });
  } finally {
    if (savedSandbox === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = savedSandbox;
  }
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.examples;
}

async function importJson(body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  const res = mockRes();
  await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req: {
      method: 'POST',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    },
    res,
    url: new URL('http://test.local/api/presentations/import/json'),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  });
  return res;
}

/** The slug each committed example file names, read straight from disk. */
async function committedSlug(id) {
  const raw = await fs.readFile(
    path.join(process.cwd(), 'server', 'sandbox-examples', `${id}.json`),
    'utf8',
  );
  return JSON.parse(raw).theme;
}

test('every shipped example resolves to its seed UUID and imports as that seed', async () => {
  const examples = await getExamples();
  assert.deepEqual(
    examples.map((ex) => ex.id),
    ['meet-deckyard', 'acme-quarterly', 'ice-cream-cart'],
  );

  for (const ex of examples) {
    const expected = idOf(await committedSlug(ex.id));
    assert.equal(ex.theme, expected, `${ex.id}: preview theme`);
    assert.equal(ex.deck.theme, expected, `${ex.id}: deck.theme`);

    const res = await importJson({ deck: ex.deck, lang: ex.deck.lang });
    assert.ok(
      res.statusCode >= 200 && res.statusCode < 300,
      `${ex.id}: import ${res.statusCode} ${JSON.stringify(res.body)}`,
    );
    const stored = await getPresentation(testScope(process.cwd()), res.body.id);
    assert.equal(stored.theme, expected, `${ex.id}: stored theme`);
  }
});

test('every example is well-formed and declares the slide types it uses', async () => {
  for (const ex of await getExamples()) {
    assert.ok(ex.id && ex.title, `example ${ex.id} has an id and title`);
    assert.ok(ex.slideCount > 0, `example ${ex.id} has slides`);
    const slides = ex.deck?.slides;
    assert.ok(
      Array.isArray(slides) && slides.length === ex.slideCount,
      'slideCount matches deck',
    );
    // Every slide type used must be declared in the deck's slideTypes manifest,
    // or import/render can't resolve it.
    const manifest = ex.deck?.slideTypes || {};
    for (const s of slides) {
      assert.ok(
        manifest[s.type],
        `example ${ex.id} manifest declares "${s.type}"`,
      );
    }
  }
});

test('the committed slug never reaches the browser', async () => {
  const body = JSON.stringify(await getExamples());
  for (const slug of SLUGS)
    assert.ok(!body.includes(`"theme":"${slug}"`), `slug ${slug} leaked`);
});

test('an example whose slug names no seed is left off the shelf', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dy-examples-'));
  try {
    const dir = path.join(root, 'server', 'sandbox-examples');
    await fs.mkdir(dir, { recursive: true });
    const deck = { title: 'X', slides: [{ type: 'title-slide', content: {} }] };
    await fs.writeFile(
      path.join(dir, 'known.json'),
      JSON.stringify({ ...deck, theme: 'midnight' }),
    );
    await fs.writeFile(
      path.join(dir, 'unknown.json'),
      JSON.stringify({ ...deck, theme: 'no-such-seed' }),
    );
    await fs.writeFile(
      path.join(dir, 'uuid.json'),
      JSON.stringify({ ...deck, theme: idOf('midnight') }),
    );
    const examples = await listSandboxExamples(root);
    assert.deepEqual(
      examples.map((ex) => [ex.id, ex.theme]),
      [['known', idOf('midnight')]],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
