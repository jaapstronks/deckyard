/**
 * The editor topbar fits at every width with collaborators in the deck (B362).
 *
 * The collab avatar stack used to hang in `.topbar-spacer`, outside the fold
 * ladder: on a 341px phone two peers covered the title and five pushed the
 * stack 24px off-screen. `tests/topbar-fold-ladder.test.js` pins the ladder's
 * shape from source, but a width budget can only be checked in a browser, and
 * only by geometry: `.topbar-spacer` collapsed to 0 and the stack overflowed
 * its parent while `scrollWidth - clientWidth` stayed 0, so the usual
 * overflow measurement never saw the defect.
 *
 * So this boots the real editor in Chrome, draws peers into the bar's
 * presence slot with the real presence UI, and walks both edges of every band
 * on the ladder. At each width, with 1, 5 and 104 peers:
 *
 * 1. no rendered descendant of `.topbar` crosses a viewport edge,
 * 2. no child of the bar reaches into the bar's side padding - the gutter is
 *    part of the budget, and a bar that spends it still "fits" the viewport
 *    while its last control sits flush against a phone's edge, and
 * 3. no child of the bar overlaps the next one.
 *
 * The presence session is a stand-in (the test server runs no collab
 * backend); what is under test is the bar's layout, not the transport.
 *
 * Requires Chrome; skips locally without one and fails under CI, like
 * tests/viewer-chrome-smoke.test.js, whose server setup this mirrors.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { resolveChromeExecutablePath } =
  await import('../server/utils/puppeteer-browser.js');

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

/**
 * Both edges of every band on the ladder (see "Topbar Responsive" in
 * client/styles/base/01-core/10-shell-topbar-dropdown.css). The low edge is
 * where a band is tightest; the high edge is one pixel before the next rung
 * brings a control back.
 */
const WIDTHS = [341, 480, 481, 640, 641, 768, 769, 1024, 1025, 1280, 1281];

/** One peer (no chip), five (the most avatars; capped, +4), and a +103. */
const PEER_COUNTS = [1, 5, 104];

let ctx = null;

before(async () => {
  if (skip) return;

  const { createFakeDb } = await import('./helpers/fake-db.js');
  const { __setTestDb } = await import('../server/db/client.js');
  const { initializeStorage, __resetStorageForTests } =
    await import('../server/storage/lifecycle.js');
  const { createPresentation } =
    await import('../server/storage/presentations/index.js');
  const { testScope } = await import('./helpers/storage-scope.js');
  const { handleApi } = await import('../server/routes/api/index.js');
  const { handleStatic } = await import('../server/routes/static/index.js');
  const { CLIENT_DIR, SHARED_PUBLIC_DIRS, repoRoot } =
    await import('../server/config/paths.js');
  const { applySecurityHeaders } =
    await import('../server/utils/security-headers.js');

  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();

  // A long title, so the title chip sits at its minimum wherever the band
  // squeezes it - the state the ladder's floors are measured in.
  const deck = await createPresentation(testScope(), {
    title: 'A deck title long enough to be squeezed at every width',
    ownerEmail: 'owner@example.com',
    slides: [{ type: 'title-slide', content: { title: 'One' } }],
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || '/',
        `http://${req.headers.host || 'localhost'}`,
      );
      applySecurityHeaders(req, res, url.pathname);
      if (url.pathname.startsWith('/api/')) {
        return await handleApi({ repoRoot, req, res, url });
      }
      return await handleStatic({
        repoRoot,
        req,
        res,
        url,
        clientDir: CLIENT_DIR,
        sharedPublicDirs: SHARED_PUBLIC_DIRS,
      });
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('server error');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  ctx = {
    base: `http://127.0.0.1:${server.address().port}`,
    server,
    browser,
    deck,
    __resetStorageForTests,
    __setTestDb,
  };
});

after(async () => {
  if (!ctx) return;
  await ctx.browser.close().catch(() => {});
  await new Promise((resolve) => ctx.server.close(resolve));
  ctx.__resetStorageForTests();
  ctx.__setTestDb(null);
});

test(
  'no topbar element crosses the viewport or its neighbour, with peers, at any band edge',
  { skip },
  async () => {
    const page = await ctx.browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
    try {
      await page.setViewport({ width: WIDTHS[0], height: 800 });
      await page.goto(`${ctx.base}/app/${ctx.deck.id}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('.topbar .topbar-presence', {
        timeout: 15000,
      });

      // Mount the real presence UI on the bar's slot. `setPresenceNames` is
      // the topbar's: here it only has to show the slot, which is all the
      // layout depends on.
      await page.evaluate(async (moduleUrl) => {
        const { createPresenceUI } = await import(moduleUrl);
        const slot = document.querySelector('.topbar-presence');
        let notify = () => {};
        window.__peers = [];
        createPresenceUI({
          session: {
            getPeers: () => window.__peers,
            onPeersChange: (fn) => {
              notify = fn;
              return () => {};
            },
            setFocusField() {},
          },
          presenceSlot: slot,
          setPresenceNames: (names) => {
            slot.style.display = names.length ? '' : 'none';
          },
          getSelectedSlideId: () => null,
        });
        window.__setPeers = (n) => {
          window.__peers = Array.from({ length: n }, (_, k) => ({
            user: {
              id: `u${k}`,
              email: `peer${k}@example.com`,
              name: `Peer ${k}`,
              color: `hsl(${(k * 47) % 360} 70% 45%)`,
            },
          }));
          notify();
          return new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
        };
      }, '/client/views/editor/presence/presence-ui.js');

      const failures = [];
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        for (const peers of PEER_COUNTS) {
          await page.evaluate((n) => window.__setPeers(n), peers);
          const found = await page.evaluate(measureTopbar);
          for (const f of found)
            failures.push(`${width}px, ${peers} peers: ${f}`);
        }
      }

      assert.deepEqual(failures, [], 'the topbar must fit at every band edge');
      assert.deepEqual(pageErrors, [], 'the editor must not throw');
    } finally {
      await page.close();
    }
  },
);

/**
 * Runs in the page. Every rendered descendant of the bar must sit inside the
 * viewport; every rendered child inside the bar's content box, and ending
 * before the next one starts. Closed menus render nothing, so their items have
 * no box and drop out.
 *
 * @returns {string[]} one line per violation
 */
function measureTopbar() {
  const bar = document.querySelector('.topbar');
  const vw = document.documentElement.clientWidth;
  const EPS = 0.5;
  const name = (el) =>
    `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`;
  const rendered = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const out = [];
  for (const el of bar.querySelectorAll('*')) {
    if (!rendered(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -EPS || r.right > vw + EPS) {
      out.push(
        `${name(el)} spans ${r.left.toFixed(1)}-${r.right.toFixed(1)}, viewport is 0-${vw}`,
      );
    }
  }
  const children = [...bar.children].filter(rendered);
  const box = bar.getBoundingClientRect();
  const style = getComputedStyle(bar);
  const from = box.left + parseFloat(style.paddingLeft);
  const to = box.right - parseFloat(style.paddingRight);
  for (const el of children) {
    const r = el.getBoundingClientRect();
    if (r.left < from - EPS || r.right > to + EPS) {
      out.push(
        `${name(el)} spans ${r.left.toFixed(1)}-${r.right.toFixed(1)}, the bar's content box is ${from.toFixed(1)}-${to.toFixed(1)}`,
      );
    }
  }
  for (let i = 0; i + 1 < children.length; i += 1) {
    const a = children[i].getBoundingClientRect();
    const b = children[i + 1].getBoundingClientRect();
    if (a.right > b.left + EPS) {
      out.push(
        `${name(children[i])} overlaps ${name(children[i + 1])} by ${(a.right - b.left).toFixed(1)}px`,
      );
    }
  }
  return out;
}
