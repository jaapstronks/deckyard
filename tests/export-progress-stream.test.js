/**
 * A Chrome export reports its progress and stops when its client leaves
 * (B716).
 *
 * The file routes (`export/png.zip`, `export/pptx`, …) answer with the file:
 * a minute of nothing for a 54-slide deck, and a render that runs on when the
 * user gave up. Each now has a streamed twin at `…/stream`
 * (`createExportStreamRoute`): `status` events on the export ladder, one per
 * rendered slide, then `complete {downloadUrl}`, the file held for exactly
 * one download by its owner. Closing the stream aborts the builder before the
 * next slide, and the log says how far it got.
 *
 * The ladder and the cancel are pinned with a builder double, so they hold
 * without a browser; the PNG ZIP through real Chrome checks that the builders
 * themselves report and stop. Those skip locally when no browser is
 * installed, never in CI.
 *
 * Run with: node --test tests/export-progress-stream.test.js
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

const {
  closePuppeteerBrowser,
  getPuppeteerBrowser,
  resolveChromeExecutablePath,
} = await import('../server/utils/puppeteer-browser.js');
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { handleExports } = await import('../server/routes/api/export.js');
const { handleJobs } = await import('../server/routes/api/jobs.js');
const { createExportRoute, createExportStreamRoute } =
  await import('../server/export/pipeline.js');
const { EXPORT_PROGRESS, exportStatus, progressCounter } =
  await import('../server/export/progress.js');
const { dispatchRoutes } = await import('../server/utils/router.js');

const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const noBrowser =
  (await resolveChromeExecutablePath()) || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

afterEach(async () => {
  __setTestDb(null);
  await closePuppeteerBrowser();
});

/** A deck of `count` title slides over the database double, owned by OWNER. */
async function seedDeck(count) {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [await brandSeedRow()],
      users: [...userRows(OWNER), ...userRows(OTHER)],
    }),
  );
  await initializeStorage();
  return createPresentation(testScope(process.cwd()), {
    title: 'Stream deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: Array.from({ length: count }, (_, i) => ({
      type: 'title-slide',
      content: { title: `Slide ${i + 1}` },
    })),
  });
}

/**
 * A response double that records an event stream. `closeWhen(event)` decides,
 * per parsed event, whether the client leaves right then: `close` fires
 * synchronously inside that write, as a dropped connection would before the
 * next one.
 */
function streamResponse({ closeWhen = () => false } = {}) {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: null,
    headers: {},
    chunks: [],
    writable: true,
    writableEnded: false,
    writableFinished: false,
    destroyed: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    flushHeaders() {},
    write(chunk) {
      this.chunks.push(String(chunk));
      const [event] = parseEvents(String(chunk));
      if (event && closeWhen(event)) {
        this.writable = false;
        this.destroyed = true;
        this.emit('close');
      }
      return true;
    },
    end(payload) {
      if (payload != null) this.chunks.push(payload);
      this.writableEnded = true;
      this.writableFinished = true;
      this.emit('close');
    },
  });
  return res;
}

/** The `event:`/`data:` frames in a stream body, parsed. */
function parseEvents(text) {
  const events = [];
  for (const frame of text.split('\n\n')) {
    const name = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (name)
      events.push({ event: name, data: data ? JSON.parse(data) : null });
  }
  return events;
}

/** The request context as the API dispatcher builds it, for `email`. */
function contextFor(pathname, res, email = OWNER) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = {};
  return {
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd(), { actorEmail: email }),
    req,
    res,
    url: new URL(pathname, 'http://localhost'),
    authedUser: { id: userIdFor(email), email, organizationId: ORG },
  };
}

/**
 * Capture the `[export]` info lines while `fn` runs; pass `errors` to collect
 * the `console.error` lines there too.
 */
async function captureLog(fn, errors = null) {
  const lines = [];
  const original = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  if (errors) console.error = (...args) => errors.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
    console.error = originalError;
  }
  return lines;
}

/** A builder double: 54 slides, one tick each, honouring the signal. */
const fiftyFourSlides = {
  format: 'png-zip',
  pattern: /^\/api\/presentations\/([^/]+)\/export\/png\.zip$/,
  contentType: 'application/zip',
  extension: '-png.zip',
  buildContent: async (ctx, { onProgress, signal }) => {
    const rendered = progressCounter(onProgress, 54);
    for (let i = 0; i < 54; i += 1) {
      signal.throwIfAborted();
      await new Promise((r) => setImmediate(r));
      rendered();
    }
    return Buffer.from('PK-double');
  },
};

test('the export ladder only climbs, one step per slide, and packs at the end', () => {
  let previous = 0;
  for (let done = 0; done <= 54; done += 1) {
    const status = exportStatus({ done, total: 54 });
    assert.ok(status.progress >= previous, `step ${done} does not walk back`);
    assert.ok(status.progress >= EXPORT_PROGRESS.renderFloor);
    previous = status.progress;
  }
  assert.equal(exportStatus({ done: 12, total: 54 }).phase, 'render');
  assert.equal(exportStatus({ done: 54, total: 54 }).phase, 'pack');
  assert.equal(
    exportStatus({ done: 54, total: 54 }).progress,
    EXPORT_PROGRESS.pack,
  );
  assert.equal(exportStatus({ done: 3, total: 7, unit: 'step' }).unit, 'step');
});

test('a streamed export reports slide 12 of 54 and completes with a download URL', async () => {
  const pres = await seedDeck(1);
  const route = createExportStreamRoute(fiftyFourSlides);
  const res = streamResponse();

  await dispatchRoutes(
    [route],
    contextFor(`/api/presentations/${pres.id}/export/png.zip/stream`, res),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  const events = parseEvents(res.chunks.join(''));
  const statuses = events
    .filter((e) => e.event === 'status')
    .map((e) => e.data);
  assert.equal(statuses[0].phase, 'start');
  assert.ok(
    statuses.some((s) => s.done === 12 && s.total === 54 && s.unit === 'slide'),
    'slide 12 of 54 is reported',
  );
  const bars = statuses.map((s) => s.progress);
  assert.deepEqual(
    bars,
    [...bars].sort((a, b) => a - b),
    'the bar never walks back',
  );
  const complete = events.find((e) => e.event === 'complete');
  assert.match(
    complete.data.downloadUrl,
    /^\/api\/jobs\/export-stream-[\w-]+\/download$/,
  );
  assert.ok(res.writableEnded, 'the stream is closed');
});

test('closing the stream after slide 3 stops the export and logs how far it got', async () => {
  const pres = await seedDeck(1);
  const route = createExportStreamRoute(fiftyFourSlides);
  const res = streamResponse({
    closeWhen: (e) => e.event === 'status' && e.data.done === 3,
  });

  const lines = await captureLog(() =>
    dispatchRoutes(
      [route],
      contextFor(`/api/presentations/${pres.id}/export/png.zip/stream`, res),
    ),
  );

  const events = parseEvents(res.chunks.join(''));
  assert.equal(
    Math.max(
      ...events
        .filter((e) => e.event === 'status')
        .map((e) => e.data.done ?? 0),
    ),
    3,
    'no slide after the third',
  );
  assert.equal(
    events.find((e) => e.event === 'complete'),
    undefined,
  );
  assert.equal(
    events.find((e) => e.event === 'error'),
    undefined,
    'a cancel is not a failure',
  );
  assert.ok(
    lines.some(
      (l) =>
        l.includes('[export]') &&
        l.includes('png-zip export cancelled after 3/54'),
    ),
    `logged: ${lines.join(' | ')}`,
  );
});

test('a client that leaves a file export is a cancel: no error line, no answer', async () => {
  const pres = await seedDeck(1);
  const res = streamResponse();
  const route = createExportRoute({
    ...fiftyFourSlides,
    buildContent: async (ctx, { signal }) => {
      // The client leaves mid-render.
      res.destroyed = true;
      res.writable = false;
      res.emit('close');
      await new Promise((r) => setImmediate(r));
      signal.throwIfAborted();
      return Buffer.from('PK-double');
    },
  });

  const errors = [];
  const lines = await captureLog(
    () =>
      dispatchRoutes(
        [route],
        contextFor(`/api/presentations/${pres.id}/export/png.zip`, res),
      ),
    errors,
  );

  assert.deepEqual(errors, [], 'no [ERROR] line for a closed tab');
  assert.equal(res.statusCode, null, 'no status written');
  assert.deepEqual(res.chunks, [], 'no body written');
  assert.ok(
    lines.some(
      (l) =>
        l.includes('[export]') &&
        l.includes('png-zip export cancelled by the client'),
    ),
    `logged: ${lines.join(' | ')}`,
  );
});

test('a refusal before the work starts is the JSON envelope, not a stream', async () => {
  await seedDeck(1);
  const route = createExportStreamRoute(fiftyFourSlides);
  const res = streamResponse();
  await dispatchRoutes(
    [route],
    contextFor(
      '/api/presentations/00000000-0000-4000-8000-00000000dead/export/png.zip/stream',
      res,
    ),
  );
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.chunks.join('')).error, 'not_found');
});

test(
  'the PNG ZIP streams through Chrome; its file is downloaded once, by its owner',
  { skip: noBrowser },
  async () => {
    const pres = await seedDeck(3);
    const res = streamResponse();
    await handleExports(
      contextFor(`/api/presentations/${pres.id}/export/png.zip/stream`, res),
    );
    const events = parseEvents(res.chunks.join(''));
    const counted = events
      .filter((e) => e.event === 'status' && e.data.done)
      .map((e) => `${e.data.done}/${e.data.total}`);
    assert.deepEqual(counted, ['1/3', '2/3', '3/3']);
    const { downloadUrl } = events.find((e) => e.event === 'complete').data;

    const stranger = streamResponse();
    await handleJobs(contextFor(downloadUrl, stranger, OTHER));
    assert.equal(stranger.statusCode, 404, 'not for another user');

    const owner = streamResponse();
    await handleJobs(contextFor(downloadUrl, owner));
    assert.equal(owner.statusCode, 200);
    assert.match(owner.headers['Content-Disposition'], /-png\.zip"$/);
    assert.equal(
      Buffer.from(owner.chunks.at(-1)).subarray(0, 2).toString(),
      'PK',
    );

    const again = streamResponse();
    await handleJobs(contextFor(downloadUrl, again));
    assert.equal(
      again.statusCode,
      404,
      'a streamed file is taken by its one download',
    );
  },
);

test(
  'a cancelled PNG ZIP opens no page after the slide it was on',
  { skip: noBrowser },
  async () => {
    const pres = await seedDeck(6);
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    let pages = 0;
    const newPage = browser.newPage.bind(browser);
    browser.newPage = () => {
      pages += 1;
      return newPage();
    };
    // A slide can take more than one page (the image measurement opens one),
    // so the count is taken at the moment the client leaves.
    let pagesAtCancel = null;
    const res = streamResponse({
      closeWhen: (e) => {
        if (e.event !== 'status' || e.data.done !== 3) return false;
        pagesAtCancel = pages;
        return true;
      },
    });

    const lines = await captureLog(() =>
      handleExports(
        contextFor(`/api/presentations/${pres.id}/export/png.zip/stream`, res),
      ),
    );

    assert.ok(pagesAtCancel > 0);
    assert.equal(pages, pagesAtCancel, 'no page opened after the cancel');
    assert.ok(
      lines.some((l) => l.includes('png-zip export cancelled after 3/6')),
      `logged: ${lines.join(' | ')}`,
    );
  },
);

test(
  'an abort while the page is being opened still stops the slide',
  { skip: noBrowser },
  async () => {
    // Found on dev: the client left while `newPage()` ran, the abort listener
    // was added after the abort, never fired, and the slide rendered anyway
    // ("cancelled after 4/54" for a cancel at 3).
    const { renderSlideToPngBuffer } = await import('../server/render/png.js');
    const browser = await getPuppeteerBrowser({ featureName: 'test' });
    const controller = new AbortController();
    const newPage = browser.newPage.bind(browser);
    let opened = null;
    browser.newPage = async () => {
      opened = await newPage();
      controller.abort();
      return opened;
    };
    try {
      await assert.rejects(
        renderSlideToPngBuffer(
          process.cwd(),
          { type: 'title-slide', content: { title: 'Never' } },
          { signal: controller.signal },
        ),
        { name: 'AbortError' },
      );
      assert.equal(opened.isClosed(), true, 'the page it opened is closed');
    } finally {
      browser.newPage = newPage;
    }
  },
);
