/**
 * Incomplete slides (B590) on the real output routes: a slide whose essential
 * picture is empty is absent from every rendered export, for the author as for
 * a reader, in every language version, and from every reader channel; the
 * data formats keep it; the MCP previews mark it in place.
 *
 * The deck is the reader-boundary fixture (B769) with one incomplete slide
 * appended to every language list, so the fixture's own jumps and counts keep
 * their meaning. Its draft and `hideInExport` slides double as the proof that
 * the rendered exports now honour export visibility for the author too.
 *
 * Run with: node --test tests/incomplete-slides-outputs.test.js
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  seedViewerReadFixture,
  READ_EMAILS,
  READ_ORG,
} from './helpers/viewer-read-fixture.js';
import { userIdFor } from './helpers/identity-fixtures.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { __setTestDb } from '../server/db/client.js';
import { handleExports } from '../server/routes/api/export.js';
import { handleExports as handleV1Exports } from '../server/routes/public-api/v1/exports.js';
import { handlePresentationItem } from '../server/routes/api/presentations/presentation.js';
import { handleSharePublicEndpoints } from '../server/routes/api/share-links/public.js';
import { createShareLink } from '../server/storage/share-links/index.js';
import { loadFollowAudience } from '../server/routes/api/follow/helpers.js';
import { getExportResult } from '../server/export/result-store.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import { resetRateLimitBuckets } from '../server/utils/rate-limit.js';
import { openPdf } from '../server/utils/pdf-extract/pdfjs.js';
import { McpServer } from '../server/mcp/protocol.js';
import { registerTools } from '../server/mcp/tools.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildReaderHtml } from '../server/export/reader.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';
import { seedThemeConfig } from './helpers/theme-seed.js';

const MARK = 'INCOMPLETE-B590';
/** Markers no rendered export may carry: incomplete, draft, `hideInExport`. */
const NOT_EXPORTED = [MARK, 'DRAFT-B769', 'EXPORT-FLAG-B769'];

let fixture;
let mcp;
before(async () => {
  fixture = await seedViewerReadFixture();
  const empty = {
    id: 'empty-picture',
    parentId: null,
    type: 'image-slide',
    content: { title: MARK, image: '' },
  };
  // `row.slides` is the nl version's own list; every list gets one.
  const lists = new Set([
    fixture.row.slides,
    ...Object.values(fixture.row.i18n.versions).map((v) => v.slides),
  ]);
  for (const list of lists) list.push(structuredClone(empty));
  mcp = new McpServer();
  registerTools(mcp);
});
after(async () => {
  __setTestDb(null);
  await closePuppeteerBrowser();
});
beforeEach(() => resetRateLimitBuckets());

const actor = (role) => ({
  id: userIdFor(READ_EMAILS[role]),
  email: READ_EMAILS[role],
  role: 'user',
  organizationId: READ_ORG,
});
function context(path, role, res = createMockRes()) {
  return {
    repoRoot: process.cwd(),
    storageScope: fixture.scope,
    req: createMockReq(),
    res,
    url: new URL(path, 'http://localhost'),
    authedUser: actor(role),
    apiKey: {
      id: `b590-${role}`,
      ownerEmail: READ_EMAILS[role],
      tier: 'pro',
      permissions: ['read', 'export'],
      organizationId: READ_ORG,
    },
  };
}
async function exportOf(endpoint, role = 'owner', v1 = false) {
  const ctx = context(
    `/api/${v1 ? 'v1/' : ''}presentations/${fixture.deckId}/export/${endpoint}`,
    role,
  );
  await (v1 ? handleV1Exports : handleExports)(ctx);
  assert.equal(ctx.res.statusCode, 200, `${endpoint}: ${ctx.res.body}`);
  return ctx.res.body;
}
function absent(text, markers = NOT_EXPORTED, where = '') {
  for (const marker of markers)
    assert.ok(!String(text).includes(marker), `${where}: ${marker}`);
}
async function pdfText(bytes) {
  const task = openPdf(bytes);
  const pdf = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++)
      text += (await (await pdf.getPage(i)).getTextContent()).items
        .map((item) => item.str || '')
        .join(' ');
    return { text, pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
const pptxSlides = (zip) =>
  Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .length;

// The author's stored list has 8 slides: shown, hidden-from-viewers, target,
// draft, published-only, export-only, presentation-only, the incomplete one.
// A rendered export shows 5 of them; a reader's (no hidden-from-viewers) 4.
for (const [role, count] of [
  ['owner', 5],
  ['view', 4],
]) {
  test(`${role}: HTML, print, PDF, PNG ZIP, both PowerPoints, handoff and notes leave it out`, async () => {
    for (const lang of ['', '?lang=de']) {
      const html = await exportOf(`html${lang}`, role);
      absent(html, NOT_EXPORTED, `html${lang}`);
      assert.ok(String(html).includes('VISIBLE-B769'));
    }
    absent(await exportOf('pdf', role), NOT_EXPORTED, 'print');

    const pdf = await pdfText(await exportOf('pdf-slides.pdf', role));
    absent(pdf.text, NOT_EXPORTED, 'pdf-slides');
    assert.equal(pdf.pages, count, 'one PDF page per exported slide');

    for (const endpoint of ['pptx?sync=1', 'pptx-editable?sync=1']) {
      const zip = await JSZip.loadAsync(await exportOf(endpoint, role));
      assert.equal(pptxSlides(zip), count, endpoint);
      for (const file of Object.values(zip.files))
        if (!file.dir && /slide\d+\.xml$/.test(file.name))
          absent(await file.async('string'), NOT_EXPORTED, endpoint);
    }

    const handoff = await JSZip.loadAsync(
      await exportOf('handoff.zip?sync=1', role),
    );
    for (const file of Object.values(handoff.files)) {
      if (file.dir) continue;
      if (/\.pptx$/.test(file.name))
        assert.equal(
          pptxSlides(await JSZip.loadAsync(await file.async('nodebuffer'))),
          count,
          'handoff pptx',
        );
      else if (/\.pdf$/.test(file.name))
        absent(
          (await pdfText(await file.async('nodebuffer'))).text,
          NOT_EXPORTED,
          'handoff pdf',
        );
      else if (/\.(html|md)$/.test(file.name))
        absent(await file.async('string'), NOT_EXPORTED, file.name);
    }

    if (role === 'owner')
      absent(await exportOf('notes.md', role), NOT_EXPORTED, 'notes');
  });
}

test('the PNG ZIP counts the exported slides only', async () => {
  const res = Object.assign(new EventEmitter(), {
    statusCode: null,
    chunks: [],
    writable: true,
    writableEnded: false,
    writeHead(code) {
      this.statusCode = code;
    },
    setHeader() {},
    flushHeaders() {},
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    end() {
      this.writableEnded = true;
      this.emit('close');
    },
  });
  const ctx = context(
    `/api/presentations/${fixture.deckId}/export/png.zip/stream`,
    'owner',
    res,
  );
  ctx.req = Readable.from([]);
  ctx.req.method = 'GET';
  ctx.req.headers = {};
  await handleExports(ctx);
  const complete = /event: complete\ndata: (.+)/.exec(res.chunks.join(''));
  assert.ok(complete, res.chunks.join(''));
  const id = JSON.parse(complete[1]).downloadUrl.match(
    /export-(.+)\/download/,
  )[1];
  const zip = await JSZip.loadAsync(getExportResult(id).buffer);
  assert.equal(
    Object.keys(zip.files).filter((n) => /\.png$/.test(n)).length,
    5,
  );
});

test('v1 HTML, print and PowerPoint leave it out', async () => {
  absent(await exportOf('html', 'owner', true), NOT_EXPORTED, 'v1 html');
  absent(await exportOf('pdf', 'owner', true), NOT_EXPORTED, 'v1 print');
  const zip = await JSZip.loadAsync(await exportOf('pptx', 'owner', true));
  assert.equal(pptxSlides(zip), 5);
});

test('the data formats carry the whole deck, the incomplete slide included', async () => {
  assert.ok(String(await exportOf('json')).includes(MARK));
  const bundle = await JSZip.loadAsync(await exportOf('deck.zip'));
  assert.ok((await bundle.file('deck.json').async('string')).includes(MARK));
});

test('a view-only read, a share link and follow-along leave it out in every language', async () => {
  const res = createMockRes();
  await handlePresentationItem(
    context(`/api/presentations/${fixture.deckId}`, 'view', res),
    fixture.deckId,
  );
  assert.equal(res.statusCode, 200);
  absent(res.body, [MARK], 'view-only GET');

  const owner = createMockRes();
  await handlePresentationItem(
    context(`/api/presentations/${fixture.deckId}`, 'owner', owner),
    fixture.deckId,
  );
  assert.ok(owner.body.includes(MARK), 'the author keeps it');

  const { shareLink } = await createShareLink(fixture.scope, fixture.deckId, {
    permission: 'view',
  });
  const shared = createMockRes();
  await handleSharePublicEndpoints({
    repoRoot: process.cwd(),
    req: createMockReq({ method: 'POST', body: {} }),
    res: shared,
    url: new URL(`/api/share/${shareLink.token}/verify`, 'http://localhost'),
  });
  assert.equal(shared.statusCode, 200, shared.body);
  absent(shared.body, [MARK], 'share');

  const stored = { ...fixture.row, organizationId: READ_ORG };
  for (const lang of ['nl', 'de']) {
    const follow = await loadFollowAudience(process.cwd(), stored, lang);
    absent(JSON.stringify(follow), [MARK], `follow ${lang}`);
    assert.ok(follow.slides.length > 0);
  }
});

test('published canvas, reader and embed leave it out', async () => {
  const theme = await seedThemeConfig('brand');
  const pres = structuredClone(fixture.row);
  for (const html of [
    await buildStandaloneHtml(process.cwd(), pres, {
      context: 'published',
      theme,
    }),
    buildReaderHtml(process.cwd(), pres, { context: 'published' }),
    await buildEmbedHtml(process.cwd(), pres, { theme }),
  ]) {
    absent(html, [MARK], 'published');
    assert.ok(html.includes('VISIBLE-B769'));
  }
});

test('MCP previews keep every slide in place and mark the incomplete one', async () => {
  const tool = (name, args = {}) =>
    mcp.tools.get(name).handler(
      { presentationId: fixture.deckId, ...args },
      {
        ownerEmail: READ_EMAILS.owner,
        organizationId: READ_ORG,
        permissions: ['read'],
      },
    );
  const list = await tool('preview_presentation');
  assert.equal(list.match(/class="preview-item"/g).length, 8);
  assert.equal(list.match(/data-incomplete="true"/g)?.length, 1);
  assert.ok(
    list.lastIndexOf('data-incomplete') > list.indexOf('8. image-slide'),
  );
  assert.match(
    await tool('preview_slide', { slideIndex: 7 }),
    /data-incomplete/,
  );
  assert.doesNotMatch(
    await tool('preview_slide', { slideIndex: 0 }),
    /data-incomplete/,
  );
});
