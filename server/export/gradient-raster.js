/**
 * Turn decorative gradient slide backgrounds into a bitmap for export.
 *
 * ## Why
 *
 * A CSS `radial-gradient` whose colour stops carry alpha does not leave Chrome
 * as a gradient. Skia emits it as a page-sized tiling pattern behind a
 * luminosity SMask, where *both* the paint and the mask are a ShadingType 1
 * (function-based) shading driven by a FunctionType 4 PostScript calculator
 * program. A PDF renderer evaluates that program **per pixel, twice, per
 * layer** — and a themed slide stacks three to five of these. Measured on a
 * 78-page deck: 3.4–8.2 s per page under Ghostscript, 726 ms per page under
 * pdfium against 4 ms for a page without one. Opaque gradients cost 4–8 ms; the
 * same look written with `rgba()` stops costs 166–180 ms. The trigger is alpha
 * in the stops, nothing else.
 *
 * ## Why not just write the gradient without alpha
 *
 * Because that only works for a single layer. `rgba(C, a)` over an opaque
 * backdrop `B` is exactly `lerp(B, C, a)`, so one alpha layer over a solid
 * colour can be rewritten as opaque stops with no visible change (measured: max
 * 1/255). A *stack* cannot: a `radial-gradient` paints the whole box, with the
 * region past its last stop being transparent rather than absent, so making
 * layer 1 opaque paints the base colour over every layer beneath it. Rewriting
 * the four-blob CIIIC stack that way loses two of its four blobs outright (max
 * 119/255, mean 42/255). Precomposing to vector is a redesign to one layer, not
 * a change of notation — a theme decision, not an export one.
 *
 * ## What this does instead
 *
 * Render the background layer once in headless Chrome, at a fraction of the
 * slide's size, and paint it as a `background-image` in place of the gradient
 * stack. A gradient is about the lowest-frequency image there is, so the bitmap
 * survives magnification, and it compresses to less than the shading it
 * replaces: on a deck whose slides all carry the `deckyard` theme's `calm`
 * background, 3.30 s → 0.09 s per page under Ghostscript at 110 dpi, with the
 * file getting *smaller* (20 pages: 166 KB → 89 KB) and no page differing by
 * more than 5/255 per channel.
 *
 * Rasters are deduplicated on the **resolved** CSS value, so a theme whose
 * background references per-slide custom properties (`var(--g1x)` and friends,
 * see `gradientVarsForSlide()`) still gets one bitmap per distinct position —
 * never one shared bitmap that puts every blob in the wrong place.
 *
 * ## What this deliberately leaves alone
 *
 * The animated `::before` gradient layer (`--t-slide-gradient-bg` on quote,
 * chapter-title and icon-card-grid slides) is already switched off in every
 * export path by `--t-gradient-enabled: 0` — computed `opacity: 0`, never
 * painted, measured at 0.047 s per page for a deck made only of those three
 * types. Rasterizing it would make gradients *appear* where the export
 * currently has none, which is a design change and not a performance fix. Only
 * `--t-slide-bg-*` is touched.
 *
 * Rasterizing is best-effort throughout: any failure (no Chrome, a screenshot
 * that throws, a value we cannot resolve) leaves that background as the live
 * gradient. A slow background beats a broken one.
 */

import { getPuppeteerBrowser, toNodeBuffer } from '../utils/puppeteer-browser.js';
import { debugLog } from '../utils/debug-log.js';

/**
 * Width in CSS pixels of the rendered background bitmap; the height follows the
 * 16:9 slide canvas.
 *
 * Chosen on how it looks at 400% zoom, not on the per-pixel metric: every width
 * from 256 up scored the same max 4/255 against the live gradient, but at 256
 * the dithering magnifies into a visible coarse quilt, and at 512 it does not.
 * 1024 costs three times the bytes for nothing the eye can find.
 */
export const GRADIENT_RASTER_WIDTH = 512;

/**
 * Operator override, mostly an escape hatch: `PDF_GRADIENT_RASTER_WIDTH=0`
 * turns rasterizing off and restores the live (slow) gradient. Also what makes
 * a before/after measurement reproducible without patching the source.
 *
 * @returns {number} Bitmap width, or `0` to disable.
 */
export function gradientRasterWidth() {
  const raw = process.env.PDF_GRADIENT_RASTER_WIDTH;
  if (raw == null || raw === '') return GRADIENT_RASTER_WIDTH;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return GRADIENT_RASTER_WIDTH;
  return Math.min(4096, Math.round(n));
}

/** The slide canvas aspect, so the bitmap's percentage stops land where they do live. */
const SLIDE_ASPECT = 900 / 1600;

/**
 * Theme vars that hold a slide's own background. `--t-slide-gradient-bg` is
 * intentionally not matched (see the module comment), and the `-text` /
 * `-accent` companions never hold a gradient anyway.
 */
const SLIDE_BG_VAR_RE = /^--t-slide-bg-[a-z0-9-]+$/;

/**
 * `--name: value;` inside the theme's `.ps-theme { … }` block. The `url("…")`
 * alternative matters because a PNG data URL contains a `;`, so a plain
 * `[^;}]+` would cut a rewritten declaration in half.
 */
const VAR_DECL_RE = /(--t-slide-bg-[a-z0-9-]+)\s*:\s*((?:url\("[^"]*"\)|[^;}])+)/g;

/** `var(--name)` or `var(--name, fallback)`, with no nested `var()` inside. */
const VAR_REF_RE = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*?)\s*)?\)/gi;

/** A trailing solid colour in a `background` shorthand: `…, #06090b`. */
const TRAILING_COLOR_RE = /,\s*(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)\s*$/i;

/** JPEG quality for an opaque gradient stack. A soft wash is JPEG's best case. */
const JPEG_QUALITY = 88;

/**
 * Whether a CSS colour is fully opaque, so the bitmap can be a JPEG.
 * Anything we cannot read confidently counts as not opaque — PNG is the safe
 * answer, JPEG-on-transparency is a black rectangle.
 *
 * @param {string|undefined} color
 * @returns {boolean}
 */
function isOpaqueColor(color) {
  const c = String(color || '').trim().toLowerCase();
  if (!c || c === 'transparent') return false;
  if (c.startsWith('#')) return c.length === 4 || c.length === 7;
  const fn = /^(?:rgba?|hsla?)\(([^()]*)\)$/.exec(c);
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 4) return true;
    const alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return alpha >= 1;
  }
  // A named colour; `transparent` was the only non-opaque one and is handled above.
  return /^[a-z]+$/.test(c);
}

/**
 * Custom properties declared in a `style="…"` attribute.
 *
 * @param {string} styleAttr - The attribute's value.
 * @returns {Record<string, string>}
 */
function customPropsFromStyle(styleAttr) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const decl of String(styleAttr || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const name = decl.slice(0, i).trim();
    if (!name.startsWith('--')) continue;
    out[name] = decl.slice(i + 1).trim();
  }
  return out;
}

/**
 * Substitute `var(--x)` references with values the slide declares inline.
 *
 * Returns `null` when a reference cannot be resolved and has no fallback:
 * rasterizing a half-resolved value would paint the blobs in the wrong place,
 * which is worse than leaving the (slow) live gradient in.
 *
 * @param {string} value - A CSS `background` value.
 * @param {Record<string, string>} vars - Custom properties in scope.
 * @returns {string|null} The resolved value, or `null` if it cannot be.
 */
export function resolveCssVars(value, vars) {
  let out = String(value || '');
  // Bounded: each pass strips one level, and a value nested deeper than this is
  // not something we should be guessing about.
  for (let depth = 0; depth < 4; depth++) {
    if (!/var\(/i.test(out)) return out;
    let unresolved = false;
    out = out.replace(VAR_REF_RE, (whole, name, fallback) => {
      const v = vars[name];
      if (v != null && v !== '') return v;
      if (fallback != null && fallback !== '') return fallback;
      unresolved = true;
      return whole;
    });
    if (unresolved) return null;
  }
  return /var\(/i.test(out) ? null : out;
}

/**
 * The gradient-bearing slide-background vars declared in a theme's CSS.
 *
 * @param {string} themeVarsCss - The generated `.ps-theme { … }` block.
 * @returns {Map<string, string>} var name → declared value.
 */
export function findGradientBgVars(themeVarsCss) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const m of String(themeVarsCss || '').matchAll(VAR_DECL_RE)) {
    const name = m[1];
    const value = m[2].trim();
    if (!SLIDE_BG_VAR_RE.test(name)) continue;
    if (!/gradient\(/i.test(value)) continue;
    out.set(name, value);
  }
  return out;
}

/**
 * The `slide-bg-<id>` variant a rendered slide carries, if any.
 *
 * @param {string} slideHtml
 * @returns {string|null} The variant id (`calm`), not the class.
 */
export function slideBgVariant(slideHtml) {
  const m = /class="[^"]*\bslide-bg-([a-z0-9-]+)\b/.exec(String(slideHtml || ''));
  return m ? m[1] : null;
}

/**
 * Custom properties the rendered slide sets on its root element.
 *
 * Only the first `style="…"` after the opening `<div class="slide …"` is read:
 * that is where `renderSlideHtml` puts the per-slide gradient vars, and reading
 * every style attribute on the page would mix in a card's or an icon's.
 *
 * @param {string} slideHtml
 * @returns {Record<string, string>}
 */
export function slideRootVars(slideHtml) {
  const s = String(slideHtml || '');
  const open = /<div[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*>/.exec(s);
  if (!open) return {};
  const style = /\bstyle="([^"]*)"/.exec(open[0]);
  return style ? customPropsFromStyle(style[1]) : {};
}

/**
 * Render CSS `background` values to image data URLs in one headless-Chrome page.
 *
 * JPEG when the stack ends in an opaque colour (a soft wash is the best case
 * JPEG has, and it is several times smaller than PNG); PNG when it does not,
 * because JPEG has no alpha and would flatten the transparent part to black.
 *
 * @param {string[]} values - Resolved CSS `background` values.
 * @param {Object} [opts]
 * @param {number} [opts.width] - Bitmap width in CSS pixels.
 * @returns {Promise<Array<string|null>>} A data URL per value, `null` on failure.
 */
async function renderBackgroundsToDataUrls(values, { width = GRADIENT_RASTER_WIDTH } = {}) {
  if (!values.length) return [];
  const height = Math.max(1, Math.round(width * SLIDE_ASPECT));

  // Opening the page belongs in the same guard as launching the browser.
  // `getPuppeteerBrowser` caches its launch promise for the process lifetime, so
  // a Chrome that dies after the first export leaves a resolved-but-dead Browser
  // whose `newPage()` rejects. Letting that escape would fail the whole export —
  // and worse, the `/export/pdf-slides` HTML preview route, which reaches this
  // module without otherwise needing a browser at all.
  let page;
  try {
    const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
    page = await browser.newPage();
  } catch (err) {
    // No Chrome (or no puppeteer-core) is a normal state for some installs and
    // for the HTML preview route. The live gradient still renders.
    debugLog(`[pdf-export] gradient raster skipped: ${err?.message || err}`);
    return values.map(() => null);
  }

  try {
    await page.setViewport({ width, height: height * values.length });
    // Every value in one document: N screenshots, one setContent. The divs are
    // stacked, each exactly the bitmap's size, so a percentage stop resolves
    // against the same box shape it will have on the slide.
    const divs = values
      .map(
        (v, i) =>
          `<div id="g${i}" style="width:${width}px;height:${height}px;background:${v.replace(
            /"/g,
            '&quot;',
          )}"></div>`,
      )
      .join('');
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}` +
        `div{display:block}</style>${divs}`,
      { waitUntil: 'load' },
    );

    /** @type {Array<string|null>} */
    const out = [];
    for (let i = 0; i < values.length; i++) {
      try {
        const opaque = isOpaqueColor(TRAILING_COLOR_RE.exec(values[i])?.[1]);
        const el = await page.$(`#g${i}`);
        const shot = toNodeBuffer(
          opaque
            ? await el.screenshot({ type: 'jpeg', quality: JPEG_QUALITY })
            : await el.screenshot({ type: 'png', omitBackground: true }),
        );
        const mime = opaque ? 'image/jpeg' : 'image/png';
        out.push(`data:${mime};base64,${shot.toString('base64')}`);
      } catch (err) {
        debugLog(`[pdf-export] gradient raster failed for layer ${i}: ${err?.message || err}`);
        out.push(null);
      }
    }
    return out;
  } catch (err) {
    debugLog(`[pdf-export] gradient raster page failed: ${err?.message || err}`);
    return values.map(() => null);
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Replace gradient slide backgrounds with a rendered bitmap.
 *
 * Returns everything the caller needs to assemble the export document: the
 * theme CSS with the rasterized declarations neutralised, an extra CSS block
 * with one rule per distinct bitmap, and the class each slide's stage needs.
 *
 * A background is left untouched — declaration intact, no class — when it has
 * no bitmap. That keeps the failure mode "slow, correct" rather than "fast,
 * blank", and it is why the declaration is only rewritten once every slide that
 * uses it has a raster.
 *
 * @param {Object} opts
 * @param {string} opts.themeVarsCss - The generated `.ps-theme { … }` block.
 * @param {string[]} opts.slidesHtml - Rendered slide HTML, in page order.
 * @param {number} [opts.width] - Bitmap width in CSS pixels.
 * @returns {Promise<{themeVarsCss: string, extraCss: string, stageClasses: string[], rasterCount: number}>}
 */
export async function rasterizeGradientBackgrounds({
  themeVarsCss,
  slidesHtml,
  width = gradientRasterWidth(),
}) {
  const slides = Array.isArray(slidesHtml) ? slidesHtml : [];
  const none = {
    themeVarsCss: String(themeVarsCss || ''),
    extraCss: '',
    stageClasses: slides.map(() => ''),
    rasterCount: 0,
  };
  if (!width) return none;

  const gradientVars = findGradientBgVars(themeVarsCss);
  if (!gradientVars.size || !slides.length) return none;

  // Which slide wants which background, resolved against its own custom
  // properties. `signature` is the dedupe key: identical resolved CSS means
  // an identical bitmap, and nothing else does.
  /** @type {Array<{varName: string, signature: string}|null>} */
  const perSlide = slides.map((html) => {
    const variant = slideBgVariant(html);
    if (!variant) return null;
    const varName = `--t-slide-bg-${variant}`;
    const declared = gradientVars.get(varName);
    if (!declared) return null;
    const signature = resolveCssVars(declared, slideRootVars(html));
    return signature ? { varName, signature } : null;
  });

  /** @type {Map<string, {index: number, varName: string}>} */
  const bySignature = new Map();
  for (const hit of perSlide) {
    if (!hit || bySignature.has(hit.signature)) continue;
    bySignature.set(hit.signature, { index: bySignature.size, varName: hit.varName });
  }
  if (!bySignature.size) return none;

  const signatures = [...bySignature.keys()];
  const startedAt = Date.now();
  const dataUrls = await renderBackgroundsToDataUrls(signatures, { width });
  const rasterCount = dataUrls.filter(Boolean).length;
  debugLog(
    `[pdf-export] rasterized ${rasterCount}/${signatures.length} gradient background(s) ` +
      `at ${width}px in ${Date.now() - startedAt}ms`,
  );
  if (!rasterCount) return none;

  // One rule per bitmap, overriding **only** `background-image` and its sizing.
  //
  // Not the `--t-slide-bg-*` token, and this is the whole reason the rule looks
  // like this: that token feeds `--slide-bg`, which `00-base.css` also reads as
  // a `background-color` and `30-content-and-tables.css` reads as a `color`
  // (lines 275 and 281). A `url()` there is invalid at computed-value time, so
  // the declaration falls back to `unset` — which is how an image-text slide
  // loses its backdrop and prints white on white. The token is instead reduced
  // to the stack's own trailing colour further down, which leaves both of those
  // consumers with a *valid* colour for the first time.
  //
  // `100% 100%` (not `cover`) because the bitmap has the slide's aspect by
  // construction, so no crop can occur.
  const rules = [];
  signatures.forEach((signature, i) => {
    const dataUrl = dataUrls[i];
    if (!dataUrl) return;
    const { varName } = bySignature.get(signature);
    const variant = varName.slice('--t-slide-bg-'.length);
    rules.push(
      `.pdf-stage.grad-bg-${i} .slide.slide-bg-${variant} {\n` +
        `  background-image: url("${dataUrl}");\n` +
        `  background-size: 100% 100%;\n` +
        `  background-position: 0 0;\n` +
        `  background-repeat: no-repeat;\n` +
        `}`,
    );
  });

  const stageClasses = perSlide.map((hit) => {
    if (!hit) return '';
    const entry = bySignature.get(hit.signature);
    return dataUrls[entry.index] ? `grad-bg-${entry.index}` : '';
  });

  // Reduce the token to the stack's own trailing colour, so the gradient stops
  // reaching the renderer at all and the token's non-background consumers
  // (see the rule comment above) get a valid colour. Only for vars whose every
  // user got a bitmap; anything else keeps the live gradient as its fallback.
  const fullyRastered = new Set(
    [...gradientVars.keys()].filter((varName) =>
      perSlide.every((hit, i) => {
        if (!hit || hit.varName !== varName) return true;
        return Boolean(stageClasses[i]);
      }),
    ),
  );
  // A var nobody uses cannot be "fully rastered" in any meaningful sense, but
  // leaving its gradient in the document costs a renderer nothing (no element
  // references it) and rewriting it would be a change we cannot verify.
  const usedVars = new Set(perSlide.filter(Boolean).map((h) => h.varName));

  const rewrittenCss = String(themeVarsCss).replace(
    VAR_DECL_RE,
    (whole, name, value) => {
      if (!usedVars.has(name) || !fullyRastered.has(name)) return whole;
      const base = TRAILING_COLOR_RE.exec(value.trim());
      return `${name}: ${base ? base[1] : 'transparent'}`;
    },
  );

  return {
    themeVarsCss: rewrittenCss,
    extraCss: rules.join('\n'),
    stageClasses,
    rasterCount,
  };
}
