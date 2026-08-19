/**
 * Viewer smoke test — the second test in the suite that starts a real browser
 * (the first is tests/export-chrome-smoke.test.js), and the only one that boots
 * the HTTP request pipeline and drives the client app in Chrome.
 *
 * Why this exists (docs/plans/TODO.md B83 / decision D32): the whole anonymous
 * viewer surface — the published public deck, the share-link viewer, and the
 * presenter/follow live coupling — renders client-side. Every unit test in the
 * suite exercises the *handlers*, so a route can answer 200 with a perfectly
 * good app shell while the client bundle throws on boot and the audience stares
 * at a white screen. That failure mode is invisible to an HTTP-level assertion;
 * #275 taught the same lesson for export. This is the gate that makes "the
 * viewer routes are green" mean "the deck actually painted".
 *
 * What it covers — one thin pass per anonymous route, asserting the deck
 * *rendered* (a real `.slide` with the seeded slide text), not merely that the
 * server answered:
 *   - the published public viewer            (/p/:id-:slug, server-rendered)
 *   - the share-link viewer WITH a token     (/s/:token → the deck)
 *   - the share-link viewer WITHOUT a valid token (/s/:bogus → an error card,
 *     never a blank page and never a leaked deck)
 *   - the presenter view                     (/present/:id → the stage renders)
 *   - the follow (audience) view coupled to the presenter's live session
 *     (/follow/:id → the presenter's current slide, and it *tracks* a slide
 *     change pushed onto the live session — the presenter↔follow contract)
 *
 * What it deliberately does NOT cover: it is a smoke, not a 77-module client
 * unit sweep (D32 rejected that). It does not assert pixels, styling, or the
 * presenter's own keyboard-driven state posting behind the fullscreen start
 * curtain — the coupling is driven through the live-session state seam that the
 * presenter posts to and the follow view reads, which is deterministic in
 * headless Chrome. Real-time SSE transport and CRDT convergence have their own
 * tests (tests/collab-*.test.js).
 *
 * Runs in-process against the in-memory database double (as the collab and
 * anon-surface tests do), with a bare HTTP server wired to the real
 * handleApi/handleStatic pipeline — the same two handlers server.js dispatches
 * to. Requires a Chrome/Chromium binary; like the export smoke it skips locally
 * when none is installed but is a hard failure under CI, where a missing
 * browser is exactly the regression it guards. CI already provisions Chrome for
 * the `test` job (.github/workflows/ci.yml), and `npm test` globs this file in,
 * so it runs alongside tests/export-chrome-smoke.test.js with no extra wiring.
 *
 * Run with: node --test tests/viewer-chrome-smoke.test.js
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Anonymous-admin auth posture (no session), same as the collab/anon tests:
// the share token and the live follow code are the whole authorization.
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_SECRET;
delete process.env.AUTH_DEV_BYPASS;

const { resolveChromeExecutablePath } =
  await import('../server/utils/puppeteer-browser.js');

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/**
 * Skip locally when no browser is installed; never skip in CI, where the
 * absence of a browser is exactly the regression this file guards against.
 */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

const OWNER = 'owner@example.com';
const SLIDE_ONE = 'ALPHA-SLIDE-ONE';
const SLIDE_TWO = 'BRAVO-SLIDE-TWO';

// Populated by before(); left null when skipped.
let ctx = null;

before(async () => {
  if (skip) return;

  const { createFakeDb } = await import('./helpers/fake-db.js');
  const { __setTestDb } = await import('../server/db/client.js');
  const { initializeStorage, __resetStorageForTests } =
    await import('../server/storage/lifecycle.js');
  const { createPresentation } =
    await import('../server/storage/presentations/index.js');
  const { createShareLink } =
    await import('../server/storage/share-links/index.js');
  const { upsertPublishedEntry, newPublishId } =
    await import('../server/storage/published/index.js');
  const { createLiveSession, updateLiveSessionState } =
    await import('../server/storage/live-sessions/index.js');
  const { testScope } = await import('./helpers/storage-scope.js');
  const { handleApi } = await import('../server/routes/api.js');
  const { handleStatic } = await import('../server/routes/static.js');
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

  // A two-slide deck with distinct, greppable titles so an assertion can tell
  // "slide 1 rendered" from "slide 2 rendered" from "nothing rendered".
  const deck = await createPresentation(testScope(), {
    title: 'Smoke deck',
    ownerEmail: OWNER,
    slides: [
      {
        type: 'title-slide',
        content: { title: SLIDE_ONE, subheading: 'first' },
      },
      {
        type: 'title-slide',
        content: { title: SLIDE_TWO, subheading: 'second' },
      },
    ],
  });

  // Public viewer fixture: a published entry → /p/:id-:slug.
  const publishId = newPublishId();
  const published = await upsertPublishedEntry(testScope(), {
    publishId,
    presentationId: deck.id,
    title: deck.title,
  });

  // Share-viewer fixture: a view-permission share link → /s/:token.
  const share = await createShareLink(testScope(), deck.id, {
    permission: 'view',
  });
  const shareToken = share.token || share.shareLink?.token || share.link?.token;

  // Presenter↔follow fixture: a live session standing in for "the presenter is
  // live", pushed onto slide 1. The follow view reads this exact seam.
  const presenterScope = { repoRoot, organizationId: ORG };
  const session = await createLiveSession(
    { repoRoot, organizationId: ORG, actorEmail: null },
    { presentationId: deck.id },
  );
  const pushLiveSlide = (index) =>
    updateLiveSessionState(presenterScope, session.sessionId, {
      slideId: deck.slides[index].id,
      slideIndex: index,
      slideType: deck.slides[index].type,
      updatedAt: Date.now(),
    });
  await pushLiveSlide(0);

  // Mirror the server.js request pipeline: security headers, then /api/* to
  // handleApi and everything else to handleStatic. No jobs, no queues, no
  // top-level listen — just the two handlers under test.
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
  const base = `http://127.0.0.1:${server.address().port}`;

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
    base,
    server,
    browser,
    deck,
    publishPath: `/p/${published.publishId}-${published.slug}`,
    shareToken,
    pushLiveSlide,
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

/**
 * Open a viewer route in a fresh page, collecting any uncaught client
 * exceptions. A `pageerror` is the signature of the white-screen class: the
 * bundle threw on boot and never painted the deck.
 */
async function openViewer(path) {
  const page = await ctx.browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  // domcontentloaded, not networkidle: the follow/presenter views hold an SSE
  // stream open, so the network never goes idle and networkidle0 would hang.
  await page.goto(ctx.base + path, { waitUntil: 'domcontentloaded' });
  return { page, pageErrors };
}

/** True once a `.slide` whose text matches `re` has painted, within `timeout`. */
async function waitForSlideText(page, re, timeout = 10000) {
  await page.waitForFunction(
    (pattern) => {
      const el = document.querySelector('.slide');
      return !!el && new RegExp(pattern).test(el.textContent || '');
    },
    { timeout },
    re.source,
  );
}

test('the published public viewer renders the deck', { skip }, async () => {
  const { page, pageErrors } = await openViewer(ctx.publishPath);
  try {
    await waitForSlideText(page, new RegExp(SLIDE_ONE));
    const slideText = await page.$eval('.slide', (el) => el.textContent || '');
    assert.match(
      slideText,
      new RegExp(SLIDE_ONE),
      'slide 1 text should render',
    );
    assert.deepEqual(
      pageErrors,
      [],
      'the public viewer must not throw on boot',
    );
  } finally {
    await page.close();
  }
});

test(
  'the share viewer renders the deck for a valid token',
  { skip },
  async () => {
    const { page, pageErrors } = await openViewer(`/s/${ctx.shareToken}`);
    try {
      // The deck lives inside the share-viewer chrome — assert both, so a bare
      // `.slide` from some other view could never satisfy this.
      await page.waitForSelector('.share-viewer-slide', { timeout: 10000 });
      await waitForSlideText(page, new RegExp(SLIDE_ONE));
      const slideText = await page.$eval(
        '.share-viewer-slide .slide',
        (el) => el.textContent || '',
      );
      assert.match(
        slideText,
        new RegExp(SLIDE_ONE),
        'share viewer should paint the deck',
      );
      assert.deepEqual(
        pageErrors,
        [],
        'the share viewer must not throw on boot',
      );
    } finally {
      await page.close();
    }
  },
);

test(
  'the share viewer shows an error (not a white screen) for an unknown token',
  {
    skip,
  },
  async () => {
    const { page } = await openViewer('/s/this-token-does-not-exist');
    try {
      // The view must resolve to a visible error card, never a blank page and
      // never a leaked deck slide.
      const body = await page.waitForFunction(
        () => {
          const text = (document.body?.textContent || '').trim();
          return text.length > 0 ? text : false;
        },
        { timeout: 10000 },
      );
      const text = await body.jsonValue();
      assert.ok(
        text.length > 0,
        'an unknown token must not yield a blank page',
      );
      const hasSlide = await page.$('.slide');
      assert.equal(
        hasSlide,
        null,
        'no deck slide should render for an unknown token',
      );
      const hasErrorCard = await page.$('[class*="error"]');
      assert.ok(
        hasErrorCard,
        'an error card should render for an unknown token',
      );
    } finally {
      await page.close();
    }
  },
);

test('the presenter view renders the deck stage', { skip }, async () => {
  const { page, pageErrors } = await openViewer(`/present/${ctx.deck.id}`);
  try {
    await waitForSlideText(page, new RegExp(SLIDE_ONE));
    const slideText = await page.$eval('.slide', (el) => el.textContent || '');
    assert.match(
      slideText,
      new RegExp(SLIDE_ONE),
      'presenter should paint the deck',
    );
    assert.deepEqual(
      pageErrors,
      [],
      'the presenter view must not throw on boot',
    );
  } finally {
    await page.close();
  }
});

test(
  'the follow view mirrors the presenter live session and tracks slide changes',
  {
    skip,
  },
  async () => {
    const { page, pageErrors } = await openViewer(`/follow/${ctx.deck.id}`);
    try {
      // Coupling 1: the follow view shows the presenter's *current* live slide
      // (seeded on slide 1), not a default first slide of its own.
      await waitForSlideText(page, new RegExp(SLIDE_ONE));

      // Coupling 2: advance the presenter's live session onto slide 2. The follow
      // view must track it (via the SSE push, or the polling safety-net).
      await ctx.pushLiveSlide(1);
      await waitForSlideText(page, new RegExp(SLIDE_TWO));

      const slideText = await page.$eval(
        '.slide',
        (el) => el.textContent || '',
      );
      assert.match(
        slideText,
        new RegExp(SLIDE_TWO),
        'follow should track the presenter to slide 2',
      );
      assert.deepEqual(
        pageErrors,
        [],
        'the follow view must not throw on boot',
      );
    } finally {
      await page.close();
    }
  },
);
