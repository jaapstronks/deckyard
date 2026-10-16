/**
 * The shared browser remembers success, not failure (B714).
 *
 * `getPuppeteerBrowser()` used to cache its launch promise for the process
 * lifetime, rejected or not: one failed launch, or a Chrome that was killed
 * after the first export, answered every PDF, PNG and PPTX export with a
 * `500` in 0 ms until the server restarted. These tests drive a real launch
 * through a stub binary that counts its starts (and fails the first one when
 * asked), then `exec`s the real browser, so "the next call launches again" is
 * measured in launches, not assumed.
 *
 * Skips locally when no browser is installed, like `export-chrome-smoke`;
 * never in CI.
 *
 * Run with: node --test tests/puppeteer-browser-recovery.test.js
 */

import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const {
  BROWSER_UNAVAILABLE_MESSAGE,
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

// Resolved before any test points PUPPETEER_EXECUTABLE_PATH at a stub.
const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'deckyard-b714-'));
const savedEnv = {
  PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
  CHROME_BIN: process.env.CHROME_BIN,
  EXPORT_BROWSER_LAUNCH_TIMEOUT_MS:
    process.env.EXPORT_BROWSER_LAUNCH_TIMEOUT_MS,
};

/** Shell-quote one value for the stub script. */
function sq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Write a stub browser and point the helper at it.
 *
 * Every start appends a line to its counter file. `failFirst` makes the first
 * start exit 1 (the shape of a binary that is briefly broken); `hang` makes
 * every start sleep instead of opening DevTools. Otherwise it `exec`s the real
 * browser, so the pid Puppeteer holds is Chrome's own.
 *
 * @param {string} name
 * @param {{ failFirst?: boolean, failAlways?: boolean, hang?: boolean }} [mode]
 * @returns {{ launches: () => number }}
 */
function useStubBrowser(
  name,
  { failFirst = false, failAlways = false, hang = false } = {},
) {
  const counter = path.join(scratch, `${name}.count`);
  const stub = path.join(scratch, name);
  writeFileSync(counter, '');
  const body = [
    '#!/bin/sh',
    `echo start >> ${sq(counter)}`,
    failAlways ? 'exit 1' : '',
    failFirst
      ? `[ "$(wc -l < ${sq(counter)} | tr -d ' ')" = 1 ] && exit 1`
      : '',
    hang ? 'exec sleep 30' : '',
    `exec ${sq(chromePath)} "$@"`,
    '',
  ];
  writeFileSync(stub, body.join('\n'));
  chmodSync(stub, 0o755);
  process.env.PUPPETEER_EXECUTABLE_PATH = stub;
  delete process.env.CHROME_BIN;
  return {
    launches: () =>
      readFileSync(counter, 'utf8').split('\n').filter(Boolean).length,
  };
}

/** Kill the browser's process and wait until the helper has seen it go. */
async function killBrowser(browser) {
  const gone = once(browser, 'disconnected');
  browser.process().kill('SIGKILL');
  await gone;
}

afterEach(async () => {
  // Each test owns the shared browser; none may leak into the next.
  await closePuppeteerBrowser();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test(
  'a launch that fails once is tried again on the next call',
  { skip },
  async () => {
    const stub = useStubBrowser('fail-once', { failFirst: true });

    await assert.rejects(getPuppeteerBrowser(), (err) => {
      assert.equal(err.code, 'browser_unavailable');
      assert.equal(err.statusCode, 503);
      assert.equal(err.message, BROWSER_UNAVAILABLE_MESSAGE);
      assert.match(
        String(err.cause?.message),
        /Failed to launch/,
        'the real launch error rides along as the cause',
      );
      return true;
    });

    const browser = await getPuppeteerBrowser();
    assert.match(await browser.version(), /Chrome/);
    assert.equal(stub.launches(), 2);

    // And a success is remembered: no third launch.
    assert.equal(await getPuppeteerBrowser(), browser);
    assert.equal(stub.launches(), 2);
  },
);

test(
  'a browser that was killed is replaced on the next call',
  { skip },
  async () => {
    const stub = useStubBrowser('kill');
    const first = await getPuppeteerBrowser();
    await killBrowser(first);

    const second = await getPuppeteerBrowser();
    assert.notEqual(second, first);
    assert.equal(second.connected, true);
    assert.equal(stub.launches(), 2);
    const page = await second.newPage();
    await page.close();
  },
);

test(
  'a launch that hangs fails after EXPORT_BROWSER_LAUNCH_TIMEOUT_MS',
  { skip },
  async () => {
    const stub = useStubBrowser('hang', { hang: true });
    process.env.EXPORT_BROWSER_LAUNCH_TIMEOUT_MS = '500';
    const started = Date.now();
    await assert.rejects(getPuppeteerBrowser(), (err) => {
      assert.equal(err.code, 'browser_unavailable');
      assert.match(String(err.cause?.message), /Timed out after 500 ms/);
      return true;
    });
    // Puppeteer then gives the stub its own 5 s grace before the kill, which
    // is what this file's run time is mostly made of.
    assert.ok(Date.now() - started < 10_000, 'the cap, not the 30 s default');
    assert.equal(stub.launches(), 1);
  },
);

// ── the route ──────────────────────────────────────────────────────────────

let brandSeed;

/** A one-slide deck over the database double, owned by OWNER. */
async function seedDeck() {
  brandSeed ??= await brandSeedRow();
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [brandSeed],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
  return createPresentation(testScope(process.cwd()), {
    title: 'Recovery deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [{ type: 'title-slide', content: { title: 'Back again' } }],
  });
}

/** Call the export dispatcher for `pathname` and return the response double. */
async function exportAs(pathname) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = {};
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
  await handleExports({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd(), { actorEmail: OWNER }),
    req,
    res,
    url: new URL(pathname, 'http://localhost'),
    authedUser: { id: userIdFor(OWNER), email: OWNER, organizationId: ORG },
  });
  return res;
}

test(
  'the PDF export answers 200 again after the browser was killed',
  { skip },
  async (t) => {
    t.after(() => __setTestDb(null));
    const stub = useStubBrowser('route-kill');
    const pres = await seedDeck();
    const pdfPath = `/api/presentations/${pres.id}/export/pdf-slides.pdf?sync=1`;

    const before = await exportAs(pdfPath);
    assert.equal(before.statusCode, 200);
    assert.equal(Buffer.from(before.body).subarray(0, 4).toString(), '%PDF');

    await killBrowser(await getPuppeteerBrowser());

    const afterKill = await exportAs(pdfPath);
    assert.equal(afterKill.statusCode, 200);
    assert.equal(Buffer.from(afterKill.body).subarray(0, 4).toString(), '%PDF');
    assert.equal(stub.launches(), 2);
  },
);

test(
  'a browser that does not start answers 503 browser_unavailable, not the launch log',
  { skip },
  async (t) => {
    t.after(() => __setTestDb(null));
    useStubBrowser('route-broken', { failAlways: true });
    const pres = await seedDeck();

    const res = await exportAs(
      `/api/presentations/${pres.id}/export/pdf-slides.pdf?sync=1`,
    );
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, {
      ok: false,
      error: 'browser_unavailable',
      message: BROWSER_UNAVAILABLE_MESSAGE,
    });
  },
);
