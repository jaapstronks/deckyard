/**
 * The slide sanitizer keeps the same markup in the browser as on the server
 * (DY-867).
 *
 * `select` is a forbidden tag, and DOMPurify keeps a forbidden tag's children
 * unless told otherwise. The two parsers disagree on what those children are:
 * parse5 (the server, through jsdom) drops markup inside a select, Chrome's
 * parser keeps it since the customizable select. Before the fix the same
 * author HTML kept an `<img>`, `<video poster>`, SVG `<image>` or a `style`
 * with `url()` in the browser that the server never saw, and Chrome fetched
 * it (probe N of the DY-863 review: 12 of the 13 select forms below).
 *
 * The test sanitizes each form twice, once in Node and once in Chrome with
 * the vendored DOMPurify and the same `shared/sanitize.js`, mounts the
 * browser's result, and records every request that leaves the page's origin.
 * Ordinary author markup renders as it did.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  resolveChromeExecutablePath,
  getPuppeteerBrowser,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import { initSanitizer, sanitizeSlideHtmlSync } from '../shared/sanitize.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the export tests: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

after(closePuppeteerBrowser);

const ORIGIN = 'https://deckyard.invalid';
const HOST = 'beacon.example';
const img = (u) => `<img src="${u}">`;

/** Probe N's select forms; every one but `selectedcontent > img` loaded before. */
const SELECT_FORMS = {
  'select > img': (u) => `<select>${img(u)}</select>`,
  'select > option > img': (u) => `<select><option>${img(u)}</option></select>`,
  'select > div > img': (u) => `<select><div>${img(u)}</div></select>`,
  'select > optgroup > img': (u) =>
    `<select><optgroup label="a">${img(u)}</optgroup></select>`,
  'select > button > img': (u) =>
    `<select><button>${img(u)}</button><option>a</option></select>`,
  'select > button > selectedcontent, option selected > img': (u) =>
    `<select><button><selectedcontent></selectedcontent></button><option selected>${img(u)}</option></select>`,
  'select > selectedcontent > img': (u) =>
    `<select><selectedcontent>${img(u)}</selectedcontent></select>`,
  'select > svg > image': (u) =>
    `<select><svg><image href="${u}" width="4" height="4"></image></svg></select>`,
  'select > video poster': (u) =>
    `<select><video poster="${u}"></video></select>`,
  'select > span style url': (u) =>
    `<select><span style="background-image:url(${u})">x</span></select>`,
  'select > hr, img': (u) => `<select><hr>${img(u)}</select>`,
  'table > select > img': (u) =>
    `<table><tr><td><select>${img(u)}</select></td></tr></table>`,
  'select > table > img': (u) =>
    `<select><table><tr><td>${img(u)}</td></tr></table></select>`,
};

/** Author markup that must come out as it went in, on both sides. */
const ORDINARY = [
  '<h2>Title</h2><p>Text with <strong>bold</strong> and <a href="https://example.org/x" target="_blank">a link</a>.</p>',
  '<img src="/uploads/x.png" alt="A picture">',
  '<div class="grid" style="display:grid;gap:1rem"><span>a</span><span>b</span></div>',
  '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="currentColor"></rect></svg>',
  '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
  '<ul><li>one</li><li>two</li></ul>',
];

/** Forbidden tags other than select keep their text, as before. */
const TEXT_KEPT = {
  '<button>Click</button>': 'Click',
  '<option>a</option>': 'a',
  '<p>x<select><option>A</option></select>y</p>': '<p>xy</p>',
};

const SELECT_CASES = Object.entries(SELECT_FORMS).map(([form, make], id) => ({
  form,
  id,
  html: make(`https://n${id}n.${HOST}/p?d=deck-text`),
}));

const INPUTS = [
  ...SELECT_CASES.map((c) => c.html),
  ...ORDINARY,
  ...Object.keys(TEXT_KEPT),
];

await initSanitizer();
const nodeOutputs = INPUTS.map((html) => sanitizeSlideHtmlSync(html));

/**
 * Sanitize every input in Chrome through the vendored DOMPurify and
 * `shared/sanitize.js`, mount the result, and collect what the page asks of
 * any other origin.
 */
async function sanitizeInChrome(inputs) {
  const browser = await getPuppeteerBrowser({ featureName: 'Sanitizer test' });
  const page = await browser.newPage();
  const foreign = [];
  try {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const url = req.url();
      if (url === `${ORIGIN}/probe`) {
        return req.respond({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html><head><base href="${ORIGIN}/">
<script src="/client/vendor/dompurify/purify.min.js"></script></head><body><div id="root"></div>
<script type="module">
import { sanitizeSlideHtmlSync } from '/shared/sanitize.js';
const inputs = await (await fetch('/inputs.json')).json();
const root = document.getElementById('root');
window.outputs = inputs.map((html) => {
  const out = sanitizeSlideHtmlSync(html);
  const holder = document.createElement('div');
  holder.innerHTML = out;
  root.appendChild(holder);
  return out;
});
for (const v of document.querySelectorAll('video')) try { v.load(); } catch {}
document.title = 'done';
</script></body></html>`,
        });
      }
      if (url === `${ORIGIN}/inputs.json`) {
        return req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(inputs),
        });
      }
      if (
        url === `${ORIGIN}/client/vendor/dompurify/purify.min.js` ||
        url === `${ORIGIN}/shared/sanitize.js`
      ) {
        const body = await readFile(path.join(repoRoot, new URL(url).pathname));
        return req.respond({
          status: 200,
          contentType: 'text/javascript',
          body,
        });
      }
      if (!url.startsWith(`${ORIGIN}/`)) foreign.push(url);
      return req.respond({ status: 204, body: '' });
    });
    await page.goto(`${ORIGIN}/probe`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.title === 'done', {
      timeout: 30_000,
    });
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: 10_000 })
      .catch(() => {});
    const outputs = await page.evaluate(() => window.outputs);
    return { outputs, foreign };
  } finally {
    await page.close();
  }
}

test('Node drops what sits inside a select, and keeps other forbidden text', () => {
  for (const [i, c] of SELECT_CASES.entries()) {
    assert.ok(
      !nodeOutputs[i].includes(HOST),
      `${c.form}: the server kept ${nodeOutputs[i]}`,
    );
  }
  for (const [html, expected] of Object.entries(TEXT_KEPT)) {
    assert.equal(sanitizeSlideHtmlSync(html), expected, html);
  }
  for (const html of ORDINARY) {
    assert.equal(sanitizeSlideHtmlSync(html), html);
  }
});

test(
  'Chrome keeps the same markup as the server and loads nothing from inside a select',
  { skip },
  async (t) => {
    const { outputs, foreign } = await sanitizeInChrome(INPUTS);
    for (const [i, c] of SELECT_CASES.entries()) {
      await t.test(c.form, () => {
        const asked = foreign.filter((u) => u.includes(`n${c.id}n.${HOST}`));
        assert.deepEqual(asked, [], `${c.form}: Chrome fetched ${asked}`);
        assert.equal(
          outputs[i],
          nodeOutputs[i],
          `${c.form}: server and browser differ`,
        );
      });
    }
    await t.test('ordinary author markup', () => {
      for (const [j, html] of ORDINARY.entries()) {
        const i = SELECT_CASES.length + j;
        assert.equal(outputs[i], html);
        assert.equal(nodeOutputs[i], html);
      }
    });
    assert.deepEqual(
      foreign.filter((u) => u.includes(HOST)),
      [],
      'no request to the planted host at all',
    );
  },
);
