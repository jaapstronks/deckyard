/**
 * B627: text contrast over a background image is settled on the server too.
 *
 * The editor used to be the only place that sampled a slide's background image
 * and stored which theme text colour reads over it. A deck that never met the
 * editor (MCP, import, AI) kept the theme colour, so a brand deck opened with a
 * dark title on the dark moss photo in present, share and the PDF. The
 * storage write seam now settles the same keys with the same rule
 * (`shared/bg-image-contrast.js`).
 *
 * Run with: node --test tests/bg-image-contrast.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { judgeBgTextContrast } from '../shared/bg-image-contrast.js';
import {
  sampleBgTextContrastFile,
  settleBgTextContrast,
} from '../server/utils/bg-image-contrast.js';
import { renderSlideHtml } from '../shared/slide-types.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b627']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const ROOT = process.cwd();
const BRAND = (await seedRow('brand')).id;

const MOSS = '/assets/images/backgrounds/demo-moss.jpg';
const PAPER = '/assets/images/backgrounds/demo-paper.jpg';
const COLORS = { light: '#ffffff', dark: '#212121' };

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { getPresentation } =
  await import('../server/storage/presentations/index.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
      themes: [await seedRow('brand')],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** Pixels of one flat colour, as a sampler hands them over. */
function flat(r, g, b, n = 16) {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 255], i);
  return px;
}

test('the shared rule: light text on a dark image, dark on a light one, a scrim when busy', () => {
  assert.deepEqual(judgeBgTextContrast(flat(10, 30, 20), COLORS), {
    ok: true,
    text: 'light',
    needsScrim: false,
    failFraction: 0,
  });
  assert.equal(judgeBgTextContrast(flat(245, 240, 230), COLORS).text, 'dark');

  // Half black, half white: whichever colour wins fails on half the region.
  const busy = new Uint8ClampedArray([
    ...flat(0, 0, 0, 8),
    ...flat(255, 255, 255, 8),
  ]);
  assert.equal(judgeBgTextContrast(busy, COLORS).needsScrim, true);

  assert.deepEqual(judgeBgTextContrast(new Uint8ClampedArray(0), COLORS), {
    ok: false,
  });
  assert.deepEqual(
    judgeBgTextContrast(new Uint8ClampedArray([0, 0, 0, 0]), COLORS),
    {
      ok: false,
    },
  );
});

test('the server sampler reads the theme presets the way the editor does', async () => {
  const file = (url) => path.join(ROOT, url);
  assert.equal(
    (await sampleBgTextContrastFile(file(MOSS), COLORS)).text,
    'light',
  );
  assert.equal(
    (await sampleBgTextContrastFile(file(PAPER), COLORS)).text,
    'dark',
  );
  assert.deepEqual(
    await sampleBgTextContrastFile(
      file('/assets/images/backgrounds/nope.jpg'),
      COLORS,
    ),
    { ok: false },
  );
});

test('settle writes the verdict on every unsettled slide, in every language version', async () => {
  const deck = {
    slides: [
      { id: 'a', content: { slideBgImage: MOSS } },
      { id: 'b', content: { slideBgImage: PAPER, slideBgText: 'light' } },
      { id: 'c', content: { title: 'no image' } },
    ],
    i18n: {
      versions: {
        en: { slides: [{ id: 'a', content: { slideBgImage: MOSS } }] },
      },
    },
  };
  let themeLoads = 0;
  const settled = await settleBgTextContrast(deck, {
    repoRoot: ROOT,
    loadTheme: async () => {
      themeLoads += 1;
      return null;
    },
  });
  assert.equal(settled, 3);
  assert.equal(themeLoads, 1);
  assert.deepEqual(deck.slides[0].content, {
    slideBgImage: MOSS,
    slideBgAutoFor: MOSS,
    slideBgTextAuto: 'light',
    slideBgNeedsScrim: false,
    slideBgText: 'auto',
  });
  // An author's own choice stays; the verdict rides along, as in the editor.
  assert.equal(deck.slides[1].content.slideBgText, 'light');
  assert.equal(deck.slides[1].content.slideBgTextAuto, 'dark');
  assert.deepEqual(deck.slides[2].content, { title: 'no image' });
  assert.equal(
    deck.i18n.versions.en.slides[0].content.slideBgTextAuto,
    'light',
  );
});

test('settle leaves settled slides and unreadable images alone, without loading the theme', async () => {
  const settledContent = {
    slideBgImage: MOSS,
    slideBgAutoFor: MOSS,
    slideBgTextAuto: 'dark',
  };
  const deck = {
    slides: [
      { content: { ...settledContent } },
      { content: { slideBgImage: 'https://example.com/remote.jpg' } },
      { content: { slideBgImage: '/assets/../server/index.js' } },
    ],
  };
  const settled = await settleBgTextContrast(deck, {
    repoRoot: ROOT,
    loadTheme: async () => assert.fail('nothing to measure, no theme load'),
  });
  assert.equal(settled, 0);
  assert.deepEqual(deck.slides[0].content, settledContent);
  assert.deepEqual(deck.slides[1].content, {
    slideBgImage: 'https://example.com/remote.jpg',
  });
  assert.equal(await settleBgTextContrast(deck, { repoRoot: null }), 0);
});

/** Call an MCP tool the way an agent does. */
function mcp(name, args) {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  return server.tools.get(name).handler(args, {
    ownerEmail: OWNER,
    organizationId: ORG,
    userId: userIdFor(OWNER),
  });
}

test('an MCP deck on a theme photo presents with a readable title, without an editor visit', async () => {
  const created = await mcp('create_presentation_from_slides', {
    title: 'Van een agent',
    theme: BRAND,
    slides: [
      { type: 'title-slide', content: { title: 'Hoi', slideBgImage: MOSS } },
    ],
  });
  const scope = testScope(ROOT);
  let pres = await getPresentation(scope, created.id);
  const cover = pres.slides[0];
  assert.equal(cover.content.slideBgAutoFor, MOSS);
  assert.equal(cover.content.slideBgTextAuto, 'light');
  assert.equal(cover.content.slideBgText, 'auto');
  // What present, share and the PDF all render from.
  assert.match(renderSlideHtml(cover), /has-slide-bg-light-text/);

  // A new image through update_slide is measured again on the same seam.
  await mcp('update_slide', {
    presentationId: created.id,
    slideIndex: 0,
    content: { slideBgImage: PAPER },
  });
  pres = await getPresentation(scope, created.id);
  assert.equal(pres.slides[0].content.slideBgAutoFor, PAPER);
  assert.equal(pres.slides[0].content.slideBgTextAuto, 'dark');
  assert.match(renderSlideHtml(pres.slides[0]), /has-slide-bg-dark-text/);
});
