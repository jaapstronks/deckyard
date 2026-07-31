/* global document, getComputedStyle */ // The page.evaluate() callback below runs in the browser context.
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
 * ## Pseudo-element layers (`::before` / `::after`)
 *
 * Slide types also stack decorative gradients on pseudo-elements, and those cost
 * the same. They cannot be handled by reading CSS text, because whether they
 * paint at all depends on the assembled document's cascade — which a fork can
 * and does change. So they are measured instead: the export document is loaded
 * once in Chrome and every `.slide` is asked for its `::before`/`::after`
 * computed style. A layer is rasterized **only** when its computed `opacity` is
 * not 0 and its computed `background-image` actually holds a gradient.
 *
 * That test is what makes this safe rather than a design change. Upstream sets
 * `--t-gradient-enabled: 0` in every export path, so those layers compute to
 * `opacity: 0`, no spec is produced, and nothing about the output moves. A fork
 * that deliberately keeps the layer visible (ciiic-slides replaced the gate with
 * an `animation: none` rule in 2026-01) gets the layer rasterized instead of
 * re-shaded per pixel.
 *
 * Measured on the `ciiic` theme with that fork's override, 6 pages of
 * `icon-card-grid-slide` under Ghostscript at 110 dpi: **1.225 s → 0.046 s per
 * page**, the same number as the untouched upstream export. All of that cost is
 * `.slide-icon-card-grid::after`, an alpha `linear-gradient`. Its `::before`
 * sibling — the layer the fork's briefing asked us to rasterize — is *not*
 * touched here, because it paints nothing to rasterize: see the note below.
 *
 * ## The `::before` gradient layer paints nothing, in any export
 *
 * `--t-slide-gradient-bg` is declared on `.ps-theme` (the stage) by
 * `themeVarsCssText()`, and its value references `var(--g1x)` … `var(--g3y)`,
 * which `gradientVarsForSlide()` sets on the **slide root** — a descendant. A
 * custom property's `var()` references are substituted where that property is
 * *computed*, i.e. on `.ps-theme`, where `--g1x` does not exist. The result is
 * guaranteed-invalid, inherits down as invalid, and
 * `background: var(--t-slide-gradient-bg, transparent)` falls back to nothing.
 * Measured on both `midnight` and `ciiic` with the gate forced open: computed
 * `opacity: 1` and computed `background-image: none`. Setting `--g1x` on
 * `.ps-theme` itself makes it paint immediately — that is the proof of the
 * mechanism.
 *
 * So the opacity test above is not the only reason those layers are skipped;
 * there is literally no image to copy. Resolving the vars from the slide root by
 * hand (as the `--t-slide-bg-*` path does) would *add* a gradient the live export
 * does not draw, which is a visual change disguised as a performance fix.
 * Reported back to ciiic-slides; whether the layer should paint at all is a
 * theme/renderer decision, not an export one.
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
 * Open a page on the shared browser, or `null` when no browser is available.
 *
 * Opening the page belongs in the same guard as launching the browser.
 * `getPuppeteerBrowser` caches its launch promise for the process lifetime, so a
 * Chrome that dies after the first export leaves a resolved-but-dead Browser
 * whose `newPage()` rejects. Letting that escape would fail the whole export —
 * and worse, the `/export/pdf-slides` HTML preview route, which reaches this
 * module without otherwise needing a browser at all.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.offline] - Abort every non-`data:` subresource request.
 * @returns {Promise<import('puppeteer-core').Page|null>}
 */
async function openRasterPage({ offline = false } = {}) {
  try {
    const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
    const page = await browser.newPage();
    if (offline) {
      // Enforced, not assumed. The export inlines every user-supplied image
      // through the SSRF guard, but that pass runs *after* this module, so any
      // page we open here would otherwise let Chrome fetch a raw remote
      // `<img src>` (a theme's `assets.logo`, custom HTML) straight from the
      // deck — no guard, no allow-list. Nothing measured or rendered here
      // depends on a subresource, so the safe answer is to fetch none.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        const allowed = url.startsWith('data:') || url === 'about:blank';
        Promise.resolve(allowed ? req.continue() : req.abort()).catch(() => {
          // The page can close mid-flight; a dangling request is not an error.
        });
      });
    }
    return page;
  } catch (err) {
    // No Chrome (or no puppeteer-core) is a normal state for some installs and
    // for the HTML preview route. The live gradient still renders.
    debugLog(`[pdf-export] gradient raster skipped: ${err?.message || err}`);
    return null;
  }
}

/**
 * A single bitmap to render.
 *
 * @typedef {Object} LayerSpec
 * @property {string} style - CSS declarations painting the layer (no trailing `;`).
 * @property {number} width - Bitmap width in CSS pixels.
 * @property {number} height - Bitmap height in CSS pixels.
 * @property {boolean} opaque - Whether the layer is fully opaque (JPEG vs PNG).
 */

/**
 * Render layer specs to image data URLs in one headless-Chrome page.
 *
 * JPEG when the layer is fully opaque (a soft wash is the best case JPEG has, and
 * it is several times smaller than PNG); PNG when it is not, because JPEG has no
 * alpha and would flatten the transparent part to black.
 *
 * The viewport is the largest single spec, not the sum: element screenshots
 * scroll their target into view, so a deck with many distinct backgrounds no
 * longer asks Chrome for a viewport tens of thousands of pixels tall.
 *
 * @param {LayerSpec[]} specs
 * @returns {Promise<Array<string|null>>} A data URL per spec, `null` on failure.
 */
async function renderLayersToDataUrls(specs) {
  if (!specs.length) return [];

  const page = await openRasterPage();
  if (!page) return specs.map(() => null);

  try {
    await page.setViewport({
      width: Math.max(...specs.map((s) => s.width)),
      height: Math.max(...specs.map((s) => s.height)),
    });
    // Every spec in one document: N screenshots, one setContent. Each div is
    // exactly the bitmap's size, so a percentage stop or a percentage
    // `background-size` resolves against the same box shape it has on the slide.
    const divs = specs
      .map(
        (s, i) =>
          `<div id="g${i}" style="width:${s.width}px;height:${s.height}px;${s.style.replace(
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
    for (let i = 0; i < specs.length; i++) {
      try {
        const { opaque } = specs[i];
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
    return specs.map(() => null);
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}

/** Pseudo-elements that may carry a decorative gradient layer. */
const PSEUDO_ELEMENTS = ['::before', '::after'];

/** Any `--t-gradient-enabled: <value>` declaration in a stylesheet. */
const GRADIENT_ENABLED_RE = /--t-gradient-enabled\s*:\s*([^;}]+)/g;

/**
 * Whether the document could have a visible gradient pseudo-layer at all.
 *
 * Launching Chrome to measure is only worth it when the answer might be yes, and
 * an export whose every `--t-gradient-enabled` declaration is `0` has no way to
 * produce one: each of those layers reads that property as its `opacity`. This
 * is a **fast path, not the decision** — it can only skip work, never approve
 * rasterizing something. The opacity test in the probe still has the last word.
 *
 * Deliberately conservative in both directions. A single non-zero declaration
 * anywhere is enough to probe (upstream's `midnight` theme declares `1` and the
 * export path then overrides it to `0`; that costs one probe that finds
 * nothing). Anything unparseable — a `var()`, a fork's own expression — also
 * counts as "might paint".
 *
 * The limitation worth knowing: a fork that re-enables the layer *without* the
 * property, by overriding `opacity` on the pseudo-element directly, is skipped
 * here. Re-enable it through the theme (`gradient.enabled`) or through this
 * property, which is what the ciiic-slides fork does.
 *
 * @param {string} styleContent - Everything that goes in the document's `<style>`.
 * @returns {boolean}
 */
export function mayHaveVisibleGradientLayer(styleContent) {
  for (const m of String(styleContent || '').matchAll(GRADIENT_ENABLED_RE)) {
    if (parseFloat(m[1].trim()) !== 0) return true;
  }
  // Every declaration is 0 — or there is none at all, which means no theme
  // contributed one and the layers fall back to
  // `var(--t-slide-gradient-bg, transparent)` with nothing to paint.
  return false;
}

/**
 * Dedupe key for a measured pseudo-element layer.
 *
 * Every property that changes a pixel is in the key, including the box size: two
 * slides whose layer differs only in `--g1x` are two bitmaps, exactly as on the
 * `--t-slide-bg-*` path. The rounding keeps sub-pixel layout noise from splitting
 * one bitmap into two identical ones.
 *
 * @param {Object} layer
 * @returns {string}
 */
function pseudoLayerKey(layer) {
  return JSON.stringify([
    layer.pseudo,
    layer.backgroundImage,
    layer.backgroundColor,
    layer.backgroundSize,
    layer.backgroundPosition,
    layer.backgroundRepeat,
    Math.round(layer.width),
    Math.round(layer.height),
  ]);
}

/**
 * Ask the real export document which pseudo-element layers actually paint a
 * gradient.
 *
 * This has to be a measurement rather than a read of the CSS text. Whether a
 * layer paints depends on the assembled cascade — the export path's own
 * `--t-gradient-enabled: 0`, the theme's `gradient.enabled`, and whatever a fork
 * has done to either — and on whether the custom property holding the gradient
 * could resolve its own `var()` references at all (see the module comment: on
 * upstream it cannot, so `background-image` computes to `none`).
 *
 * @param {Object} opts
 * @param {string} opts.styleContent - Everything that goes in the document's `<style>`.
 * @param {string[]} opts.slidesHtml - Rendered slide HTML, in page order.
 * @returns {Promise<Array<Array<{pseudo: string, style: string, width: number, height: number, opaque: boolean}>>>}
 *   Per slide, the layers worth rasterizing (usually empty).
 */
async function probePseudoLayers({ styleContent, slidesHtml }) {
  const empty = slidesHtml.map(() => []);
  // Never start a browser on a document that cannot have one of these layers.
  // Most exports are in that case, and paying a Chrome page-load for every one
  // of them would be a real regression on the HTML preview route.
  if (!styleContent || !mayHaveVisibleGradientLayer(styleContent)) return empty;

  // `offline`: the slide HTML reaching this point has *not* been through
  // `embedImgSrcDataUrls` yet, so it can still carry a raw remote `<img src>`.
  // See the note in `openRasterPage`.
  const page = await openRasterPage({ offline: true });
  if (!page) return empty;

  try {
    // The same wrappers the real document uses, so `.pdf-stage`/`.ps-theme`
    // selectors and the 1600x900 stage box resolve identically. Deliberately
    // without the CDN <script>/<link> tags: this probe must not reach the
    // network, and nothing it measures depends on them.
    const body = slidesHtml
      .map((s) => `<div class="pdf-page"><div class="pdf-stage ps-theme">${s}</div></div>`)
      .join('\n');
    await page.setViewport({ width: 1600, height: 900 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>${styleContent}</style>${body}`,
      // Local <img src> paths cannot resolve under setContent (no base URL), so
      // waiting for `load` would only wait for them to fail. Nothing measured
      // here depends on an image having loaded.
      { waitUntil: 'domcontentloaded' },
    );

    return await page.evaluate((pseudos) => {
      // Iterate the stages, not the slides: one entry per page, in page order,
      // even if a page's markup has no `.slide` root. The caller indexes the
      // result against `slidesHtml`, so a length mismatch would silently move
      // every bitmap one slide over.
      const stages = Array.from(document.querySelectorAll('.pdf-stage'));
      return stages.map((stage) => {
        const el = stage.querySelector(':scope > .slide');
        const out = [];
        if (!el) return out;
        const rect = el.getBoundingClientRect();
        for (const pseudo of pseudos) {
          const cs = getComputedStyle(el, pseudo);
          if (!cs || cs.content === 'none') continue;
          // The two tests that keep this from changing what the export looks
          // like: an invisible layer stays invisible, and a layer with no
          // gradient has nothing to win.
          if (!(parseFloat(cs.opacity) > 0)) continue;
          const image = cs.backgroundImage || 'none';
          if (image === 'none' || !/gradient\(/i.test(image)) continue;
          // A layer that also pulls in an external image cannot be reproduced in
          // the isolated render page, so leave it live.
          if (/\burl\(/i.test(image)) continue;

          // The pseudo-element's own box. It is positioned against the slide, so
          // its computed insets are px against that box — `inset: -12%` on a
          // 1600x900 stage gives 1984x1116, and the bitmap has to match or the
          // percentage `background-size` lands somewhere else.
          const px = (v) => (v.endsWith('px') ? parseFloat(v) : NaN);
          const w = rect.width - px(cs.left) - px(cs.right);
          const h = rect.height - px(cs.top) - px(cs.bottom);
          if (!(w > 0) || !(h > 0)) continue;

          out.push({
            pseudo,
            slideWidth: rect.width,
            backgroundColor: cs.backgroundColor,
            backgroundImage: image,
            backgroundSize: cs.backgroundSize,
            backgroundPosition: cs.backgroundPosition,
            backgroundRepeat: cs.backgroundRepeat,
            width: w,
            height: h,
          });
        }
        return out;
      });
    }, PSEUDO_ELEMENTS);
  } catch (err) {
    debugLog(`[pdf-export] pseudo-layer probe failed: ${err?.message || err}`);
    return empty;
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
 * @param {string} [opts.styleContent] - Everything that goes in the document's
 *   `<style>`. Without it the pseudo-element pass is skipped: it can only be
 *   decided by measuring the real cascade.
 * @param {number} [opts.width] - Bitmap width in CSS pixels.
 * @returns {Promise<{themeVarsCss: string, extraCss: string, stageClasses: string[], rasterCount: number}>}
 */
export async function rasterizeGradientBackgrounds({
  themeVarsCss,
  slidesHtml,
  styleContent = '',
  width = gradientRasterWidth(),
}) {
  const slides = Array.isArray(slidesHtml) ? slidesHtml : [];
  const none = {
    themeVarsCss: String(themeVarsCss || ''),
    extraCss: '',
    stageClasses: slides.map(() => ''),
    rasterCount: 0,
  };
  if (!width || !slides.length) return none;

  const gradientVars = findGradientBgVars(themeVarsCss);

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

  // The pseudo-element pass is a measurement of the assembled document, so it
  // runs even when no `--t-slide-bg-*` gradient exists — the two are unrelated.
  const perSlidePseudo = await probePseudoLayers({ styleContent, slidesHtml: slides });

  /** @type {Map<string, {index: number, layer: Object}>} */
  const byPseudo = new Map();
  for (const layers of perSlidePseudo) {
    for (const layer of layers) {
      const key = pseudoLayerKey(layer);
      if (byPseudo.has(key)) continue;
      byPseudo.set(key, { index: byPseudo.size, layer });
    }
  }

  if (!bySignature.size && !byPseudo.size) return none;

  // Both kinds of bitmap in one render page.
  const signatures = [...bySignature.keys()];
  const bgSpecs = signatures.map((value) => ({
    style: `background:${value}`,
    width,
    height: Math.max(1, Math.round(width * SLIDE_ASPECT)),
    opaque: isOpaqueColor(TRAILING_COLOR_RE.exec(value)?.[1]),
  }));
  const pseudoEntries = [...byPseudo.values()];
  const pseudoSpecs = pseudoEntries.map(({ layer }) => {
    // Scale on the layer's own box, not the slide's: `inset: -12%` makes the box
    // 124% of the slide, and 512px across the slide would only be 413px across
    // the bitmap that has to cover it.
    const w = Math.max(1, Math.round((width * layer.width) / (layer.slideWidth || layer.width)));
    return {
      style:
        `background-color:${layer.backgroundColor};` +
        `background-image:${layer.backgroundImage};` +
        `background-size:${layer.backgroundSize};` +
        `background-position:${layer.backgroundPosition};` +
        `background-repeat:${layer.backgroundRepeat}`,
      width: w,
      height: Math.max(1, Math.round((w * layer.height) / layer.width)),
      opaque: isOpaqueColor(layer.backgroundColor),
    };
  });

  const startedAt = Date.now();
  const allUrls = await renderLayersToDataUrls([...bgSpecs, ...pseudoSpecs]);
  const dataUrls = allUrls.slice(0, bgSpecs.length);
  const pseudoUrls = allUrls.slice(bgSpecs.length);
  const rasterCount = allUrls.filter(Boolean).length;
  debugLog(
    `[pdf-export] rasterized ${rasterCount}/${allUrls.length} gradient layer(s) ` +
      `(${dataUrls.filter(Boolean).length} slide background, ` +
      `${pseudoUrls.filter(Boolean).length} pseudo-element) at ${width}px ` +
      `in ${Date.now() - startedAt}ms`,
  );
  if (!rasterCount) return none;

  // One rule per distinct pseudo-element layer. Same shape as the slide-background
  // rule below: override the paint, never the custom property behind it.
  const pseudoRules = [];
  pseudoEntries.forEach(({ layer }, i) => {
    const dataUrl = pseudoUrls[i];
    if (!dataUrl) return;
    pseudoRules.push(
      `.pdf-stage.grad-px-${i} > .slide${layer.pseudo} {\n` +
        `  background-image: url("${dataUrl}");\n` +
        `  background-size: 100% 100%;\n` +
        `  background-position: 0 0;\n` +
        `  background-repeat: no-repeat;\n` +
        `}`,
    );
  });

  const pseudoClasses = perSlidePseudo.map((layers) =>
    layers
      .map((layer) => byPseudo.get(pseudoLayerKey(layer)))
      .filter((entry) => entry && pseudoUrls[entry.index])
      .map((entry) => `grad-px-${entry.index}`)
      .join(' '),
  );

  if (!dataUrls.filter(Boolean).length) {
    // Nothing to say about the slide backgrounds; ship the pseudo layers alone.
    return {
      themeVarsCss: String(themeVarsCss || ''),
      extraCss: pseudoRules.join('\n'),
      stageClasses: pseudoClasses,
      rasterCount,
    };
  }

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

  const bgClasses = perSlide.map((hit) => {
    if (!hit) return '';
    const entry = bySignature.get(hit.signature);
    return dataUrls[entry.index] ? `grad-bg-${entry.index}` : '';
  });
  // A slide can need both kinds of bitmap; the stage carries one class per layer.
  const stageClasses = bgClasses.map((bg, i) =>
    [bg, pseudoClasses[i]].filter(Boolean).join(' '),
  );

  // Reduce the token to the stack's own trailing colour, so the gradient stops
  // reaching the renderer at all and the token's non-background consumers
  // (see the rule comment above) get a valid colour. Only for vars whose every
  // user got a bitmap; anything else keeps the live gradient as its fallback.
  const fullyRastered = new Set(
    [...gradientVars.keys()].filter((varName) =>
      // `bgClasses`, not `stageClasses`: a slide can carry a pseudo-element class
      // while its own background raster failed, and that must not read as "this
      // var is fully handled" — the token would lose a gradient still in use.
      perSlide.every((hit, i) => {
        if (!hit || hit.varName !== varName) return true;
        return Boolean(bgClasses[i]);
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
    extraCss: [...rules, ...pseudoRules].join('\n'),
    stageClasses,
    rasterCount,
  };
}
