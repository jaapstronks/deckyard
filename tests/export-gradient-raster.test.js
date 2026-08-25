/**
 * Gradient slide backgrounds are a bitmap in the PDF export, not a live
 * gradient.
 *
 * The defect: a themed slide background built from `radial-gradient`s with
 * alpha stops leaves Chrome as a page-sized tiling pattern behind a luminosity
 * SMask, both halves a ShadingType 1 shading driven by a FunctionType 4
 * PostScript program that the reader runs *per pixel*. Measured here on a
 * three-page deck on the `amethyst` theme's `calm` background: 3.3 s per page
 * under Ghostscript at 110 dpi, against 0.06 s for the same deck without one.
 * After rasterizing: 0.14 s, with the rendered page differing by at most 4/255.
 *
 * Two things are pinned below, because both can silently rot:
 *
 *   1. the export HTML must not still carry a `radial-gradient(` in a slide
 *      background — that is the whole point, and a regression would be
 *      invisible except as a slow PDF;
 *   2. the dedupe must key on the *resolved* value. One bitmap for a deck is
 *      the happy case, but a theme whose background reads per-slide custom
 *      properties must get one bitmap per distinct position — sharing one would
 *      put every blob in the wrong place on all but one slide.
 *
 * Run with: node --test tests/export-gradient-raster.test.js
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  resolveChromeExecutablePath,
  closePuppeteerBrowser,
} from '../server/utils/puppeteer-browser.js';
import {
  buildSlidesPdfHtml,
  buildStyleContent,
} from '../server/export/pdf-slides.js';
import { loadExportCssBundle } from '../server/export/css-bundle.js';
import { renderSlideHtml } from '../server/utils/render-slide.js';
import { loadThemeAssets } from '../server/utils/themes.js';
import {
  findGradientBgVars,
  rasterizeGradientBackgrounds,
  resolveCssVars,
  slideBgVariant,
  slideRootVars,
  mayHaveVisibleGradientLayer,
} from '../server/export/gradient-raster.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const chromePath = await resolveChromeExecutablePath();
const isCi = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());

/** Same gate as the export smoke test: skip locally without a browser, never in CI. */
const skip =
  chromePath || isCi
    ? false
    : 'no Chrome/Chromium found — install Chrome or set PUPPETEER_EXECUTABLE_PATH';

/**
 * Every `--t-slide-bg-*` declaration in the document, value included.
 *
 * The value alternation is not decoration: a PNG data URL contains a `;`
 * (`data:image/png;base64,…`), so a naive `[^;}]+` truncates the very value
 * this file is here to assert on.
 */
function slideBgDeclarations(html) {
  return [
    ...String(html).matchAll(
      /--t-slide-bg-[a-z0-9-]+\s*:\s*((?:url\("[^"]*"\)|[^;}])+)/g,
    ),
  ].map((m) => m[1].trim());
}

function calmDeck(n) {
  return {
    title: 'Gradient background',
    theme: 'amethyst',
    slides: Array.from({ length: n }, (_, i) => ({
      id: `slide-${i}`,
      type: 'content-slide',
      content: {
        title: `Onderwerp ${i}`,
        body: 'Tekst op de achtergrond.',
        background: 'calm',
      },
    })),
  };
}

test(
  'a gradient slide background leaves the PDF export as a bitmap',
  { skip },
  async () => {
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const html = await buildSlidesPdfHtml(repoRoot, calmDeck(3), { theme });

    const decls = slideBgDeclarations(html);
    assert.ok(
      decls.length > 0,
      'the theme must declare slide backgrounds at all',
    );
    assert.deepEqual(
      decls.filter((v) => /radial-gradient\(/i.test(v)),
      [],
      'no slide background may still reach the PDF as a live gradient',
    );
    assert.match(
      html,
      /\.pdf-stage\.grad-bg-\d+ \.slide\.slide-bg-calm \{\s*background-image: url\("data:image\/(png|jpeg);base64,/,
      'the bitmap must arrive as a background-image override',
    );
  },
);

test(
  'the bitmap never lands in the --t-slide-bg-* token itself',
  { skip },
  async () => {
    // `--t-slide-bg-<id>` feeds `--slide-bg`, which client/styles also reads as a
    // `background-color` (00-base.css) and as a `color`
    // (32-markdown-and-actions.css). A `url()` in there is invalid at
    // computed-value time, and an image-text slide then prints white on white.
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const html = await buildSlidesPdfHtml(repoRoot, calmDeck(3), { theme });

    for (const value of slideBgDeclarations(html)) {
      assert.ok(
        !/url\(/i.test(value),
        `--t-slide-bg-* must stay a colour, got: ${value.slice(0, 60)}`,
      );
    }
    assert.ok(
      slideBgDeclarations(html).includes('#140a26'),
      "the token must fall back to the stack's own base colour",
    );
  },
);

test(
  'one background shared by many slides is rasterized once',
  { skip },
  async () => {
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const html = await buildSlidesPdfHtml(repoRoot, calmDeck(6), { theme });

    const dataUrls = new Set(
      [
        ...html.matchAll(/url\("(data:image\/(?:png|jpeg);base64,[^"]+)"\)/g),
      ].map((m) => m[1]),
    );
    assert.equal(
      dataUrls.size,
      1,
      'six slides on one background must share one bitmap',
    );
    assert.equal(
      [...html.matchAll(/\bgrad-bg-\d+\b/g)].filter((m) => m[0] !== 'grad-bg-0')
        .length,
      0,
      'and they must all point at the same rule',
    );
  },
);

test(
  'two slides whose background resolves differently do not share a bitmap',
  { skip },
  async () => {
    // A theme background that reads the per-slide gradient vars — the shape
    // `gradientVarsForSlide()` produces. If the dedupe keyed on the *declared*
    // value instead of the resolved one, both slides would get one bitmap and
    // one of them would have its blob in the wrong place.
    const themeVarsCss = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at var(--g1x) var(--g1y), rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%), #06090b;
}`;
    const slide = (g1x, g1y) =>
      `<div class="slide slide-content slide-bg-calm" style="--g1x:${g1x};--g1y:${g1y}"><div class="slide-inner"></div></div>`;

    const out = await rasterizeGradientBackgrounds({
      themeVarsCss,
      slidesHtml: [
        slide('18%', '22%'),
        slide('82%', '74%'),
        slide('18%', '22%'),
      ],
    });

    assert.equal(out.rasterCount, 2, 'two distinct positions, two bitmaps');
    assert.equal(
      out.stageClasses[0],
      out.stageClasses[2],
      'identical vars must still collapse to one bitmap',
    );
    assert.notEqual(
      out.stageClasses[0],
      out.stageClasses[1],
      'different vars must not share a bitmap',
    );

    const dataUrls = [
      ...out.extraCss.matchAll(
        /url\("(data:image\/(?:png|jpeg);base64,[^"]+)"\)/g,
      ),
    ].map((m) => m[1]);
    assert.equal(dataUrls.length, 2);
    assert.notEqual(
      dataUrls[0],
      dataUrls[1],
      'and the two bitmaps must differ',
    );
  },
);

test(
  'a background that cannot be resolved keeps its live gradient',
  { skip },
  async () => {
    // No `--g1x` anywhere and no fallback in the `var()`: rasterizing would guess
    // at the position, so the slow-but-correct gradient stays.
    const themeVarsCss = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at var(--g1x) 20%, rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%), #06090b;
}`;
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss,
      slidesHtml: ['<div class="slide slide-content slide-bg-calm"></div>'],
    });

    assert.equal(out.rasterCount, 0);
    assert.equal(out.extraCss, '');
    assert.match(out.themeVarsCss, /radial-gradient\(/);
    assert.deepEqual(out.stageClasses, ['']);
  },
);

test('only slide-background vars are candidates', () => {
  const css = `.ps-theme {
  --t-slide-bg-calm: radial-gradient(circle at 50% 50%, rgba(1,2,3,0.5) 0%, rgba(1,2,3,0) 70%), #06090b;
  --t-slide-bg-calm-text: #ffffff;
  --t-slide-bg-lime: #e2fe52;
  --t-slide-gradient-bg: radial-gradient(circle at var(--g1x) var(--g1y), rgba(1,2,3,1) 0%, rgba(1,2,3,0) 70%);
}`;
  const found = findGradientBgVars(css);
  assert.deepEqual([...found.keys()], ['--t-slide-bg-calm']);
  // The animated overlay layer is already disabled in every export path
  // (`--t-gradient-enabled: 0`), so rasterizing it would add a gradient the
  // export does not currently have.
  assert.equal(found.has('--t-slide-gradient-bg'), false);
});

test('a gradient stacked over an image is left alone, whatever names it', () => {
  // A variant whose design IS a photo with a legibility scrim on top. The
  // raster page runs offline, so rasterizing this would drop the image and
  // rewrite the var to its bare fallback colour — the artwork gone, silently,
  // and only in the export. Reported by the CIIIC fork, 2026-08-25.
  // `image-set()` is here because matching only the spelling `url(` would
  // leave the same bug one spelling over.
  const images = [
    "url('/custom/themes/x/assets/bg.png') center / cover no-repeat",
    'image-set("/custom/themes/x/assets/bg.png" 1x, "/x@2x.png" 2x)',
  ];
  for (const image of images) {
    const css = `.ps-theme {
  --t-slide-bg-international: linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%), ${image}, #13393a;
  --t-slide-bg-calm: radial-gradient(circle at 50% 50%, rgba(1,2,3,0.5) 0%, rgba(1,2,3,0) 70%), #06090b;
}`;
    const found = findGradientBgVars(css);
    assert.deepEqual(
      [...found.keys()],
      ['--t-slide-bg-calm'],
      `a background built with ${image.slice(0, 12)}… must not be rasterized`,
    );
  }
});

test('an inlined data URL does not disturb the declaration after it', () => {
  // What the bundle now hands this module: a variant whose local artwork has
  // been inlined, so the value carries `url('data:…;base64,…')` with a `;`
  // inside it. The declaration itself is skipped (it holds an image), but the
  // scan must still arrive at the next one intact.
  for (const q of ['"', "'"]) {
    const css = `.ps-theme {
  --t-slide-bg-art: radial-gradient(circle at 50% 50%, rgba(1,2,3,0.5), transparent), url(${q}data:image/png;base64,AAAA;BBBB${q}) center / cover;
  --t-slide-bg-calm: radial-gradient(circle at 20% 30%, rgba(9,9,9,0.4), transparent), #06090b;
}`;
    const found = findGradientBgVars(css);
    assert.deepEqual(
      [...found.keys()],
      ['--t-slide-bg-calm'],
      `a ${q}-quoted data URL must leave the next declaration reachable`,
    );
    assert.equal(
      found.get('--t-slide-bg-calm'),
      'radial-gradient(circle at 20% 30%, rgba(9,9,9,0.4), transparent), #06090b',
      'and that declaration must be captured whole',
    );
  }
});

test('the value of a rasterizable candidate is captured whole', () => {
  // The other half of the same parser question, on a value with no url() at
  // all: the captured text is what gets resolved and rendered, so a cut here
  // would rasterize a different gradient than the theme declared.
  const value =
    'radial-gradient(circle at 62% 18%, rgba(1,2,3,0.5) 0%, rgba(1,2,3,0) 70%), #06090b';
  const found = findGradientBgVars(
    `.ps-theme {\n  --t-slide-bg-calm: ${value};\n}`,
  );
  assert.equal(found.get('--t-slide-bg-calm'), value);
});

test('var resolution refuses to guess', () => {
  assert.equal(
    resolveCssVars('circle at var(--g1x) 10%', { '--g1x': '62%' }),
    'circle at 62% 10%',
  );
  assert.equal(
    resolveCssVars('circle at var(--g1x, 50%) 10%', {}),
    'circle at 50% 10%',
  );
  assert.equal(resolveCssVars('circle at var(--g1x) 10%', {}), null);
  assert.equal(resolveCssVars('circle at 50% 10%', {}), 'circle at 50% 10%');
});

test('the slide root is read for its variant and its own custom properties', () => {
  const html =
    '<div class="slide slide-content slide-bg-calm" style="--g1x:62%;--quote-scale:1">' +
    '<span style="--icg-icon-url:url(x.svg)"></span></div>';
  assert.equal(slideBgVariant(html), 'calm');
  assert.deepEqual(slideRootVars(html), {
    '--g1x': '62%',
    '--quote-scale': '1',
  });
  assert.equal(slideBgVariant('<div class="slide slide-content"></div>'), null);
});

test('the contrast classes are not mistaken for a variant', () => {
  // `has-slide-bg-light-text` ends in `slide-bg-light-text`. A substring search
  // reads that as a variant no theme declares, and the slide's real gradient
  // then escapes rasterization — seconds per page back in the PDF.
  assert.equal(
    slideBgVariant(
      '<div class="slide slide-content slide-bg-calm has-slide-bg-light-text">x</div>',
    ),
    'calm',
  );
  assert.equal(
    slideBgVariant(
      '<div class="slide slide-content has-slide-bg has-slide-bg-cover has-slide-bg-dark-text">x</div>',
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// Pseudo-element layers (`::before` / `::after`)
//
// These are decided by measuring the assembled document, never by reading CSS
// text, because whether such a layer paints depends on the cascade — and a fork
// changes that cascade. The three tests below pin the three answers that matter:
// invisible stays invisible, a layer that paints nothing is not invented, and a
// layer that does paint gets a bitmap.
// ---------------------------------------------------------------------------

/** The stage/slide boxes, so a pseudo-element with `inset` has something to size against. */
const STAGE_CSS = `
  .pdf-page { position: relative; width: 1600px; height: 900px; }
  .pdf-stage { position: absolute; top: 0; left: 0; width: 1600px; height: 900px; }
  .pdf-stage .slide { position: relative; width: 1600px; height: 900px; }
  .slide-demo::before {
    content: '';
    position: absolute;
    inset: -12%;
    background: var(--t-slide-gradient-bg, transparent);
    opacity: var(--t-gradient-enabled, 1);
    background-repeat: no-repeat;
    background-size: 300% 300%;
    background-position: 45% 35%;
  }
`;

const DEMO_SLIDE =
  '<div class="slide slide-demo" style="--gx:57%"><div class="slide-inner"></div></div>';

/** A `--t-slide-gradient-bg` that resolves without help from the slide root. */
const SELF_CONTAINED_GRADIENT =
  'radial-gradient(circle at 50% 50%, rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%)';

/** A theme block that switches its gradient layers on, as `gradient.enabled` does. */
const THEME_ON = (gradient) =>
  `.ps-theme { --t-slide-gradient-bg: ${gradient}; --t-gradient-enabled: 1; }`;

/** What every upstream export path appends after the theme block. */
const EXPORT_GATE = '.ps-theme { --t-gradient-enabled: 0; }';

test(
  'an invisible pseudo-element layer is never rasterized',
  { skip },
  async () => {
    // The real upstream shape: the theme switches the layer on, the export path
    // switches it back off. It carries a gradient and its `content` is set, but it
    // computes to `opacity: 0` — so rasterizing it would put a gradient in the PDF
    // that the export does not currently draw. The probe still runs here (the
    // theme's `1` is enough to look), and the opacity test is what stops it.
    const styleContent =
      THEME_ON(SELF_CONTAINED_GRADIENT) + EXPORT_GATE + STAGE_CSS;
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss: THEME_ON(SELF_CONTAINED_GRADIENT),
      slidesHtml: [DEMO_SLIDE],
      styleContent,
    });

    assert.equal(out.rasterCount, 0);
    assert.equal(out.extraCss, '');
    assert.deepEqual(out.stageClasses, ['']);
  },
);

test(
  'a visible pseudo-element layer becomes a bitmap sized to its own box',
  { skip },
  async () => {
    // The same document without the export gate — the shape a fork produces when
    // it keeps the layer visible on purpose.
    const styleContent = THEME_ON(SELF_CONTAINED_GRADIENT) + STAGE_CSS;
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss: THEME_ON(SELF_CONTAINED_GRADIENT),
      slidesHtml: [DEMO_SLIDE],
      styleContent,
    });

    assert.equal(out.rasterCount, 1);
    assert.deepEqual(out.stageClasses, ['grad-px-0']);
    assert.match(
      out.extraCss,
      /\.pdf-stage\.grad-px-0 > \.slide::before \{\s*background-image: url\("data:image\/(png|jpeg);base64,/,
      'the bitmap must arrive as a background-image override on the pseudo-element',
    );
    // `inset: -12%` makes the layer 124% of the slide, so the bitmap has to cover
    // that box — scaling it to the slide's width would leave the edges short.
    assert.match(out.extraCss, /background-size: 100% 100%/);
  },
);

test(
  'a pseudo-element layer whose gradient never resolves is left alone',
  { skip },
  async () => {
    // `--t-slide-gradient-bg` here is declared on `.ps-theme` but references a
    // custom property that only exists on the slide root. Substitution happens
    // where the property is *computed* — on `.ps-theme` — so it is
    // guaranteed-invalid and the layer paints nothing, even though its computed
    // opacity is 1. Resolving `--gx` by hand here would add a gradient the live
    // export does not draw. (This was the shipped shape until `themeVarsCssText()`
    // moved that one var to the slide root; a theme can still land in it by
    // declaring its own value that reads a slide-root property.)
    const unresolvable =
      'radial-gradient(circle at var(--gx) 50%, rgba(219,255,0,0.9) 0%, rgba(219,255,0,0) 70%)';
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss: THEME_ON(unresolvable),
      slidesHtml: [DEMO_SLIDE],
      styleContent: THEME_ON(unresolvable) + STAGE_CSS,
    });

    assert.equal(
      out.rasterCount,
      0,
      'nothing paints, so there is nothing to rasterize',
    );
    assert.equal(out.extraCss, '');
  },
);

test(
  'no styleContent means no pseudo-element pass at all',
  { skip },
  async () => {
    // The pass is opt-in on the caller handing over the real cascade; a caller that
    // does not (PNG export, tests) must see exactly the old behaviour.
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss: THEME_ON(SELF_CONTAINED_GRADIENT),
      slidesHtml: [DEMO_SLIDE],
    });
    assert.equal(out.rasterCount, 0);
    assert.equal(out.extraCss, '');
  },
);

test('a document that cannot show the layer never starts a browser', () => {
  // Not a nicety: without this, every PDF export and every `/export/pdf-slides`
  // preview would pay a Chrome page-load to be told "nothing here". Note this
  // test is NOT Chrome-gated — the point is that no browser is involved.
  assert.equal(mayHaveVisibleGradientLayer(''), false, 'no CSS at all');
  assert.equal(
    mayHaveVisibleGradientLayer(
      '.slide-quote::before { background: linear-gradient(red, blue); }',
    ),
    false,
    'a gradient layer with no --t-gradient-enabled anywhere cannot be switched on',
  );
  assert.equal(
    mayHaveVisibleGradientLayer('.ps-theme { --t-gradient-enabled: 0; }'),
    false,
    "the theme's own 'off'",
  );
  assert.equal(
    mayHaveVisibleGradientLayer(
      '.ps-theme{--t-gradient-enabled:1}.ps-theme{--t-gradient-enabled:0}',
    ),
    true,
    'one non-zero declaration is enough to look, even when a later rule turns it off again',
  );
  assert.equal(
    mayHaveVisibleGradientLayer(
      '.ps-theme { --t-gradient-enabled: var(--fork-switch); }',
    ),
    true,
    'a value we cannot read counts as "might paint"',
  );
});

test(
  'the pseudo-element raster follows what actually paints',
  { skip },
  async () => {
    // The property worth guarding is causal — *a layer is rasterized exactly when
    // it paints* — and it needs both directions to mean anything. Asserting only
    // "the shipped export has no bitmaps" pins upstream **policy**
    // (`--t-gradient-enabled: 0` in every export path), which a fork legitimately
    // inverts, and it passes just as happily when the feature is broken and nothing
    // could ever be rasterized. That is not hypothetical: this assertion was green
    // for exactly that wrong reason until `themeVarsCssText()` started declaring
    // `--t-slide-gradient-bg` on the slide root, because before that `midnight`'s
    // generated gradient was guaranteed-invalid and painted nothing at all.
    const theme = await loadThemeAssets(repoRoot, 'amethyst');
    const html = await buildSlidesPdfHtml(repoRoot, calmDeck(2), { theme });
    assert.equal(
      /grad-px-\d+/.test(html),
      false,
      'no pseudo-element raster upstream',
    );

    // `deckyard` has `gradient.enabled: false`, so the pre-check short-circuits and
    // the probe never runs. `midnight` is the shipped theme that switches the layers
    // on, so it is the one that actually walks the probe and lands on the opacity
    // test.
    const gradientTheme = await loadThemeAssets(repoRoot, 'midnight');
    const layerDeck = {
      title: 'Pseudo-element layers',
      theme: 'midnight',
      slides: [
        {
          id: 's0',
          type: 'quote-slide',
          content: { quote: 'Zo dan.', author: 'Iemand' },
        },
        {
          id: 's1',
          type: 'chapter-title-slide',
          content: { title: 'Hoofdstuk' },
        },
      ],
    };
    const layerHtml = await buildSlidesPdfHtml(repoRoot, layerDeck, {
      theme: gradientTheme,
    });
    assert.equal(
      /grad-px-\d+/.test(layerHtml),
      false,
      'the export gate still reaches the layers, so none of them is rasterized',
    );

    // Now the other direction, on the same real cascade with only the knob moved:
    // a later, equal-specificity declaration re-opens the gate, the way a fork that
    // wants its gradient in the PDF does. Those layers must now become bitmaps —
    // and one bitmap *per slide*, because `gradientVarsForSlide()` puts each slide's
    // blobs somewhere else and #491 dedupes on the resolved value, not the declared
    // one. A single shared bitmap here would mean the per-slide jitter is dead again.
    const css = await loadExportCssBundle(repoRoot, gradientTheme, null);
    const slidesHtml = layerDeck.slides.map((s) =>
      renderSlideHtml(s, { theme: gradientTheme, stripEditorAttrs: true }),
    );
    const out = await rasterizeGradientBackgrounds({
      themeVarsCss: css.themeVarsCss,
      slidesHtml,
      styleContent: `${buildStyleContent(css)}\n.ps-theme { --t-gradient-enabled: 1; }`,
    });
    assert.equal(
      out.rasterCount,
      2,
      'two slides, two distinct gradient positions, two bitmaps',
    );
    assert.notEqual(
      out.stageClasses[0],
      out.stageClasses[1],
      'and they must not be pointed at the same rule',
    );
  },
);

test(
  'the pseudo-element probe never fetches a subresource',
  { skip },
  async () => {
    // The probe loads real slide HTML in Chrome, and it does so *before*
    // `embedImgSrcDataUrls` has inlined remote images through the SSRF guard. So
    // the markup it hands to Chrome can still carry an attacker-chosen
    // `<img src="http://…">` — a theme's `assets.logo`, custom HTML — and without
    // request interception Chrome fetches it: no guard, no allow-list, straight
    // out of the deck. Pinned with a real listener rather than an assertion about
    // the code, because only the socket proves it.
    //
    // What identifies a leak is the URL we planted, not the port we happen to
    // own. An ephemeral port is borrowed, not held: the runner starts sixteen
    // test files at once, and a client in another process that was talking to
    // this port a moment ago can still be retrying against it while we listen.
    // That is the standing explanation for the intermittent `['/', '/']` — two
    // requests for the *origin root*, which the Chrome under test would never
    // send, because it was given a path. Scoping the assertion to the planted
    // path costs nothing: a real leak fetches exactly that URL. Foreign traffic
    // is kept and reported, so the next sighting names its own source instead
    // of being another anonymous red run. See
    // docs/plans/briefs/flaky-gradient-raster-port-reuse.md (A7.30).
    const probePath = `/should-never-be-fetched-${randomUUID()}.png`;
    const requests = [];
    const srv = http.createServer((req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'] || '',
        from: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
      });
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;
    try {
      const url = `http://127.0.0.1:${port}${probePath}`;
      // The theme switches the layer on, so the pre-check lets the probe run.
      const themeVarsCss = THEME_ON(SELF_CONTAINED_GRADIENT);
      await rasterizeGradientBackgrounds({
        themeVarsCss,
        slidesHtml: [
          `<div class="slide slide-demo"><img src="${url}" alt="Logo" /></div>`,
        ],
        styleContent: themeVarsCss + STAGE_CSS,
      });
      // Chrome dispatches subresource requests as it parses, so give an
      // un-intercepted fetch every chance to arrive before we conclude it did not.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const leaked = requests.filter((r) => r.url === probePath);
      const foreign = requests.filter((r) => r.url !== probePath);
      if (foreign.length) {
        console.warn(
          `[A7.30] ${foreign.length} request(s) reached the probe server on port ${port} without asking for ${probePath}: ${JSON.stringify(foreign)}`,
        );
      }
      assert.deepEqual(leaked, [], 'the probe must not reach the network');
    } finally {
      srv.close();
    }
  },
);

after(async () => {
  await closePuppeteerBrowser();
});
