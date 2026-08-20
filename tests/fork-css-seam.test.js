/**
 * The fork CSS seam: `custom/styles/*.css` loads last, in every render path.
 *
 * A fork has two levers — `--t-*` theme variables and `custom/slide-types/*.js`
 * — and used to have no way at all to write a CSS *rule*. The seam is the third
 * lever (docs/reference/fork-setup.md). Its entire value is the position: last
 * in the chain, so a fork rule beats the core rule it replaces without patching
 * a core file. Two things can rot that, and both are pinned here:
 *
 *   1. **Coverage.** Eight paths render a deck. A seam that lands in seven of
 *      them gives the fork screen/export drift, which is the bug class this
 *      exists to remove. Every path is built for real below and checked.
 *   2. **Position.** "Loads after core" asserted as string order survives
 *      exactly one refactor. The cascade tests load the assembled document in
 *      Chrome and read `getComputedStyle`, so what is pinned is the outcome —
 *      an equal-specificity fork rule wins — not the byte layout that produced
 *      it.
 *
 * The seam is seeded through a fixture repo root (symlinks to the real
 * `client/` + `assets/`, plus its own `custom/styles/`), so the probe CSS never
 * touches the working tree and cannot leak into tests running in parallel.
 *
 * Run with: node --test tests/fork-css-seam.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  resolveChromeExecutablePath,
  getPuppeteerBrowser,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import {
  buildCssChain,
  readCustomStylesCss,
  CUSTOM_STYLES_BANNER,
  CUSTOM_STYLES_URL,
} from '../server/utils/css-chain.js';
import { handleCustomStyles } from '../server/routes/static/static-files.js';
import { loadExportCssBundle } from '../server/export/css-bundle.js';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { buildSlidesPngExportHtml } from '../server/export/png-slides.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildPrintHtml } from '../server/export/print.js';
import { buildSlidePngHtml } from '../server/render/png.js';
import {
  buildSlidePreviewHtml,
  buildSingleSlidePreviewHtml,
} from '../server/mcp/preview.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the other export tests: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

/**
 * The probe stylesheet, written into the fixture's `custom/styles/`.
 *
 * Every rule here duels a core rule of *equal* specificity, so it can only win
 * by coming later — which is the property under test. `--font-body` is declared
 * on `.slide` by client/styles/theme.css (in every chain that inlines core
 * CSS); `body` margin/background are declared by the per-path document CSS.
 */
const PROBE_CSS = `
.slide { --font-body: 'SeamProbe', sans-serif; }
body { margin: 7px; background: rgb(1, 2, 3); }
`;

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'deckyard-seam-'));
for (const dir of ['client', 'assets', 'shared', 'themes']) {
  symlinkSync(path.join(repoRoot, dir), path.join(fixtureRoot, dir), 'dir');
}
mkdirSync(path.join(fixtureRoot, 'custom', 'styles'), { recursive: true });
writeFileSync(
  path.join(fixtureRoot, 'custom', 'styles', '10-probe.css'),
  PROBE_CSS,
  'utf8',
);

after(async () => {
  await closePuppeteerBrowser();
  await rm(fixtureRoot, { recursive: true, force: true });
});

const SLIDE = {
  id: 'slide-1',
  type: 'title-slide',
  content: { title: 'Seam', subheading: 'A fork rule lands last' },
};
const DECK = { title: 'Seam', theme: 'default', slides: [SLIDE] };

/** Every path, built for real. Order matters: the seam must be last in each. */
async function buildAllPaths(root) {
  return {
    'export/pdf-slides': await buildSlidesPdfHtml(root, DECK, {}),
    'export/png-slides': await buildSlidesPngExportHtml(root, DECK, {}),
    'export/html': await buildStandaloneHtml(root, DECK, {}),
    'export/print': await buildPrintHtml(root, DECK, {}),
    'render/png': await buildSlidePngHtml(root, SLIDE, {}),
    'mcp/preview (list)': await buildSlidePreviewHtml([SLIDE], {
      title: 'Seam',
      repoRoot: root,
    }),
    'mcp/preview (single)': await buildSingleSlidePreviewHtml(SLIDE, {
      repoRoot: root,
    }),
    'utils/embed-html': buildEmbedHtml(root, DECK, { publishId: 'seam' }),
  };
}

const documents = await buildAllPaths(fixtureRoot);

test('every render path loads custom/styles', async (t) => {
  for (const [name, html] of Object.entries(documents)) {
    await t.test(name, () => {
      assert.ok(
        html.includes(CUSTOM_STYLES_BANNER),
        `${name} does not run its CSS through buildCssChain — the fork seam ` +
          'is missing from this path, which is how screen/export drift starts',
      );
      assert.ok(
        html.includes("--font-body: 'SeamProbe'"),
        `${name} carries the seam banner but not the seam CSS`,
      );
    });
  }
});

test('nothing stylesheet-shaped follows the seam', async (t) => {
  // Element-level, not text-level: the PDF path appends the gradient-raster
  // overrides *inside* the same <style>, and that is deliberate — those are a
  // post-cascade rewrite of what this chain resolved (see css-chain.js), not a
  // competing opinion about styling. A second <style> or <link> after the seam
  // is the real regression: it would silently outrank every fork rule.
  for (const [name, html] of Object.entries(documents)) {
    await t.test(name, () => {
      const seamAt = html.indexOf(CUSTOM_STYLES_BANNER);
      const tail = html.slice(seamAt);
      assert.equal(
        tail.match(/<link[^>]+rel=["']?stylesheet/i),
        null,
        `${name} links a stylesheet after the fork seam`,
      );
      // The seam sits inside a <style>; the next </style> closes it, and no
      // further <style> may open in the document after that.
      const closeAt = tail.indexOf('</style>');
      assert.ok(closeAt > 0, `${name}: seam is not inside a <style> block`);
      assert.equal(
        tail.slice(closeAt).match(/<style[\s>]/i),
        null,
        `${name} opens another <style> after the fork seam`,
      );
    });
  }
});

test('render/pdf has no CSS chain of its own', async () => {
  // The eighth path. It is a Puppeteer wrapper around buildSlidesPdfHtml, and
  // the way it keeps the seam is by never assembling CSS itself.
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(repoRoot, 'server', 'render', 'pdf.js'), 'utf8'),
  );
  assert.match(
    src,
    /buildSlidesPdfHtml/,
    'render/pdf.js must build its document with buildSlidesPdfHtml',
  );
  assert.equal(
    src.match(/<style[\s>]/i),
    null,
    'render/pdf.js assembles CSS of its own — it must stay a thin wrapper ' +
      'around buildSlidesPdfHtml, or the seam has to be repeated here',
  );
});

test('buildCssChain puts the seam after every layer it is given', () => {
  const chain = buildCssChain(fixtureRoot, ['a { color: red; }', null, false]);
  assert.ok(
    chain.indexOf('a { color: red; }') < chain.indexOf(PROBE_CSS.trim()),
  );
  assert.ok(chain.trimEnd().endsWith('}'), 'the seam is the tail of the chain');
});

/**
 * What the cascade actually resolves to, per path.
 *
 * `selector`/`prop` name the element and the CSS property to ask the browser
 * about; `expect` is what the *fork* rule says. Without the seam these read as
 * the core value, which the last test below asserts — otherwise a duel that
 * never duelled would pass just as happily.
 */
const CASCADE_DUELS = {
  'export/pdf-slides': {
    selector: '.slide',
    prop: 'font-family',
    expect: /SeamProbe/,
    core: 'core sets `.slide { font-family: var(--font-body) }`',
  },
  'export/png-slides': {
    selector: '.slide',
    prop: 'font-family',
    expect: /SeamProbe/,
    core: 'core sets `.slide { font-family: var(--font-body) }`',
  },
  'render/png': {
    selector: '.slide',
    prop: 'font-family',
    expect: /SeamProbe/,
    core: 'core sets `.slide { font-family: var(--font-body) }`',
  },
  'export/html': {
    selector: '.slide',
    prop: '--font-body',
    expect: /SeamProbe/,
    core: 'theme.css declares `.slide { --font-body: var(--t-font-body, …) }`',
  },
  'mcp/preview (list)': {
    selector: '.slide',
    prop: '--font-body',
    expect: /SeamProbe/,
    core: 'theme.css declares `.slide { --font-body: var(--t-font-body, …) }`',
  },
  'mcp/preview (single)': {
    selector: '.slide',
    prop: '--font-body',
    expect: /SeamProbe/,
    core: 'theme.css declares `.slide { --font-body: var(--t-font-body, …) }`',
  },
  'export/print': {
    selector: 'body',
    prop: 'margin-top',
    expect: /^7px$/,
    core: 'the print document CSS sets `body { margin: 0 }`',
  },
  'utils/embed-html': {
    // The embed page <link>s core CSS from the server, so under setContent
    // those 404 — deliberately: the duel here is against the embed shell's own
    // inline `body { background: #000 }`, which is in the chain either way.
    selector: 'body',
    prop: 'background-color',
    expect: /^rgb\(1, 2, 3\)$/,
    core: 'the embed shell sets `body { background: #000 }`',
  },
};

/** Resolve one duel in a real browser against a real document. */
async function resolveDuel(html, duel) {
  const browser = await getPuppeteerBrowser({ featureName: 'CSS seam test' });
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(
      (selector, prop) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        return getComputedStyle(el).getPropertyValue(prop).trim();
      },
      duel.selector,
      duel.prop,
    );
  } finally {
    await page.close();
  }
}

test('a fork rule outranks the core rule it duels', { skip }, async (t) => {
  for (const [name, duel] of Object.entries(CASCADE_DUELS)) {
    await t.test(name, async () => {
      const value = await resolveDuel(documents[name], duel);
      assert.notEqual(
        value,
        null,
        `${name}: no "${duel.selector}" in the rendered document`,
      );
      assert.match(
        value,
        duel.expect,
        `${name}: ${duel.core}, and the fork's equal-specificity rule in ` +
          'custom/styles/ must win by loading later — it did not',
      );
    });
  }
});

test(
  'without the seam the same duels resolve to the core value',
  { skip },
  async (t) => {
    // The control. If this passed with the seam absent, the assertions above
    // would prove nothing about ordering.
    if (readCustomStylesCss(repoRoot)) {
      t.skip('this checkout has its own custom/styles — no clean control');
      return;
    }
    const plain = await buildAllPaths(repoRoot);
    for (const [name, duel] of Object.entries(CASCADE_DUELS)) {
      await t.test(name, async () => {
        const value = await resolveDuel(plain[name], duel);
        assert.doesNotMatch(
          value ?? '',
          duel.expect,
          `${name}: the duel resolves to the fork value with no fork CSS ` +
            'present — the probe is not actually duelling anything',
        );
      });
    }
  },
);

/**
 * The seam also has to reach the *browser*, and the app shell is a static HTML
 * file that cannot glob a directory — so the same bytes are served at one URL.
 */
test('the seam is served at a single URL', () => {
  const written = { status: null, headers: null, body: null };
  const res = {
    writeHead(status, headers) {
      written.status = status;
      written.headers = headers;
      return this;
    },
    end(body) {
      written.body = body;
    },
  };
  const handled = handleCustomStyles({
    repoRoot: fixtureRoot,
    req: { method: 'GET' },
    res,
    url: { pathname: CUSTOM_STYLES_URL },
  });
  assert.equal(handled, true, `${CUSTOM_STYLES_URL} must be routed`);
  assert.equal(written.status, 200);
  assert.match(written.headers['Content-Type'], /^text\/css/);
  assert.equal(
    written.headers['Cache-Control'],
    'no-cache',
    'a fork deploy changes this file without changing its URL',
  );
  assert.ok(written.body.includes("--font-body: 'SeamProbe'"));
});

test('a stock install serves the seam URL empty, not 404', () => {
  if (readCustomStylesCss(repoRoot)) return; // a fork checkout; nothing to prove
  let status = null;
  let body = null;
  handleCustomStyles({
    repoRoot,
    req: { method: 'GET' },
    res: {
      writeHead(s) {
        status = s;
        return this;
      },
      end(b) {
        body = b;
      },
    },
    url: { pathname: CUSTOM_STYLES_URL },
  });
  assert.equal(status, 200, 'the app shell links this unconditionally');
  assert.equal(body, '');
});

test('the app shell links the seam last', async () => {
  const shell = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(repoRoot, 'client', 'index.html'), 'utf8'),
  );
  const links = [...shell.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(
    (m) => m[0],
  );
  assert.ok(links.length > 1, 'the app shell links stylesheets at all');
  assert.match(
    links.at(-1),
    new RegExp(CUSTOM_STYLES_URL.replace('.', '\\.')),
    'the seam must be the last stylesheet in the app shell — anything after ' +
      'it outranks every fork rule, and screen would drift from export',
  );
});

test('a fork @font-face survives into self-contained exports', async () => {
  // The fonts route: a fork moves its @font-face blocks out of core
  // client/styles/shared/fonts.css into custom/styles/fonts.css. In an export
  // there is no origin to resolve `/assets/...` against, so the URL is inlined
  // — and the face itself must not be stripped the way core faces are.
  const fontRoot = mkdtempSync(path.join(tmpdir(), 'deckyard-seam-font-'));
  for (const dir of ['client', 'assets', 'shared', 'themes']) {
    symlinkSync(path.join(repoRoot, dir), path.join(fontRoot, dir), 'dir');
  }
  mkdirSync(path.join(fontRoot, 'custom', 'styles'), { recursive: true });
  writeFileSync(
    path.join(fontRoot, 'custom', 'styles', 'fonts.css'),
    `@font-face {
       font-family: 'ForkFace';
       src: url('/assets/fonts/google/playfair-display/playfair-display-400-latin.woff2') format('woff2');
     }`,
    'utf8',
  );
  try {
    const bundle = await loadExportCssBundle(fontRoot, null, null);
    const style = buildCssChain(fontRoot, ['a { color: red; }'], {
      customCss: bundle.customCss,
    });
    assert.match(
      style,
      /@font-face/,
      'the seam is not run through stripFontFacesFromCss — a fork face is ' +
        'the whole point of custom/styles/fonts.css',
    );
    assert.match(
      style,
      /url\('data:font\/woff2;base64,/,
      'a local font URL in the seam must be inlined for export documents; ' +
        'left relative it resolves against nothing and falls back silently',
    );
  } finally {
    await rm(fontRoot, { recursive: true, force: true });
  }
});
