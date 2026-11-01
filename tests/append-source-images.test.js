/**
 * The append routes hold no uncopied image either (DY-793).
 *
 * `append_slides`, public `/ai/append-slides` and the editor's route generate
 * outside `generateSlides`, so they ran past its source-image step. Pinned here
 * against the database double, with the model and the image hosts as
 * `globalThis.fetch`, no network:
 *
 *   - each route copies what a slide chose and returns or stores no remote URL;
 *   - a dead source leaves an empty field, and each route says so;
 *   - a key without `write` fetches nothing;
 *   - the slide's review and its warnings travel together;
 *   - a revision keeps the images of the prior batch, and only those.
 *
 * Run with: node --test tests/append-source-images.test.js
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
const FIRST = 'https://93.184.216.34/first.png';
const SECOND = 'https://93.184.216.34/second.jpg';
const UNCHOSEN = 'https://93.184.216.34/unchosen.webp';
const STRAY = 'https://93.184.216.35/invented.png';
const COPIED = 'https://bucket.s3.test/uploads/earlier-copy.png';
const SOURCE = `Our partners.\n![The team](${FIRST})\nSee ${SECOND}.\n<img src="${UNCHOSEN}" alt="Spare">`;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { handleAi } = await import('../server/routes/public-api/v1/ai.js');
const { handleAiAppendSlides } =
  await import('../server/routes/api/ai/append-slides.js');
const { createPresentation } =
  await import('../server/services/presentations.js');

let db;
let brandThemeId;
let deckId;
let tmpRoot;

test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dy793-media-'));
  await initializeMediaProvider(tmpRoot);
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(async () => {
  __setTestDb(null);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function scope() {
  return createStorageScope(AUTHED, { repoRoot: process.cwd() });
}

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
  const deck = await createPresentation(
    scope(),
    { actor: AUTHED },
    { title: 'Existing', theme: brandThemeId, lang: 'en' },
  );
  deckId = deck.id;
}

/** A gallery: two references, one stray URL and a referenced background. */
function galleryAnswer(extraImages = []) {
  return {
    rationale: 'Added the partners.',
    slides: [
      {
        type: 'gallery-slide',
        content: {
          title: 'Our partners',
          slideBgImage: 'source-image:2',
          images: [
            { src: 'source-image:1', alt: 'The team' },
            { src: STRAY, alt: 'Invented' },
            ...extraImages,
          ],
        },
        why: 'A gallery shows the partners.',
      },
    ],
  };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function stubNetwork(t, { dead = [], answer = galleryAnswer() } = {}) {
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
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return seen;
}

function gallery(slides) {
  const slide = slides.find((s) => s.type === 'gallery-slide');
  assert.ok(slide, 'the gallery slide is there');
  return slide;
}

/** MCP: the slide as stored, and the warnings as answered. */
async function callMcp(permissions) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const answer = await server.tools.get('append_slides').handler(
    { presentationId: deckId, content: SOURCE },
    {
      ownerEmail: OWNER,
      organizationId: ORG,
      apiKey: { id: 'key-1', tier: 'free', permissions },
    },
  );
  const stored = db.__tables.presentations.find((d) => d.id === deckId);
  return { slide: gallery(stored.slides), warnings: answer.warnings };
}

/** Public v1: the slide and the warnings as answered; it stores nothing. */
async function callV1(permissions) {
  const req = Readable.from([
    Buffer.from(JSON.stringify({ raw: SOURCE, lang: 'en' })),
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
    url: new URL('http://localhost/api/v1/ai/append-slides'),
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
  return { slide: gallery(res.body.slides), warnings: res.body.warnings };
}

/** The editor: the slides as answered, warnings on each slide. */
async function callEditor(body = {}) {
  const res = createMockRes();
  await handleAiAppendSlides({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: createMockReq({
      method: 'POST',
      body: { raw: SOURCE, lang: 'en', ...body },
    }),
    res,
    authedUser: AUTHED,
  });
  const answer = JSON.parse(res.body);
  const slide = gallery(answer.slides);
  return {
    slide,
    warnings: (slide._aiWarnings || []).map((message) => ({ message })),
  };
}

function assertCopied({ content }) {
  assert.match(content.images[0].src, /^\/uploads\//);
  assert.match(content.slideBgImage, /^\/uploads\//);
  assert.equal(content.images[1].src, '', 'the stray URL is gone');
  assert.doesNotMatch(JSON.stringify(content), /93\.184\.216/);
}

function assertOfferedAndFetchedOnlyChosen(seen) {
  assert.deepEqual([...seen.fetched].sort(), [FIRST, SECOND].sort());
  const prompts = seen.prompts.join('\n');
  assert.match(prompts, /\[IMAGE 1: The team\]/);
  assert.match(prompts, /source-image:n/);
  assert.doesNotMatch(prompts, /first\.png/, 'the model never sees the URL');
}

const WITH_WRITE = [
  ['MCP', () => callMcp(['ai', 'write'])],
  ['public v1', () => callV1(['ai', 'write'])],
  ['the editor', () => callEditor()],
];

for (const [route, call] of WITH_WRITE) {
  test(`${route} copies what a slide chose and holds no remote URL`, async (t) => {
    await setup();
    const seen = stubNetwork(t);
    const { slide, warnings } = await call();
    assertCopied(slide);
    assertOfferedAndFetchedOnlyChosen(seen);
    assert.ok(
      warnings.some(({ message }) => /was not copied/.test(message)),
      JSON.stringify(warnings),
    );
  });

  test(`${route}: a dead source is an empty field and a warning`, async (t) => {
    await setup();
    stubNetwork(t, { dead: [FIRST] });
    const { slide, warnings } = await call();
    assert.equal(slide.content.images[0].src, '');
    assert.match(slide.content.slideBgImage, /^\/uploads\//);
    assert.ok(
      warnings.some(({ message }) => /could not be uploaded/.test(message)),
      JSON.stringify(warnings),
    );
  });
}

for (const [route, call] of [
  ['MCP', callMcp],
  ['public v1', callV1],
]) {
  test(`${route} with only ai fetches nothing`, async (t) => {
    await setup();
    const seen = stubNetwork(t);
    const { slide, warnings } = await call(['ai']);
    assert.deepEqual(seen.fetched, []);
    assert.match(
      seen.prompts.join('\n'),
      /first\.png/,
      'the text is untouched',
    );
    assert.ok(!slide.content.slideBgImage, 'no background');
    assert.deepEqual(
      slide.content.images.map((image) => image.src || ''),
      ['', ''],
    );
    assert.ok(warnings.length >= 3, JSON.stringify(warnings));
  });
}

test('MCP: warning indexes count the new slides', async (t) => {
  await setup();
  stubNetwork(t);
  const { warnings } = await callMcp(['ai', 'write']);
  assert.ok(warnings.length);
  assert.ok(warnings.every(({ index }) => index === 0));
});

test('an appended slide carries its review beside its warnings', async (t) => {
  await setup();
  stubNetwork(t);
  const { slide } = await callEditor();
  assert.equal(slide._aiReasoning, 'A gallery shows the partners.');
  assert.ok(slide._aiWarnings.length);
});

test('a revision keeps the prior batch images and empties a new URL', async (t) => {
  await setup();
  // `COPIED` stands for a copy on a provider with absolute URLs, or the
  // author's own pick: it came in with the prior batch and comes back.
  const seen = stubNetwork(t, {
    answer: galleryAnswer([{ src: COPIED, alt: 'Copy' }]),
  });
  const { slide } = await callEditor({
    priorSlides: [
      {
        type: 'gallery-slide',
        content: { images: [{ src: COPIED, alt: 'Copy' }] },
      },
    ],
    feedback: 'Shorter title.',
  });
  assert.equal(slide.content.images[2].src, COPIED, 'the prior image stays');
  assert.equal(slide.content.images[1].src, '', 'the new URL does not');
  assert.ok(!seen.fetched.includes(COPIED), 'a kept image is not fetched');
});

test('outside a revision a URL from the same host is emptied', async (t) => {
  await setup();
  stubNetwork(t, { answer: galleryAnswer([{ src: COPIED, alt: 'Copy' }]) });
  const { slide } = await callEditor();
  assert.equal(slide.content.images[2].src, '');
});
