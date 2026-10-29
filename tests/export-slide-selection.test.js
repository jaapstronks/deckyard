/**
 * A slide selection on the slide PDF and the PNG ZIP (B871): `?slides=1,3-5`
 * names slides as the editor numbers them, one parser reads it in the
 * service layer (`parseSlideSelection`), and the export context keeps those
 * slides in deck order. A selection that cannot be read, that names a slide
 * past the end, that leaves nothing to render or that lands on a format
 * without selections is the 400 `invalid` naming `slides`.
 *
 * Service-level over the database double, plus the browser-print preview of
 * the slide PDF as the route: it shares the PDF's format id and renders
 * without Chrome.
 *
 * Run with: node --test tests/export-slide-selection.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { healthKeys } from './helpers/instance-health.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const {
  parseSlideSelection,
  prepareExportContext,
  prepareQueuedExportContext,
} = await import('../server/services/exports.js');
const { handleExports } = await import('../server/routes/api/export.js');
const { closePuppeteerBrowser } =
  await import('../server/utils/puppeteer-browser.js');

let brandSeed;
let db;

test.before(async () => {
  brandSeed = await brandSeedRow();
});

test.beforeEach(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [brandSeed],
    users: userRows(OWNER),
  });
  __setTestDb(db);
  await initializeStorage();
});

test.afterEach(() => {
  __setTestDb(null);
});

// The slide PDF page may raster a gradient in Chrome; close it so the run ends.
test.after(() => closePuppeteerBrowser());

const actor = { id: userIdFor(OWNER), email: OWNER, organizationId: ORG };
const scope = () => testScope(process.cwd(), { actorEmail: OWNER });

/** Five slides: a card grid that jumps to slide 5, three titles, a live-only one. */
async function seedDeck() {
  const pres = await createPresentation(scope(), {
    title: 'Selection deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [
      {
        type: 'icon-card-grid-slide',
        content: { title: 'S1', items: [{ title: 'To five', link: '#5' }] },
      },
      { type: 'title-slide', content: { title: 'S2' } },
      { type: 'title-slide', content: { title: 'S3' } },
      { type: 'follow-invite-slide', content: {} },
      { type: 'title-slide', content: { title: 'S5' } },
    ],
  });
  await healthKeys(db);
  db.__tables.instance_health = [];
  return pres;
}

const prepare = (presentationId, slides, format = 'pdf-slides') =>
  prepareExportContext(scope(), { actor }, { presentationId, format, slides });

const titles = (ctx) => ctx.filteredPres.slides.map((s) => s.content.title);

/** A rejection is the canonical 400 `invalid` naming `slides`. */
function isSlidesInvalid(err) {
  assert.equal(err.statusCode, 400);
  assert.deepEqual(err.toJSON().error, 'invalid');
  assert.deepEqual(err.details, { field: 'slides' });
  return true;
}

test('the parser reads numbers and ranges, sorted and de-duplicated', () => {
  assert.equal(parseSlideSelection(null), null);
  assert.equal(parseSlideSelection(undefined), null);
  assert.deepEqual(parseSlideSelection('3'), [3]);
  assert.deepEqual(parseSlideSelection('1,3-5'), [1, 3, 4, 5]);
  assert.deepEqual(parseSlideSelection('5, 1 , 2-3,3'), [1, 2, 3, 5]);
  assert.deepEqual(parseSlideSelection('4-4'), [4]);
});

test('the parser refuses what is not a selection', () => {
  for (const raw of ['', '0', '-1', '3-1', '1,,2', 'a', '1-', '1.5', '2-x']) {
    assert.throws(() => parseSlideSelection(raw), isSlidesInvalid, raw);
  }
});

test('one slide: the context keeps that slide and names it in the filename', async () => {
  const pres = await seedDeck();
  const ctx = await prepare(pres.id, '3');
  assert.deepEqual(titles(ctx), ['S3']);
  assert.deepEqual(ctx.slideSelection, [3]);
  assert.equal(ctx.title, 'Selection deck-slide-03');
  assert.equal(ctx.pres.slides.length, 5, 'the deck itself is untouched');
  assert.deepEqual(await healthKeys(db), ['export:pdf-slides']);
});

test('a selection keeps deck order, drops what an export always drops, and pins jumps', async () => {
  const pres = await seedDeck();
  const ctx = await prepare(pres.id, '5,1,3-4');
  // Slide 4 is live-only: left out as in a whole-deck export.
  assert.deepEqual(titles(ctx), ['S1', 'S3', 'S5']);
  assert.equal(ctx.title, 'Selection deck-slides-1_3-5');
  // `#5` on slide 1 still names the stored slide 5, not the third page.
  assert.equal(
    ctx.filteredPres.slides[0].content.items[0].link,
    `#slide:${pres.slides[4].id}`,
  );
});

test('the PNG ZIP takes a selection too; other formats refuse one', async () => {
  const pres = await seedDeck();
  assert.deepEqual(titles(await prepare(pres.id, '2', 'png-zip')), ['S2']);
  for (const format of ['pptx', 'html', 'png', 'json']) {
    await assert.rejects(prepare(pres.id, '2', format), isSlidesInvalid);
  }
});

test('past the last slide, or only slides an export leaves out: refused, not counted', async () => {
  const pres = await seedDeck();
  await assert.rejects(prepare(pres.id, '2,6'), (err) => {
    isSlidesInvalid(err);
    assert.match(err.message, /Slide 6 does not exist/);
    return true;
  });
  await assert.rejects(prepare(pres.id, '4'), isSlidesInvalid);
  assert.deepEqual(await healthKeys(db), []);
});

test('the queued worker reads the same selection', async () => {
  const pres = await seedDeck();
  const asked = await prepare(pres.id, '2-3');
  const queued = await prepareQueuedExportContext(scope(), {
    presentationId: pres.id,
    format: 'pdf-slides',
    slides: '2-3',
    exportAccess: asked.exportAccess,
  });
  assert.deepEqual(titles(queued), ['S2', 'S3']);
  assert.equal(queued.title, asked.title);
});

/** GET an export route as the owner. */
async function get(path) {
  const res = createMockRes();
  await handleExports({
    repoRoot: process.cwd(),
    storageScope: scope(),
    req: createMockReq(),
    res,
    url: new URL(path, 'http://localhost'),
    authedUser: actor,
  });
  return res;
}

test('route: the slide PDF page renders exactly the selected slides', async () => {
  const pres = await seedDeck();
  const base = `/api/presentations/${pres.id}/export/pdf-slides`;

  const all = await get(base);
  assert.equal(all.statusCode, 200);
  assert.equal(String(all.body).match(/class="pdf-page"/g)?.length, 4);

  const one = await get(`${base}?slides=3`);
  assert.equal(one.statusCode, 200);
  assert.equal(String(one.body).match(/class="pdf-page"/g)?.length, 1);

  const some = await get(`${base}?slides=5,2`);
  const html = String(some.body);
  assert.equal(html.match(/class="pdf-page"/g)?.length, 2);
  assert.ok(html.indexOf('S2') < html.indexOf('S5'), 'deck order');
});

test('route: an invalid selection is the error envelope', async () => {
  const pres = await seedDeck();
  for (const slides of ['0', '9', 'x']) {
    const res = await get(
      `/api/presentations/${pres.id}/export/pdf-slides?slides=${slides}`,
    );
    assert.equal(res.statusCode, 400, slides);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'invalid');
    assert.deepEqual(body.details, { field: 'slides' });
  }
});
