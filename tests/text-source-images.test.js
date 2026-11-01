/**
 * Image URLs in source text become copied images or nothing (DY-791).
 *
 * A bot deck kept its ImageKit URLs and failed at publishing, with no way to
 * step in before the save. Now the text routes hand their URLs to the
 * `source-image` pipeline. Pinned here, against the database double with the
 * model and the image hosts as `globalThis.fetch`, no network:
 *
 *   - MCP, public v1 and the wizard store copied images, in `items` entries and
 *     in the global background alike, and never a remote URL;
 *   - a remote URL the model writes itself is emptied, with a warning;
 *   - a dead source leaves an empty field, and MCP and v1 report it;
 *   - a key without `write` fetches nothing, as does an installation without
 *     uploads;
 *   - only an image a slide chose is fetched, once.
 *
 * Run with: node --test tests/text-source-images.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
delete process.env.DEMO_MODE;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('IMAGEKIT_')) delete process.env[key];
}
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

// Literal public addresses: the SSRF guard needs no DNS for these.
const FIRST = 'https://93.184.216.34/first.png?tr=w-800';
const SECOND = 'https://93.184.216.34/second.jpg';
const UNCHOSEN = 'https://93.184.216.34/unchosen.webp';
const STRAY = 'https://93.184.216.35/invented.png';
const SOURCE = `Our partners.\n![The team](${FIRST})\nSee ${SECOND}.\n<img src="${UNCHOSEN}" alt="Spare">`;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handleAi } = await import('../server/routes/public-api/v1/ai.js');
const { handleAiWizard } = await import('../server/routes/api/ai/wizard.js');
const { offerTextSourceImages, MAX_TEXT_SOURCE_IMAGES } =
  await import('../server/utils/ai/text-source-images.js');
const { resolveSourceImages } =
  await import('../server/utils/ai/source-images.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');

let db;
let brandThemeId;
let tmpRoot;

test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dy791-media-'));
  await initializeMediaProvider(tmpRoot);
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(async () => {
  __setTestDb(null);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function setup() {
  const brand = await brandSeedRow();
  brandThemeId = brand.id;
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
    themes: [brand],
    presentations: [],
    api_usage_daily: [],
  });
  __setTestDb(db);
}

/** A gallery: two references, one stray URL and a referenced background. */
const ANSWER = {
  title: 'Partners',
  subtitle: 'Who we build with',
  summary: 'Our partners',
  rationale: 'test',
  sections: [
    { heading: 'Partners', keyPoints: ['Our partners'], excerpt: 'partners' },
  ],
  slides: [
    {
      intent: 'content',
      section: 0,
      roughContent: 'Our partners',
      type: 'gallery-slide',
      content: {
        title: 'Our partners',
        slideBgImage: 'source-image:2',
        images: [
          { src: 'source-image:1', alt: 'The team' },
          { src: STRAY, alt: 'Invented' },
        ],
      },
      presenterNotes: 'Name them.',
    },
  ],
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The model answers {@link ANSWER}; an image host serves a PNG, or 404 for a
 * URL in `dead`.
 * @returns {{ prompts: string[], fetched: string[] }}
 */
function stubNetwork(t, { dead = [] } = {}) {
  const saved = globalThis.fetch;
  const seen = { prompts: [], fetched: [] };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith('https://93.184.216.')) {
      seen.fetched.push(target);
      return dead.includes(target)
        ? new Response('gone', { status: 404 })
        : new Response(PNG, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
    }
    seen.prompts.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(ANSWER) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return seen;
}

function storedSlide() {
  const decks = db.__tables.presentations;
  assert.equal(decks.length, 1, 'one deck stored');
  const slide = decks[0].slides.find((s) => s.type === 'gallery-slide');
  assert.ok(slide, 'the gallery slide is stored');
  return slide;
}

function callMcp(permissions) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools.get('create_presentation').handler(
    { content: SOURCE, lang: 'en', theme: brandThemeId },
    {
      ownerEmail: OWNER,
      organizationId: ORG,
      apiKey: { id: 'key-1', tier: 'free', permissions },
    },
  );
}

async function callV1(permissions) {
  const req = Readable.from([
    Buffer.from(
      JSON.stringify({ raw: SOURCE, lang: 'en', theme: brandThemeId }),
    ),
  ]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = {
    body: null,
    setHeader() {},
    writeHead() {},
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
    on() {},
    once() {},
    off() {},
    removeListener() {},
  };
  await handleAi({
    req,
    res,
    url: new URL('http://localhost/api/v1/ai/wizard'),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      name: 'Bot',
      ownerEmail: OWNER,
      permissions,
      organizationId: ORG,
    },
    authedUser: AUTHED,
  });
  return res.body;
}

function assertCopied(slide) {
  assert.match(slide.content.images[0].src, /^\/uploads\//);
  assert.match(slide.content.slideBgImage, /^\/uploads\//);
  assert.equal(slide.content.images[1].src, '', 'the stray URL is gone');
  assert.doesNotMatch(JSON.stringify(slide.content), /93\.184\.216/);
}

function assertFetchedOnlyChosen(seen) {
  assert.deepEqual([...seen.fetched].sort(), [FIRST, SECOND].sort());
  const prompts = seen.prompts.join('\n');
  assert.match(prompts, /\[IMAGE 1: The team\]/);
  assert.doesNotMatch(prompts, /first\.png/, 'the model never sees the URL');
}

test('MCP with write copies what a slide chose and stores no remote URL', async (t) => {
  await setup();
  const seen = stubNetwork(t);
  const result = await callMcp(['ai', 'write']);
  assertCopied(storedSlide());
  assertFetchedOnlyChosen(seen);
  assert.ok(
    result.warnings.some(
      ({ index, message }) => index === 1 && /remote image/.test(message),
    ),
    JSON.stringify(result.warnings),
  );
});

test('public v1 with write copies too, and returns the warnings', async (t) => {
  await setup();
  const seen = stubNetwork(t);
  const body = await callV1(['ai', 'write']);
  assertCopied(storedSlide());
  assertFetchedOnlyChosen(seen);
  assert.ok(body.warnings.some(({ message }) => /remote image/.test(message)));
});

test('the wizard copies for a signed-in user', async (t) => {
  await setup();
  const seen = stubNetwork(t);
  const res = createMockRes();
  await handleAiWizard({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(AUTHED, { repoRoot: process.cwd() }),
    req: createMockReq({
      method: 'POST',
      body: { raw: SOURCE, lang: 'en', theme: brandThemeId },
    }),
    res,
    authedUser: AUTHED,
  });
  assertCopied(storedSlide());
  assertFetchedOnlyChosen(seen);
});

for (const [route, call] of [
  ['MCP', callMcp],
  ['public v1', callV1],
]) {
  test(`${route} with only ai fetches nothing`, async (t) => {
    await setup();
    const seen = stubNetwork(t);
    const answer = await call(['ai']);
    assert.deepEqual(seen.fetched, []);
    assert.match(
      seen.prompts.join('\n'),
      /first\.png/,
      'the text is untouched',
    );
    const { content } = storedSlide();
    assert.ok(!content.slideBgImage, 'no background');
    assert.deepEqual(
      content.images.map((image) => image.src || ''),
      ['', ''],
    );
    assert.ok(answer.warnings.length >= 3, JSON.stringify(answer.warnings));
  });

  test(`${route}: a dead source is an empty field and a warning`, async (t) => {
    await setup();
    stubNetwork(t, { dead: [FIRST] });
    const answer = await call(['ai', 'write']);
    const { content } = storedSlide();
    assert.equal(content.images[0].src, '');
    assert.match(content.slideBgImage, /^\/uploads\//);
    assert.ok(
      answer.warnings.some(({ message }) =>
        /could not be uploaded/.test(message),
      ),
      JSON.stringify(answer.warnings),
    );
  });
}

test('a URL in a private range is refused, not fetched', async (t) => {
  await setup();
  const seen = stubNetwork(t);
  const { sourceImages } = offerTextSourceImages(
    '![Inside](http://169.254.169.254/latest/meta-data.png)',
    { mayUpload: true },
  );
  await assert.rejects(sourceImages[0].upload(), /Blocked or failed/);
  assert.deepEqual(seen.fetched, []);
});

test('offering fetches nothing and reads the three forms', () => {
  const { text, sourceImages } = offerTextSourceImages(SOURCE, {
    mayUpload: true,
  });
  assert.deepEqual(
    sourceImages.map(({ n, caption }) => [n, caption]),
    [
      [1, 'The team'],
      [2, ''],
      [3, 'Spare'],
    ],
  );
  assert.equal(
    text,
    'Our partners.\n[IMAGE 1: The team]\nSee [IMAGE 2: no caption].\n[IMAGE 3: Spare]',
  );
});

test('a link to a page stays a link, a repeat stays one image', () => {
  const raw = `https://example.com/about and ${SECOND} and ${SECOND}`;
  const { text, sourceImages } = offerTextSourceImages(raw, {
    mayUpload: true,
  });
  assert.equal(sourceImages.length, 1);
  assert.equal(
    text,
    'https://example.com/about and [IMAGE 1: no caption] and [IMAGE 1: no caption]',
  );
});

test('a source offers a bounded number of images', () => {
  const urls = Array.from(
    { length: MAX_TEXT_SOURCE_IMAGES + 3 },
    (_, i) => `https://example.com/${i}.png`,
  );
  const { text, sourceImages } = offerTextSourceImages(urls.join(' '), {
    mayUpload: true,
  });
  assert.equal(sourceImages.length, MAX_TEXT_SOURCE_IMAGES);
  assert.ok(text.endsWith(urls.at(-1)), 'past the bound it stays a plain URL');
});

test('no right or no uploads: the text stays and nothing is offered', (t) => {
  assert.deepEqual(offerTextSourceImages(SOURCE, { mayUpload: false }), {
    text: SOURCE,
    sourceImages: [],
  });
  const saved = process.env.UPLOADS_ENABLED;
  process.env.UPLOADS_ENABLED = 'false';
  t.after(() => {
    if (saved === undefined) delete process.env.UPLOADS_ENABLED;
    else process.env.UPLOADS_ENABLED = saved;
  });
  assert.deepEqual(offerTextSourceImages(SOURCE, { mayUpload: true }), {
    text: SOURCE,
    sourceImages: [],
  });
});

test('the resolver leaves a local reference alone and empties a remote one', async () => {
  const slides = [
    {
      type: 'image-slide',
      content: { image: '/uploads/own.png', slideBgImage: '//cdn.test/x.png' },
    },
  ];
  await resolveSourceImages(slides, [], { slideTypes: SLIDE_TYPES });
  assert.equal(slides[0].content.image, '/uploads/own.png');
  assert.equal(slides[0].content.slideBgImage, '');
  assert.equal(slides[0]._aiWarnings.length, 1);
});
