/** B842: real views with paged read fixtures; no database writes.
 * Run against AUTH_DEV_BYPASS=true on 4277 with CHROME_BIN set.
 */
/* global document, getComputedStyle, NodeFilter, Range, process, URL, setTimeout, innerWidth, console */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const base = process.env.DECKYARD_URL || 'http://127.0.0.1:4277';
const output = process.env.B842_SCREENSHOTS || '.scratch/b842';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const deck = '00000000-0000-4000-8000-000000000842';
const calls = [];
const users = Array.from({ length: 4 }, (_, i) => ({
  id: `user-${i}`,
  email: `member-${i}@example.test`,
  name: `Test Member ${i}`,
  role: i === 0 ? 'admin' : 'user',
  hasPassword: false,
  invitationStatus: 'expired',
  lastLoginAt: null,
}));
const sessions = Array.from({ length: 4 }, (_, i) => ({
  id: `session-${i}`,
  deviceId: `browser-${i}`,
  viewerType: 'anonymous',
  sourceType: 'published',
  durationSeconds: 123,
  exitSlideIndex: 1,
  startedAt: new Date().toISOString(),
}));
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  let body;
  if (url.pathname === '/api/admin/users') {
    calls.push(url.pathname + url.search);
    body = url.searchParams.has('cursor')
      ? { users: users.slice(3), nextCursor: null }
      : { users: users.slice(0, 3), nextCursor: 'users-page-2' };
  } else if (url.pathname === `/api/presentations/${deck}`) {
    body = { id: deck, title: 'Layout verification', slides: [] };
  } else if (url.pathname === `/api/presentations/${deck}/analytics`) {
    body = {
      totalViews: 1234,
      uniqueViewers: 987,
      avgDurationSeconds: 123,
      completionRate: 0.75,
      viewsByDay: [],
      topSourceTypes: [],
    };
  } else if (url.pathname === `/api/presentations/${deck}/analytics/slides`) {
    body = { slides: [] };
  } else if (url.pathname === `/api/presentations/${deck}/analytics/sessions`) {
    calls.push(url.pathname + url.search);
    body = url.searchParams.has('cursor')
      ? { sessions: sessions.slice(3), nextCursor: null }
      : { sessions: sessions.slice(0, 3), nextCursor: 'sessions-page-2' };
  }
  if (body !== undefined) {
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  } else request.continue();
});

async function enlargeText() {
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll('body *')];
    const sizes = elements.map((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    // Double the rem-based UI scale too, including newly rendered pager rows.
    document.documentElement.style.fontSize = '200%';
    elements.forEach((el, i) =>
      el.style.setProperty('font-size', `${sizes[i] * 2}px`, 'important'),
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function measure(selector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const visible = (el) =>
      el.getBoundingClientRect().width > 0 &&
      el.getBoundingClientRect().height > 0;
    const buttons = [...root.querySelectorAll('button')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let text,
          clipped = false;
        while ((text = walker.nextNode())) {
          const range = new Range();
          range.selectNodeContents(text);
          for (const r of range.getClientRects()) {
            if (
              r.left < rect.left - 1 ||
              r.right > rect.right + 1 ||
              r.bottom > rect.bottom + 1
            )
              clipped = true;
          }
        }
        return {
          text: el.textContent.trim(),
          width: rect.width,
          height: rect.height,
          clipped,
          wordBreak: style.wordBreak,
          overflowWrap: style.overflowWrap,
          ellipsis: style.textOverflow === 'ellipsis',
        };
      });
    return {
      viewport: innerWidth,
      overflow: [...document.querySelectorAll('body *')]
        .filter(
          (el) =>
            visible(el) && el.getBoundingClientRect().right > innerWidth + 1,
        )
        .map((el) => ({
          className: el.className,
          text: el.textContent.slice(0, 80),
          width: el.getBoundingClientRect().width,
        })),
      scrollWidth: document.documentElement.scrollWidth,
      buttons,
    };
  }, selector);
}

const results = [];
try {
  const locales = (await readdir('client/i18n', { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const width of [1280, 390, 320]) {
    for (const locale of width === 320 ? locales : ['de']) {
      for (const kind of ['users', 'analytics']) {
        await page.setViewport({ width, height: 900 });
        await page.goto('about:blank');
        await page.goto(
          `${base}${kind === 'users' ? `/settings?locale=${locale}#users` : `/analytics/${deck}?locale=${locale}`}`,
          { waitUntil: 'networkidle2' },
        );
        const root =
          kind === 'users' ? '.admin-users-card' : '.analytics-shell';
        const row =
          kind === 'users'
            ? '.admin-user-card'
            : '.analytics-viewer-row:not(.analytics-viewer-header)';
        const pager =
          kind === 'users' ? '.list-pager-more' : '.analytics-load-more';
        await page.waitForSelector(row);
        if (width === 320) await enlargeText();
        const measurement = await measure(root);
        results.push({
          kind,
          width,
          locale,
          textScale: width === 320 ? 2 : 1,
          ...measurement,
        });
        if (measurement.scrollWidth > width + 1) {
          await page.screenshot({
            path: `${output}/failure.png`,
            fullPage: false,
          });
        }
        assert.ok(
          measurement.scrollWidth <= width + 1,
          `${kind}/${locale}/${width}: viewport overflow ${measurement.scrollWidth}`,
        );
        for (const button of measurement.buttons) {
          assert.ok(
            button.width >= 44 && button.height >= 44,
            `${kind}/${locale}: small target ${JSON.stringify(button)}`,
          );
          assert.ok(
            !button.clipped && !button.ellipsis,
            `${kind}/${locale}: clipped label ${button.text}`,
          );
          assert.ok(
            !['break-all', 'break-word'].includes(button.wordBreak) &&
              button.overflowWrap !== 'anywhere',
            `${kind}/${locale}: broken words ${button.text}`,
          );
        }
        if (locale === 'de')
          await page.screenshot({
            path: `${output}/${kind}-${width}.png`,
            fullPage: true,
          });
        const before = await page.$$eval(row, (els) => els.length);
        await page.click(pager);
        await page.waitForFunction(
          (selector, n) => document.querySelectorAll(selector).length === n + 1,
          {},
          row,
          before,
        );
        await page.waitForFunction(
          (selector) =>
            !document.querySelector(selector).getBoundingClientRect().height,
          {},
          pager,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
          'page remains bounded after loading more',
        );
      }
    }
  }
  assert.ok(calls.some((url) => url.includes('cursor=users-page-2')));
  assert.ok(calls.some((url) => url.includes('cursor=sessions-page-2')));
  assert.deepEqual(errors, []);
  console.log(
    `${results.length} layouts passed; both pagers append and terminate.`,
  );
} finally {
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ results, calls, errors }, null, 2),
  );
  await browser.close();
}
