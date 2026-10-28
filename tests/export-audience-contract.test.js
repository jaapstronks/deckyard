import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  seedViewerReadFixture,
  READ_EMAILS,
  READ_ORG,
  PRIVATE_MARKERS,
} from './helpers/viewer-read-fixture.js';
import { userIdFor } from './helpers/identity-fixtures.js';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { __setTestDb } from '../server/db/client.js';
import { __setTestQueues } from '../server/jobs/queue/connection.js';
import {
  prepareExportContext,
  prepareQueuedExportContext,
} from '../server/services/exports.js';
import { handleExports } from '../server/routes/api/export.js';
import { handleExports as handleV1Exports } from '../server/routes/public-api/v1/exports.js';
import { handleJobs } from '../server/routes/api/jobs.js';
import { processExportJob } from '../server/jobs/queue/workers/export-worker.js';
import {
  getExportResult,
  storeExportResult,
} from '../server/export/result-store.js';
import {
  updateCollaboratorPermission,
  removeCollaborator,
} from '../server/storage/collaborators.js';
import { closePuppeteerBrowser } from '../server/utils/puppeteer-browser.js';
import {
  presentationToDeck,
  deckToPresentationParts,
} from '../shared/slide-types.js';

import { openPdf } from '../server/utils/pdf-extract/pdfjs.js';

let fixture;
beforeEach(async () => {
  fixture = await seedViewerReadFixture();
});
afterEach(async () => {
  __setTestQueues(null);
  __setTestDb(null);
  await closePuppeteerBrowser();
});
const actor = (role) => ({
  id: userIdFor(READ_EMAILS[role]),
  email: READ_EMAILS[role],
  organizationId: READ_ORG,
});
const prepare = (role, format = 'html', options = {}) =>
  prepareExportContext(
    fixture.scope,
    { actor: actor(role) },
    { presentationId: fixture.deckId, format, ...options },
  );
function context(path, role, res = createMockRes()) {
  return {
    repoRoot: process.cwd(),
    storageScope: fixture.scope,
    req: createMockReq(),
    res,
    url: new URL(path, 'http://localhost'),
    authedUser: actor(role),
    apiKey: {
      id: `export-${role}`,
      ownerEmail: READ_EMAILS[role],
      tier: 'pro',
      permissions: ['read', 'export'],
      organizationId: READ_ORG,
    },
  };
}
async function request(path, role, v1 = false) {
  const ctx = context(path, role);
  await (v1 ? handleV1Exports : handleExports)(ctx);
  return ctx.res;
}
function safeBytes(bytes) {
  const text = String(bytes);
  for (const marker of PRIVATE_MARKERS)
    assert.ok(!text.includes(marker), marker);
  for (const field of [
    '_aiReasoning',
    '_aiAlternatives',
    '_aiSuggestAfter',
    '_aiWarnings',
  ])
    assert.ok(!text.includes(field), field);
}
async function safePdf(bytes) {
  const task = openPdf(bytes);
  const pdf = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      text += (await page.getTextContent()).items
        .map((item) => item.str || '')
        .join(' ');
    }
    safeBytes(text);
    assert.ok(text.includes('VISIBLE-B769'), text);
    assert.ok(text.includes('TARGET-B769'), text);
  } finally {
    await task.destroy();
  }
}
function safeDeck(pres) {
  safeBytes(JSON.stringify(pres));
  for (const slides of [
    pres.slides,
    ...Object.values(pres.i18n?.versions || {}).map((v) => v.slides),
  ]) {
    assert.ok(slides.length > 0);
    for (const slide of slides) {
      assert.ok(!('notes' in slide));
      assert.ok(!slide.visibility?.hideFromViewers);
    }
    assert.equal(slides[0].content.actions[0].url, '#slide:target');
    assert.equal(slides[0].content.actions[1].url, '#slide:hidden');
  }
}
async function queue(role, format = 'pptx') {
  const added = [];
  __setTestQueues({
    export: {
      async add(name, data) {
        added.push({ name, data });
        return { id: 'b769' };
      },
    },
  });
  // Exercise the actual enqueue and worker paths; browser builders remain real.
  const res = await request(
    `/api/presentations/${fixture.deckId}/export/${format}`,
    role,
  );
  return { res, added };
}
const run = (job, id = crypto.randomUUID()) =>
  processExportJob({ ...job, id, updateProgress: async () => {} }).then(
    () => id,
  );
const queuedContext = (data) => prepareQueuedExportContext(fixture.scope, data);

for (const role of ['owner', 'edit', 'view', 'comment']) {
  test(`${role}: both builder inputs and all languages follow deck rights without changing storage`, async () => {
    const original = structuredClone(fixture.row);
    for (const lang of [null, 'nl', 'en-GB', 'de']) {
      const ctx = await prepare(role, 'json', { lang, allLanguages: !lang });
      if (['view', 'comment'].includes(role)) {
        safeDeck(ctx.pres);
        safeDeck(ctx.filteredPres);
        assert.equal(ctx.exportAccess.audience, 'reader');
      } else {
        for (const marker of PRIVATE_MARKERS)
          assert.ok(JSON.stringify(ctx.pres).includes(marker), marker);
        assert.equal(ctx.exportAccess.audience, 'author');
      }
    }
    assert.deepEqual(fixture.row, original);
  });
  for (const v1 of [false, true]) {
    test(`${role}: ${v1 ? 'v1' : 'internal'} real JSON and HTML downloads`, async () => {
      for (const format of ['json', 'html']) {
        const res = await request(
          `/api/${v1 ? 'v1/' : ''}presentations/${fixture.deckId}/export/${format}?lang=en-GB`,
          role,
          v1,
        );
        assert.equal(res.statusCode, 200, String(res.body));
        assert.ok(String(res.body).includes('VISIBLE-B769'));
        if (['view', 'comment'].includes(role)) safeBytes(res.body);
        else if (format === 'json')
          assert.ok(String(res.body).includes(PRIVATE_MARKERS[0]));
      }
    });
  }
}

for (const role of ['view', 'comment']) {
  test(`${role}: notes-only refuses before builder or enqueue`, async () => {
    let queued = false;
    __setTestQueues({
      export: {
        async add() {
          queued = true;
          throw new Error('must not enqueue');
        },
      },
    });
    for (const ext of ['md', 'docx']) {
      const res = await request(
        `/api/presentations/${fixture.deckId}/export/notes.${ext}`,
        role,
      );
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error, 'forbidden');
    }
    assert.equal(queued, false);
  });
  test(`${role}: real portable .deck contains no private fields in any language`, async () => {
    const res = await request(
      `/api/presentations/${fixture.deckId}/export/deck.zip`,
      role,
    );
    assert.equal(res.statusCode, 200, String(res.body));
    const zip = await JSZip.loadAsync(res.body);
    for (const entry of Object.values(zip.files))
      if (!entry.dir && /\.json$/.test(entry.name))
        safeBytes(await entry.async('string'));
    const deck = JSON.parse(await zip.file('deck.json').async('string'));
    assert.ok(JSON.stringify(deck).includes('VISIBLE-B769'));
    assert.equal(deck.slides.length, 6);
  });
}

for (const role of ['owner', 'edit']) {
  test(`${role}: JSON and .deck retain author data through portable roundtrip`, async () => {
    const ctx = await prepare(role, 'json', {
      allLanguages: true,
      stripLiveOnly: false,
    });
    for (const endpoint of ['json', 'deck.zip']) {
      const res = await request(
        `/api/presentations/${fixture.deckId}/export/${endpoint}`,
        role,
      );
      assert.equal(res.statusCode, 200, String(res.body));
      const deck =
        endpoint === 'json'
          ? JSON.parse(res.body)
          : JSON.parse(
              await (
                await JSZip.loadAsync(res.body)
              )
                .file('deck.json')
                .async('string'),
            );
      const parts = deckToPresentationParts(deck, {
        slideTypes: ctx.slideTypes,
      });
      const roundtrip = presentationToDeck(
        { ...ctx.pres, ...parts },
        { slideTypes: ctx.slideTypes },
      );
      // Portable v1 carries notes/visibility/translations, not AI working metadata
      // or extra slides existing only in a non-dominant language.
      for (const marker of [PRIVATE_MARKERS[0], PRIVATE_MARKERS[2]])
        assert.ok(JSON.stringify(roundtrip).includes(marker), marker);
      for (const lang of ['nl', 'en-GB', 'de'])
        assert.ok(JSON.stringify(roundtrip).includes(`VISIBLE-B769 ${lang}`));
    }
  });
}

test('reader enqueue is a maximum even after promotion; actual PPTX worker and result stay reader', async () => {
  const { res, added } = await queue('view', 'pptx');
  assert.equal(res.statusCode, 202);
  assert.equal(added[0].data.exportAccess.audience, 'reader');
  await updateCollaboratorPermission(
    fixture.scope,
    fixture.deckId,
    READ_EMAILS.view,
    'edit',
  );
  const ctx = await queuedContext(added[0].data);
  safeDeck(ctx.pres);
  const id = await run(added[0]);
  const result = getExportResult(id);
  assert.equal(result.exportAccess.audience, 'reader');
  const zip = await JSZip.loadAsync(result.buffer);
  for (const entry of Object.values(zip.files))
    if (!entry.dir && /\.xml$/.test(entry.name))
      safeBytes(await entry.async('string'));
  const download = context(`/api/jobs/export-${id}/download`, 'view');
  await handleJobs(download);
  assert.equal(download.res.statusCode, 200);
});

for (const action of ['demote', 'revoke']) {
  test(`${action} before build: job rechecks current rights`, async () => {
    const { added } = await queue('edit', 'pptx');
    if (action === 'revoke') {
      await removeCollaborator(fixture.scope, fixture.deckId, READ_EMAILS.edit);
      await assert.rejects(run(added[0]), { statusCode: 403 });
    } else {
      await updateCollaboratorPermission(
        fixture.scope,
        fixture.deckId,
        READ_EMAILS.edit,
        'view',
      );
      const ctx = await queuedContext(added[0].data);
      safeDeck(ctx.pres);
      const id = await run(added[0]);
      assert.equal(getExportResult(id).exportAccess.audience, 'reader');
      const access = { ...added[0].data.exportAccess, format: 'notes-md' };
      await assert.rejects(
        queuedContext({
          ...added[0].data,
          format: 'notes-md',
          exportAccess: access,
        }),
        { statusCode: 403 },
      );
    }
  });
  test(`${action} after build: author artifact cannot be downloaded or shared with a reader`, async () => {
    const { added } = await queue('edit', 'pptx');
    const id = await run(added[0]);
    if (action === 'revoke')
      await removeCollaborator(fixture.scope, fixture.deckId, READ_EMAILS.edit);
    else
      await updateCollaboratorPermission(
        fixture.scope,
        fixture.deckId,
        READ_EMAILS.edit,
        'view',
      );
    for (const role of ['edit', 'view']) {
      const ctx = context(`/api/jobs/export-${id}/download`, role);
      await handleJobs(ctx);
      assert.equal(ctx.res.statusCode, role === 'edit' ? 403 : 404);
      assert.ok(!Buffer.isBuffer(ctx.res.body));
    }
  });
}

test('pre-contract jobs and cached results fail closed; mismatched deck/format refused', async () => {
  const { added } = await queue('view', 'pptx');
  for (const data of [
    { ...added[0].data, exportAccess: undefined },
    { ...added[0].data, presentationId: 'different' },
    { ...added[0].data, format: 'notes-md' },
  ])
    await assert.rejects(queuedContext(data), { statusCode: 403 });
  storeExportResult('old-b769', {
    ownerEmail: READ_EMAILS.owner,
    buffer: Buffer.from(PRIVATE_MARKERS[0]),
    extension: '.pptx',
  });
  const ctx = context('/api/jobs/export-old-b769/download', 'owner');
  await handleJobs(ctx);
  assert.equal(ctx.res.statusCode, 403);
});

function streamRes() {
  const res = new EventEmitter();
  return Object.assign(res, {
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
}
test('real streamed PNG uses the reader projection and rechecks revocation at download', async () => {
  const res = streamRes();
  const ctx = context(
    `/api/presentations/${fixture.deckId}/export/png.zip/stream`,
    'view',
    res,
  );
  ctx.req = Readable.from([]);
  ctx.req.method = 'GET';
  ctx.req.headers = {};
  await handleExports(ctx);
  assert.equal(res.statusCode, 200);
  const frames = res.chunks.join('');
  const complete = /event: complete\ndata: (.+)/.exec(frames);
  assert.ok(complete, frames);
  const { downloadUrl } = JSON.parse(complete[1]);
  const id = downloadUrl.match(/export-(.+)\/download/)[1];
  const zip = await JSZip.loadAsync(getExportResult(id).buffer);
  // Six reader slides, less the two the export context drops: the draft and
  // the `hideInExport` slide (B590 closed that leak in the PNG ZIP).
  assert.equal(
    Object.keys(zip.files).filter((n) => /\.png$/.test(n)).length,
    4,
  );
  await removeCollaborator(fixture.scope, fixture.deckId, READ_EMAILS.view);
  const download = context(downloadUrl, 'view');
  await handleJobs(download);
  assert.equal(download.res.statusCode, 403);
});

test('real PPTX/handoff, PDF/print and PNG omit hidden slides; nested notes/XML contain no private markers', async () => {
  for (const endpoint of [
    'pptx?sync=1',
    'handoff.zip?sync=1',
    'pdf',
    'pdf-slides.pdf',
    'png/1.png',
  ]) {
    const res = await request(
      `/api/presentations/${fixture.deckId}/export/${endpoint}`,
      'view',
    );
    assert.equal(res.statusCode, 200, String(res.body));
    if (endpoint.startsWith('pptx') || endpoint.startsWith('handoff')) {
      const zip = await JSZip.loadAsync(res.body);
      async function scan(archive) {
        for (const file of Object.values(archive.files)) {
          if (file.dir) continue;
          if (/\.(pptx|docx)$/.test(file.name))
            await scan(await JSZip.loadAsync(await file.async('nodebuffer')));
          else if (/\.pdf$/.test(file.name))
            await safePdf(await file.async('nodebuffer'));
          else if (/\.(xml|md|html)$/.test(file.name))
            safeBytes(await file.async('string'));
        }
      }
      await scan(zip);
      // Not the draft or the `hideInExport` slide either (B590).
      if (endpoint.startsWith('pptx'))
        assert.equal(
          Object.keys(zip.files).filter((n) =>
            /^ppt\/slides\/slide\d+\.xml$/.test(n),
          ).length,
          4,
        );
    } else if (endpoint === 'pdf') {
      safeBytes(res.body);
      assert.ok(String(res.body).includes('VISIBLE-B769'));
    } else if (endpoint === 'pdf-slides.pdf') {
      await safePdf(res.body);
      assert.equal(Buffer.from(res.body).subarray(0, 4).toString(), '%PDF');
    } else assert.equal(Buffer.from(res.body).subarray(1, 4).toString(), 'PNG');
  }
});

test('completed job status rechecks artifact rights and never offers another actor a result', async () => {
  const ctx = await prepare('edit', 'html');
  const id = crypto.randomUUID();
  storeExportResult(id, {
    buffer: Buffer.from('author artifact'),
    ownerEmail: READ_EMAILS.edit,
    exportAccess: ctx.exportAccess,
  });
  __setTestQueues({
    export: {
      async getJob() {
        return {
          id,
          getState: async () => 'completed',
          returnvalue: { ready: true },
        };
      },
    },
  });
  const before = context(`/api/jobs/export-${id}`, 'edit');
  await handleJobs(before);
  assert.equal(before.res.statusCode, 200);
  assert.ok(before.res.json().downloadUrl);
  await updateCollaboratorPermission(
    fixture.scope,
    fixture.deckId,
    READ_EMAILS.edit,
    'view',
  );
  for (const role of ['edit', 'view']) {
    const response = context(`/api/jobs/export-${id}`, role);
    await handleJobs(response);
    assert.equal(response.res.statusCode, role === 'edit' ? 403 : 404);
    assert.equal(response.res.json().downloadUrl, undefined);
  }
});

test('authors retain standalone notes downloads; reader jobs never acquire notes through promotion', async () => {
  for (const role of ['owner', 'edit']) {
    const res = await request(
      `/api/presentations/${fixture.deckId}/export/notes.md`,
      role,
    );
    assert.equal(res.statusCode, 200);
    assert.ok(String(res.body).includes(PRIVATE_MARKERS[0]));
  }
  const ctx = await prepare('view', 'html');
  await updateCollaboratorPermission(
    fixture.scope,
    fixture.deckId,
    READ_EMAILS.view,
    'edit',
  );
  await assert.rejects(
    queuedContext({
      presentationId: fixture.deckId,
      format: 'notes-md',
      exportAccess: { ...ctx.exportAccess, format: 'notes-md' },
    }),
    { statusCode: 403 },
  );
});

for (const role of ['owner', 'edit', 'view', 'comment']) {
  test(`${role}: v1 print/PPTX use the same audience with an export-only key`, async () => {
    for (const format of ['pdf', 'pptx-editable']) {
      const ctx = context(
        `/api/v1/presentations/${fixture.deckId}/export/${format}?lang=en-GB`,
        role,
      );
      ctx.apiKey.permissions = ['export'];
      await handleV1Exports(ctx);
      assert.equal(ctx.res.statusCode, 200, String(ctx.res.body));
      let text = String(ctx.res.body);
      if (format === 'pptx-editable') {
        const zip = await JSZip.loadAsync(ctx.res.body);
        text = (
          await Promise.all(
            Object.values(zip.files)
              .filter((f) => !f.dir && /\.xml$/.test(f.name))
              .map((f) => f.async('string')),
          )
        ).join('');
      }
      if (['view', 'comment'].includes(role)) safeBytes(text);
      else if (format === 'pptx-editable')
        assert.ok(text.includes(PRIVATE_MARKERS[0]));
      assert.ok(text.includes('VISIBLE-B769'));
    }
  });
}
