/**
 * A model's answer loads nothing in a viewer's browser that it wrote itself
 * (DY-811).
 *
 * An image field, a slide background, an embed and a video load without a
 * click. `fetch` answers here as a model that plants a URL of its own in each
 * of them, on every path that turns an answer into slide content. No path may
 * hand that URL back or store it; what the slides already held stays.
 *
 * The list of paths is closed against the transport: a new file that calls
 * the model fails the inventory test until it is filed below as a path that
 * writes slide content (with a test) or one that does not.
 *
 * Run with: node --test tests/ai-model-media.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
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
process.env.AI_ENABLED = 'true';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const AUTHED = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };

/** What the model plants: every one names this host. */
const HOST = 'beacon.example';
const IMAGE = `https://${HOST}/pixel.png?d=deck-text`;
const BACKGROUND = `//${HOST}/bg.png?d=deck-text`;
const EMBED = `https://${HOST}/frame?d=deck-text`;
const VIDEO = `https://${HOST}/watch?v=deck-text`;
/** What the deck already held: an absolute copy, an embed the author chose. */
const HELD_IMAGE = 'https://bucket.s3.test/uploads/held.png';
const HELD_EMBED = 'https://dashboard.example/board';

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
const { handleAiRefineSection } =
  await import('../server/routes/api/ai/refine-section.js');
const { handleAiIterate } = await import('../server/routes/api/ai/iterate.js');
const { handleAiConvertSlide } =
  await import('../server/routes/api/ai/convert-slide.js');
const { analyzePresentation } =
  await import('../server/utils/ai/analyze-presentation.js');
const { generateDeck } = await import('../server/utils/ai/generate-deck.js');
const { createPresentation } =
  await import('../server/services/presentations.js');
const { dropForeignMedia, leaveOut, loadsFromAnotherHost, mediaInSlides } =
  await import('../server/utils/ai/model-media.js');
const { SLIDE_TYPES, canonicalSlideType } =
  await import('../shared/slide-types/registry.js');

let db;
let deckId;
let tmpRoot;

test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dy811-media-'));
  await initializeMediaProvider(tmpRoot);
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(async () => {
  __setTestDb(null);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function scope() {
  return createStorageScope(AUTHED, { repoRoot: REPO_ROOT });
}

/** The deck every editing path works on: one slide with media of its own. */
const heldSlides = () => [
  {
    type: 'image-text-slide',
    content: { title: 'The barn', body: 'Built this year.', image: HELD_IMAGE },
  },
  { type: 'embed-slide', content: { title: 'Board', embedUrl: HELD_EMBED } },
  { type: 'content-slide', content: { title: 'Plan', body: 'Next year.' } },
];

async function setup() {
  const brand = await brandSeedRow();
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
    { title: 'Existing', theme: brand.id, lang: 'en', slides: heldSlides() },
  );
  deckId = deck.id;
  return deck;
}

const stored = () => db.__tables.presentations.find((d) => d.id === deckId);

/** `fetch` as a model that answers `answer(body)`; any other host is a leak. */
function stubModel(t, answer) {
  const saved = globalThis.fetch;
  t.mock.method(console, 'warn', () => {});
  globalThis.fetch = async (url, init) => {
    assert.ok(!String(url).includes(HOST), `the server fetched ${url}`);
    const content = JSON.stringify(answer(String(init?.body ?? '')));
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
}

/** The slides a hijacked model writes: its own URL in every field that loads. */
const planted = () => [
  {
    type: 'image-slide',
    content: { title: 'A view', image: IMAGE, alt: 'A view' },
    why: 'A picture.',
  },
  {
    type: 'gallery-slide',
    content: {
      title: 'Two views',
      slideBgImage: BACKGROUND,
      images: [
        { src: IMAGE, alt: 'One' },
        { src: `/\\${HOST}/slash.png`, alt: 'Two' },
      ],
    },
    why: 'A gallery.',
  },
  {
    type: 'embed-slide',
    content: { title: 'A page', embedUrl: EMBED },
    why: 'An embed.',
  },
  {
    type: 'video-slide',
    content: { title: 'A film', source: VIDEO },
    why: 'A video.',
  },
];

/** No value anywhere in `value` names the planted host. */
function assertNothingPlanted(value, where) {
  const json = JSON.stringify(value);
  assert.ok(json.length > 2, `${where}: nothing came back`);
  assert.ok(
    !json.includes(HOST),
    `${where} holds a URL the model wrote: ${json.slice(0, 1500)}`,
  );
}

/**
 * The image slides came back emptied, so the scrub had work to do; the embed
 * and the video are left out, because neither can be stored without its
 * source, and a slide that stays says so.
 */
function assertPlantedTypes(slides, where) {
  for (const type of ['image-slide', 'gallery-slide']) {
    assert.ok(
      slides.some((s) => s.type === type),
      `${where}: no ${type} came back, so this proves nothing`,
    );
  }
  const image = slides.find((s) => s.type === 'image-slide');
  assert.equal(image.content.image, '', `${where}: the image is emptied`);
  const added = slides.filter((s) => s.content?.title !== 'Board');
  for (const type of ['embed-slide', 'video-slide']) {
    assert.ok(
      !added.some((s) => s.type === type),
      `${where}: a ${type} without its source came back`,
    );
  }
}

/** A slide that stays carries the notice about the ones left out. */
function assertLeftOutNotice(slides, where) {
  assert.ok(
    slides.some((s) =>
      (s._aiWarnings || []).some((w) => /was left out/.test(w)),
    ),
    `${where}: nothing says a slide was left out`,
  );
}

async function callRoute(handler, body) {
  const res = createMockRes();
  await handler({
    repoRoot: REPO_ROOT,
    storageScope: scope(),
    req: createMockReq({ method: 'POST', body }),
    res,
    authedUser: AUTHED,
  });
  const answer = res.json();
  assert.equal(res.statusCode, 200, JSON.stringify(answer));
  return answer;
}

async function callTool(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools.get(name).handler(args, {
    ownerEmail: OWNER,
    organizationId: ORG,
    apiKey: { id: 'key-1', tier: 'free', permissions: ['ai', 'write'] },
  });
}

async function callV1(pathname, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
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
    url: new URL(`http://localhost/api/v1/ai/${pathname}`),
    repoRoot: REPO_ROOT,
    storageScope: {
      repoRoot: REPO_ROOT,
      organizationId: ORG,
      actorEmail: OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      name: 'Bot',
      ownerEmail: OWNER,
      permissions: ['ai', 'write'],
      organizationId: ORG,
    },
    authedUser: AUTHED,
  });
  return res.body;
}

// ── The rule ────────────────────────────────────────────────────────────────

test('a value is remote when the browser would fetch it from another host', () => {
  for (const remote of [
    IMAGE,
    BACKGROUND,
    `/\\${HOST}/x.png`,
    `\\\\${HOST}/x.png`,
    `https:/${HOST}/x.png`,
    `https:\\\\${HOST}\\x.png`,
    `  https://${HOST}/x.png`,
    `ht\ttps://${HOST}/x.png`,
    `/\t/${HOST}/x.png`,
    `https://installation.invalid@${HOST}/x.png`,
    `http:${HOST}/x.png`,
    `HTTPS://${HOST.toUpperCase()}/x.png`,
    `ftp://${HOST}/x.png`,
  ]) {
    assert.equal(loadsFromAnotherHost(remote), true, JSON.stringify(remote));
  }
  for (const local of [
    '/uploads/a.png',
    'uploads/a.png',
    './a.png',
    '/assets/images/a.png?v=2',
    'source-image:3',
    'data:image/png;base64,AAAA',
    'blob:abc',
    'https://',
    '',
  ]) {
    assert.equal(loadsFromAnotherHost(local), false, JSON.stringify(local));
  }
});

test('a media field keeps what was held and what names no other host', () => {
  const slides = [
    {
      type: 'image-slide',
      content: { image: '/uploads/own.png', slideBgImage: HELD_IMAGE },
    },
    { type: 'embed-slide', content: { embedUrl: HELD_EMBED } },
    { type: 'embed-slide', content: { embedUrl: EMBED } },
    { type: 'video-slide', content: { source: VIDEO } },
    // A bare id plays from the library the installation configured.
    { type: 'video-slide', content: { source: 'a-bare-video-id' } },
    {
      type: 'gallery-slide',
      content: { images: [{ src: IMAGE }, { src: HELD_IMAGE }] },
    },
  ];
  const keep = mediaInSlides(heldSlides(), SLIDE_TYPES);
  assert.deepEqual([...keep].sort(), [HELD_EMBED, HELD_IMAGE].sort());
  const unusable = dropForeignMedia(slides, { slideTypes: SLIDE_TYPES, keep });

  // The planted embed and video lost what their type requires; an image
  // slide without its image is still a slide.
  assert.deepEqual([...unusable], [slides[2], slides[3]]);
  assert.deepEqual(
    leaveOut(slides, unusable).map((s) => s.type),
    ['image-slide', 'embed-slide', 'video-slide', 'gallery-slide'],
  );
  assert.match(slides[1]._aiWarnings.at(-1), /was left out/);
  assert.equal(slides[0].content.image, '/uploads/own.png');
  assert.equal(slides[0].content.slideBgImage, HELD_IMAGE);
  assert.equal(slides[1].content.embedUrl, HELD_EMBED);
  assert.equal(slides[2].content.embedUrl, '');
  assert.equal(slides[3].content.source, '');
  assert.equal(slides[4].content.source, 'a-bare-video-id');
  assert.deepEqual(
    slides[5].content.images.map((i) => i.src),
    ['', HELD_IMAGE],
  );
  assert.equal(slides[0]._aiWarnings, undefined);
  assert.match(slides[2]._aiWarnings[0], /embed or video/);
  assert.match(slides[5]._aiWarnings[0], /remote image/);
});

test('a held embed is not a held image: the kinds do not mix up by value', () => {
  // The set holds values; a model that moves an author's embed into an image
  // field loads a URL the deck already loads, and nothing new.
  const slides = [{ type: 'image-slide', content: { image: HELD_EMBED } }];
  dropForeignMedia(slides, {
    slideTypes: SLIDE_TYPES,
    keep: mediaInSlides(heldSlides(), SLIDE_TYPES),
  });
  assert.equal(slides[0].content.image, HELD_EMBED);
});

test('a type the map does not know is read as media in every string', () => {
  const slides = [
    {
      type: 'no-such-slide',
      content: { anything: IMAGE, nested: [{ deep: BACKGROUND }], text: 'Hi' },
    },
  ];
  dropForeignMedia(slides, { slideTypes: SLIDE_TYPES });
  assert.deepEqual(slides[0].content, {
    anything: '',
    nested: [{ deep: '' }],
    text: 'Hi',
  });
});

test('a type named by its published id is read off its declaration', () => {
  const published = canonicalSlideType('embed-slide');
  assert.notEqual(published, 'embed-slide', 'the type has a published id');
  const slides = [{ type: published, content: { embedUrl: EMBED } }];
  dropForeignMedia(slides, { slideTypes: SLIDE_TYPES });
  assert.equal(slides[0].content.embedUrl, '');
});

// ── Every path that writes slide content ────────────────────────────────────

/** Phase 1 and phase 2 of generation, answered from one object. */
function generationAnswer(body) {
  const indexes = [...body.matchAll(/originalIndex: (\d+)\)/g)].map((m) =>
    Number(m[1]),
  );
  return {
    title: 'A report',
    summary: 'What happened',
    sections: [{ heading: 'The year', keyPoints: ['One', 'Two'] }],
    slides: planted()
      .map((slide, originalIndex) => ({
        ...slide,
        intent: 'content',
        section: 0,
        roughContent: slide.content.title,
        originalIndex,
      }))
      .filter(
        (slide) =>
          !body.includes('PRESENTATION CONTEXT') ||
          indexes.includes(slide.originalIndex),
      ),
  };
}

const appendAnswer = () => ({ rationale: 'Added.', slides: planted() });

test('generation: a new deck holds no URL the model wrote', async (t) => {
  stubModel(t, generationAnswer);
  const deck = await generateDeck('The year in four slides.', {
    lang: 'en-GB',
    slideTypes: SLIDE_TYPES,
  });
  assertPlantedTypes(deck.slides, 'generation');
  assertNothingPlanted(deck.slides, 'generation');
  assertLeftOutNotice(deck.slides, 'generation');
});

test('append, the editor: the answer holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  const { slides } = await callRoute(handleAiAppendSlides, {
    raw: 'Add four slides.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'editor append');
  assertNothingPlanted(slides, 'editor append');
  assertLeftOutNotice(slides, 'editor append');
});

test('append, public v1: the answer holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  const { slides } = await callV1('append-slides', {
    raw: 'Add four slides.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'v1 append');
  assertNothingPlanted(slides, 'v1 append');
});

test('append, MCP: the stored deck holds no URL the model wrote', async (t) => {
  await setup();
  stubModel(t, appendAnswer);
  const answer = await callTool('append_slides', {
    presentationId: deckId,
    content: 'Add four slides.',
  });
  assert.equal(answer.appended, 2, 'the embed and the video are left out');
  assertPlantedTypes(stored().slides, 'MCP append');
  assertNothingPlanted(stored(), 'MCP append');
  assert.ok(
    answer.warnings.some(({ message }) => /was left out/.test(message)),
    JSON.stringify(answer.warnings),
  );
});

test('append, MCP: an answer of only an embed stores nothing and says why', async (t) => {
  await setup();
  const [, , embed] = planted();
  stubModel(t, () => ({ rationale: 'Added.', slides: [embed] }));
  const answer = await callTool('append_slides', {
    presentationId: deckId,
    content: 'Embed the page.',
  });
  assert.equal(answer.appended, 0);
  assert.equal(stored().slides.length, 3);
  assert.match(answer.warnings[0].message, /was left out/);
});

test('refine-section: a revised section holds what the deck held, nothing new', async (t) => {
  const deck = await setup();
  stubModel(t, () => ({
    rationale: 'Revised.',
    slides: [
      ...planted(),
      {
        type: 'embed-slide',
        content: { title: 'Board', embedUrl: HELD_EMBED },
      },
    ],
  }));
  const { slides } = await callRoute(handleAiRefineSection, {
    presentation: deck,
    slideIds: [deck.slides[2].id],
    feedback: 'Make it visual.',
    lang: 'en',
  });
  assertPlantedTypes(slides, 'refine-section');
  assertNothingPlanted(slides, 'refine-section');
  assert.equal(slides.at(-1).content.embedUrl, HELD_EMBED, 'the held embed');
});

test('refine-section: a section of only a planted embed is a failed answer', async (t) => {
  const deck = await setup();
  const [, , embed] = planted();
  stubModel(t, () => ({ rationale: 'Revised.', slides: [embed] }));
  t.mock.method(console, 'error', () => {});
  const res = createMockRes();
  await handleAiRefineSection({
    repoRoot: REPO_ROOT,
    storageScope: scope(),
    req: createMockReq({
      method: 'POST',
      body: {
        presentation: deck,
        slideIds: [deck.slides[2].id],
        feedback: 'Embed it.',
      },
    }),
    res,
    authedUser: AUTHED,
  });
  // An empty section would delete the selected slides in the editor.
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, 'bad_gateway');
});

test('iterate, one slide: the rewritten slide keeps its own image only', async (t) => {
  const deck = await setup();
  stubModel(t, () => ({
    type: 'image-text-slide',
    content: {
      title: 'The barn',
      body: 'Shorter.',
      image: HELD_IMAGE,
      slideBgImage: BACKGROUND,
    },
  }));
  const answer = await callRoute(handleAiIterate, {
    presentation: deck,
    command: 'Make this shorter',
    currentSlideIndex: 0,
  });
  assertNothingPlanted(answer, 'editor iterate');
  const [slide] = answer.presentation.slides;
  assert.equal(slide.content.body, 'Shorter.');
  assert.equal(slide.content.image, HELD_IMAGE, 'its own image stays');
  assert.ok(!slide.content.slideBgImage, 'the planted background is gone');
});

test('iterate, one slide: a rewrite into a planted embed is a failed answer', async (t) => {
  const deck = await setup();
  const [, , embed] = planted();
  stubModel(t, () => embed);
  t.mock.method(console, 'error', () => {});
  const res = createMockRes();
  await handleAiIterate({
    storageScope: scope(),
    req: createMockReq({
      method: 'POST',
      body: {
        presentation: deck,
        command: 'Make this an embed',
        currentSlideIndex: 2,
      },
    }),
    res,
    authedUser: AUTHED,
  });
  assert.equal(res.statusCode, 502);
});

/** A deck-wide plan: one replacement and one split, both planted. */
const planAnswer = () => {
  const [image, gallery, embed, video] = planted();
  return {
    summary: 'Reworked.',
    modifications: [
      { slideIndex: 0, action: 'replace', slide: image, reasoning: 'r' },
      { slideIndex: 1, action: 'replace', slide: embed, reasoning: 'r' },
      { slideIndex: 2, action: 'split', slides: [gallery, video] },
    ],
  };
};

test('iterate, deck-wide: no replacement or split holds a URL the model wrote', async (t) => {
  const deck = await setup();
  stubModel(t, planAnswer);
  const answer = await callRoute(handleAiIterate, {
    presentation: deck,
    command: 'More visual variety everywhere',
  });
  // The replacement by an embed is not in the plan: slide 2 stays as it was.
  assert.deepEqual(
    answer.plan.modifications.map((m) => m.slideIndex),
    [0, 2],
  );
  assert.match(answer.plan.summary, /was left out/);
  assert.equal(answer.presentation.slides[1].content.embedUrl, HELD_EMBED);
  assertPlantedTypes(answer.presentation.slides, 'deck-wide iterate');
  assertNothingPlanted(answer, 'deck-wide iterate');
});

test('iterate, MCP: neither the plan nor the stored deck holds one', async (t) => {
  await setup();
  stubModel(t, planAnswer);
  const proposed = await callTool('iterate_presentation', {
    presentationId: deckId,
    command: 'More visual variety everywhere',
  });
  assert.equal(proposed.applied, false);
  assertNothingPlanted(proposed, 'MCP iterate plan');

  const applied = await callTool('iterate_presentation', {
    presentationId: deckId,
    command: 'More visual variety everywhere',
    apply: [0, 1, 2],
  });
  assert.equal(applied.applied, true);
  assertPlantedTypes(stored().slides, 'MCP iterate');
  assertNothingPlanted(stored(), 'MCP iterate');
});

/** A conversion's content: the target type's fields plus a planted background. */
const convertAnswer = () => ({
  title: 'Plan',
  variant: 'bullets',
  items: [
    { title: 'Next year', text: 'Extend.' },
    { title: 'After that', text: 'Rest.' },
  ],
  slideBgImage: BACKGROUND,
});

test('convert-slide, the editor: the converted slide brings no background', async (t) => {
  const deck = await setup();
  stubModel(t, convertAnswer);
  const { slide } = await callRoute(handleAiConvertSlide, {
    slide: deck.slides[2],
    toType: 'list-slide',
    lang: 'en',
  });
  assert.equal(slide.type, 'list-slide');
  assertNothingPlanted(slide, 'editor convert');
});

test('convert-slide keeps the background the slide already had', async (t) => {
  await setup();
  stubModel(t, () => ({ ...convertAnswer(), slideBgImage: HELD_IMAGE }));
  const { slide } = await callRoute(handleAiConvertSlide, {
    slide: {
      type: 'content-slide',
      content: { title: 'Plan', body: 'Next.', slideBgImage: HELD_IMAGE },
    },
    toType: 'list-slide',
    lang: 'en',
  });
  assert.equal(slide.content.slideBgImage, HELD_IMAGE);
});

test('convert-slide, MCP: the stored slide brings no background', async (t) => {
  await setup();
  stubModel(t, convertAnswer);
  await callTool('convert_slide', {
    presentationId: deckId,
    slideIndex: 2,
    targetType: 'list-slide',
  });
  assert.equal(stored().slides[2].type, 'list-slide');
  assertNothingPlanted(stored(), 'MCP convert');
});

test('analysis: a proposed slide holds what the deck held, nothing new', async (t) => {
  const deck = await setup();
  const [image, , embed] = planted();
  stubModel(t, () => ({
    suggestions: [
      {
        slideId: deck.slides[0].id,
        category: 'visual-balance',
        body: 'Use a picture.',
        proposedSlide: image,
      },
      {
        slideId: deck.slides[1].id,
        category: 'slide-type',
        body: 'Embed it.',
        proposedSlide: embed,
      },
      {
        slideId: deck.slides[2].id,
        category: 'slide-type',
        body: 'Show the board here.',
        proposedSlide: {
          type: 'embed-slide',
          content: { title: 'Board', embedUrl: HELD_EMBED },
        },
      },
    ],
  }));
  const { suggestions } = await analyzePresentation(deck, {
    vendor: 'openai',
    slideTypes: SLIDE_TYPES,
  });
  assert.equal(suggestions.length, 3, 'the advice stays');
  assert.equal(suggestions[0].proposedSlide.content.image, '');
  assert.equal(suggestions[1].proposedSlide, null, 'no embed without a page');
  assertNothingPlanted(suggestions, 'analysis');
  assert.equal(suggestions[2].proposedSlide.content.embedUrl, HELD_EMBED);
});

// ── The list is closed ──────────────────────────────────────────────────────

/** Files that call the transport and turn the answer into slide content. */
const WRITES_SLIDE_CONTENT = {
  'server/utils/ai/generate-outline.js': 'generation',
  'server/utils/ai/revise-outline.js': 'generation',
  'server/utils/ai/refine-slides.js': 'generation',
  'server/utils/openai/append.js': 'append',
  'server/utils/ai/refine-section.js': 'refine-section',
  'server/utils/ai/iterate-deck.js': 'iterate',
  'server/utils/openai/convert-slide.js': 'convert-slide',
  'server/utils/ai/analyze-presentation.js': 'analysis',
};

/** Files whose answer never becomes a media field, and why. */
const WRITES_NO_MEDIA = {
  'server/utils/ai/compress-deck.js': 'indexes and reasons, no slide content',
  'server/utils/ai/compare-versions.js': 'insights about slides, returned',
  'server/utils/openai/translate.js': 'strings for declared text keys only',
  'server/utils/llm/alt-text.js': 'alt text, previewed',
  'server/services/digest-generation.js': 'email fields',
  'server/routes/api/presentations/description.js': 'a description, returned',
};

function callSiteFiles(dir = path.join(REPO_ROOT, 'server')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return callSiteFiles(file);
    if (!entry.name.endsWith('.js')) return [];
    const calls = /await requestChatCompletionContent\(/.test(
      readFileSync(file, 'utf8'),
    );
    return calls ? [path.relative(REPO_ROOT, file)] : [];
  });
}

test('a new call to the model cannot write slide content unseen here', (t) => {
  assert.deepEqual(
    callSiteFiles().sort(),
    [
      ...Object.keys(WRITES_SLIDE_CONTENT),
      ...Object.keys(WRITES_NO_MEDIA),
    ].sort(),
    'file the new call under WRITES_SLIDE_CONTENT, with a test, or WRITES_NO_MEDIA',
  );
  const tested = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const name of new Set(Object.values(WRITES_SLIDE_CONTENT))) {
    assert.match(tested, new RegExp(`^test\\('${name}[,:]`, 'm'), name);
  }
  t.diagnostic(`${Object.keys(WRITES_SLIDE_CONTENT).length} writing files`);
});
