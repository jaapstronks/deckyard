import path from 'node:path';
import {
  buildEmbeddedFontCss,
  inlineLocalFontUrls,
  stripFontFacesFromCss,
} from '../utils/embed-fonts.js';
import { readCssWithImports } from '../utils/read-css-with-imports.js';
import { buildCssChain, readCustomStylesCss } from '../utils/css-chain.js';
import { themeVarsCssText } from '../utils/themes.js';
import {
  sandboxWatermarkCss,
  sandboxWatermarkEnabled,
  sandboxWatermarkHtml,
} from '../utils/sandbox-watermark.js';
import {
  embedCssUrlsForExport,
  readTextIfExists,
  toDataUrlIfLocal,
  imageFieldKeysForType,
} from '../utils/html-utils.js';
import { mapLimit, exportEmbedConcurrency } from '../utils/map-limit.js';

/**
 * Load the full CSS bundle needed for export/render HTML documents.
 * Consolidates the repeated CSS + font + watermark assembly used across
 * pdf-slides, png-slides, html, print, and render/png.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object|null} theme - Theme object
 * @param {*} watermark - Watermark config (or null)
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Image-bytes transform for inlined theme
 *   assets. A theme background is full-bleed, so the flat cap fits; without
 *   this the largest image on the slide would be the one image embedded at
 *   full resolution.
 * @param {Map<string, Promise<string>>} [opts.cache] - Shared per-run embed
 *   cache, so an asset used both in a theme var and on a slide is fetched and
 *   recompressed once.
 * @returns {Promise<Object>} CSS bundle
 */
export async function loadExportCssBundle(
  repoRoot,
  theme,
  watermark,
  { transform = null, cache = null } = {},
) {
  // `chromeCss` is the viewer/export chrome entrypoint (export.css), NOT the
  // editor's app.css. An exported deck is a viewer: it needs slide CSS + theme
  // + a thin presenter/toolbar chrome layer, never the ~620 KB of editor-only
  // CSS app.css drags in. See client/styles/export.css for the boundary.
  const [chromeCss, themeCss, slidesCss, fontCss] = await Promise.all([
    readCssWithImports(
      repoRoot,
      path.join(repoRoot, 'client', 'styles', 'export.css'),
    ),
    readTextIfExists(path.join(repoRoot, 'client', 'styles', 'theme.css')),
    readCssWithImports(
      repoRoot,
      path.join(repoRoot, 'client', 'styles', 'slides.css'),
    ),
    buildEmbeddedFontCss(repoRoot, theme),
  ]);

  // The fork seam, with any local font file it references inlined as a data
  // URL. Export documents are self-contained (Puppeteer `setContent`, or a
  // downloaded .html): a fork `@font-face` pointing at `/custom/assets/...`
  // has no origin to resolve against there, and would silently fall back to a
  // system font — screen/export drift of exactly the kind this seam removes.
  // The seam is deliberately *not* run through `stripFontFacesFromCss`: a
  // fork's own faces are the point (see docs/reference/fork-setup.md).
  const customCss = await inlineLocalFontUrls(
    repoRoot,
    readCustomStylesCss(repoRoot),
  );

  // Theme vars take the same `url()` pass as the page markup. The export
  // document reaches Chrome through `setContent()`, so it has no base URL:
  // `pagesHtml` has been embedded for a while, but this block is assembled
  // separately and never passed by. Two consequences, one per half of the
  // pass:
  //
  //   - a LOCAL path resolved to nothing, so any theme var holding an asset —
  //     `--t-logo-url`, or a `slideBackgrounds` variant whose value is artwork
  //     — rendered empty in every PDF and PNG;
  //   - a REMOTE URL stayed live, and a theme's variant value is free-form
  //     text any authenticated user can set in the theme editor, so it reached
  //     headless Chrome as a server-side fetch of an attacker-chosen address.
  //     `docs/reference/security-posture.md` § SSRF guard states that no
  //     user-supplied URL reaches Chrome at `setContent` time; until now that
  //     was true of the markup and not of this block.
  //
  // Unconditional on purpose: every caller of this bundle either hands the
  // result to `setContent()` or ships it as a self-contained `.html`, and both
  // want the same answer. A flag here would only be a way to get it wrong.
  // `includeClient` stays off — a theme var has no legitimate `/client/`
  // target, and leaving it on would let a theme inline arbitrary client-tree
  // bytes into every export.
  const themeVarsCss = await embedCssUrlsForExport(
    repoRoot,
    themeVarsCssText(theme),
    { transform, cache },
  );
  const wmOn = sandboxWatermarkEnabled(watermark);
  const wmCss = wmOn ? sandboxWatermarkCss() : '';
  const wmHtml = wmOn ? sandboxWatermarkHtml() : '';

  return {
    repoRoot,
    customCss,
    chromeCss,
    themeCss,
    slidesCss,
    fontCss,
    themeVarsCss,
    wmOn,
    wmCss,
    wmHtml,
  };
}

/**
 * Build the <style> content block used by most visual exports (pdf, png, render).
 * Strips @font-face rules from app/slides CSS (since fonts are embedded separately).
 *
 * Path-specific CSS (document rules, page chrome) goes in `extraCss` rather
 * than into a second <style> after this one: it belongs in the same chain, and
 * only `buildCssChain` may append the fork seam — which stays last.
 *
 * @param {Object} bundle - CSS bundle from loadExportCssBundle
 * @param {Array<string|null|undefined|false>} [extraCss] - Path-specific layers, after core
 * @returns {string} CSS text for a <style> block
 */
export function buildExportStyleContent(bundle, extraCss = []) {
  return buildCssChain(
    bundle.repoRoot,
    [
      bundle.fontCss,
      stripFontFacesFromCss(bundle.chromeCss),
      bundle.themeCss,
      stripFontFacesFromCss(bundle.slidesCss),
      // After the slide stylesheets, matching the embed (`styles:` block after
      // the linked slides.css) and the client (runtime-injected into <head>).
      // No `--t-*` is ever DEFINED in client/styles — they are only consumed —
      // so the vars block is order-independent. The generated
      // `.slide.slide-bg-<id>` variant rules are not: they share two-class
      // specificity with `.slide.has-slide-bg-light-text` in 00-base.css, and a
      // variant's authored textColor/linkColor must outrank that generic
      // luminance default. Sitting before slides.css made this the one path
      // where the default won — screen/export drift on any variant slide that
      // also carried a contrast class.
      bundle.themeVarsCss,
      // Anchor the slide's base font to the theme, not the export chrome. The
      // export <body> carries `font-family: var(--ps-font-sans)` (an app-chrome
      // token → 'Inter', …); slide text that sets no family of its own would
      // otherwise inherit it. But `stripFontFacesFromCss` removes Inter's
      // @font-face here (theme fonts are embedded separately), so that inherited
      // stack falls through to the system font — which Skia can only embed as
      // Type 3 (glyph-as-procedure). `--font-body` is defined on `.slide` itself
      // (theme.css, hard default `Arial, sans-serif`), so this keeps unstyled
      // slide text on an embeddable font and stops the chrome token leaking into
      // the slide layer. Slide-type rules that set `--font-heading`/-body/-mono
      // outrank this (higher specificity), so headings etc. are unchanged.
      '.slide { font-family: var(--font-body); }',
      bundle.wmCss,
      ...(Array.isArray(extraCss) ? extraCss : [extraCss]),
    ],
    { customCss: bundle.customCss },
  );
}

/**
 * Clone slides and embed local image field URLs as data URIs.
 * Consolidates the repeated image-embedding loop used across
 * pdf-slides, png-slides, html, and render/png.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Array} rawSlides - Array of slide objects
 * @param {Object} [options]
 * @param {boolean} [options.includeClient=true] - Include client directory in path resolution
 * @param {Function} [options.transform] - Optional image-bytes transform (see toDataUrlIfLocal)
 * @param {Map<string, Promise<string>>} [options.cache] - Optional per-run embed cache (see toDataUrlIfLocal)
 * @returns {Promise<Array>} Cloned slides with embedded images
 */
export async function embedSlideImages(
  repoRoot,
  rawSlides,
  {
    includeClient = true,
    transform = null,
    embedRemote = false,
    cache = null,
  } = {},
) {
  // Clone synchronously (preserves order), then collect every image field as a
  // {src, set} cell and resolve them concurrently. One slow remote image no
  // longer blocks the rest; the shared cache dedupes repeats within the run.
  const slides = (rawSlides || []).map((slide) => structuredClone(slide));
  const cells = [];
  for (const cloned of slides) {
    for (const k of imageFieldKeysForType(cloned?.type)) {
      if (cloned?.content?.[k]) {
        cells.push({
          src: cloned.content[k],
          set: (v) => {
            cloned.content[k] = v;
          },
        });
      }
    }
  }
  await mapLimit(cells, exportEmbedConcurrency(), async (cell) => {
    cell.set(
      await toDataUrlIfLocal(repoRoot, cell.src, {
        includeClient,
        transform,
        embedRemote,
        cache,
      }),
    );
  });
  return slides;
}
