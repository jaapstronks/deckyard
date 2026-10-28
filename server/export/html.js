/**
 * The standalone/published canvas path: prepare, then render.
 *
 * This module is the **preparer**. It reads what only an installation can
 * answer - the visibility filter, the theme's CSS and fonts, the upload bytes
 * behind an image reference - and hands the result to `./canvas-document.js`,
 * which assembles the document from that frozen input and nothing else. The
 * split is what makes a published edition reproducible: a sealed render bundle
 * carries the assembler and gets its input from the edition record
 * (`server/render/renderer-bundle/`, `docs/reference/renderer-bundle.md`).
 */

import { filterForExport, filterForPublished } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { embedImgSrcDataUrls } from '../utils/html-utils.js';
import { loadExportCssBundle, embedSlideImages } from './css-bundle.js';
import { exportImageEmbedTransform } from './image-compress.js';
import { inlineLocalFontUrls } from '../utils/embed-fonts.js';
import { renderCanvasDocument } from './canvas-document.js';

/** True for an `http(s)` URL, which is all a `<link>`/`<script>` may carry. */
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Managed-font `<link>`/`<script>` tags for a theme (Adobe, Monotype, Google).
 *
 * @param {object|null} theme - Effective theme record
 * @returns {{cssLinks: string, scripts: string}}
 */
function externalFontTags(theme) {
  const links = Array.isArray(theme?.externalFontLinks)
    ? theme.externalFontLinks.filter((l) => l.url && isSafeUrl(l.url))
    : [];
  return {
    cssLinks: links
      .filter((l) => l.type === 'css')
      .map(
        (l) =>
          `<link rel="stylesheet" href="${l.url.replace(/"/g, '&quot;')}" />`,
      )
      .join('\n    '),
    scripts: links
      .filter((l) => l.type === 'js')
      .map((l) => `<script src="${l.url.replace(/"/g, '&quot;')}"></script>`)
      .join('\n    '),
  };
}

export async function buildStandaloneHtml(
  repoRoot,
  pres,
  {
    headHtml = '',
    topbarRightHtml = '',
    theme = null,
    watermark = null,
    context = 'export',
    slideTypes = null,
    description = null,
  } = {},
) {
  // Apply the appropriate visibility filter based on context
  pres =
    context === 'published'
      ? filterForPublished(pres, { slideTypes })
      : filterForExport(pres, { slideTypes });
  const docLang = resolveDocLangFromPresentation(pres);
  // The deck's own language, for slide types that render built-in copy. Not
  // the same value as docLang: that one always answers (falling back to nl for
  // <html lang>), this one stays null when the deck names no language so the
  // copy table can apply its own documented default.
  const deckLang = resolveDeckLang(pres);
  // Meta description: use the caller-supplied string (the published route
  // passes one with its own fallback), else the deck's own description. The
  // reader view already emits this; the visual export/published head didn't.
  const metaDescription = (
    typeof description === 'string' && description.trim()
      ? description
      : typeof pres?.description === 'string'
        ? pres.description
        : ''
  ).trim();
  // Images are downsampled as they are inlined, with the same flat cap as the
  // PDF and PNG routes (B302): a deck of 48 full-resolution photos made a
  // 307 MB download and a 322 MB published page per visitor (B717). No
  // display-aware pass here: that one measures in headless Chrome, and this
  // document is built without a browser, per visitor for a /p/ page.
  const imageTransform = exportImageEmbedTransform();
  const embedCache = new Map();
  const css = await loadExportCssBundle(repoRoot, theme, watermark, {
    slides: pres.slides || [],
    slideTypes,
    transform: imageTransform,
    cache: embedCache,
  });

  // Inline any root-relative local font file a bundled stylesheet still
  // references (a custom theme's own face) as a data URL, so a downloaded
  // standalone file renders it offline instead of falling back to system fonts
  // on a dead `/assets/...woff2` reference. Theme fonts are already embedded
  // via css.fontCss; this only embeds what the CSS actually references, never
  // the whole ~2.7 MB pinned library. See
  // docs/reference/standalone-html-export.md.
  const [chromeCss, slidesCss] = await Promise.all([
    inlineLocalFontUrls(repoRoot, css.chromeCss),
    inlineLocalFontUrls(repoRoot, css.slidesCss),
  ]);

  // Embed uploads + /client assets (Lucide icon SVGs), so the downloaded
  // standalone HTML works without a server. Shared cache dedupes the same
  // source across this pass and the rendered-HTML pass in the assembler.
  const slides = await embedSlideImages(repoRoot, pres.slides, {
    transform: imageTransform,
    cache: embedCache,
  });

  const externalFonts = externalFontTags(theme);

  return renderCanvasDocument(repoRoot, pres, {
    slides,
    css: { ...css, chromeCss, slidesCss },
    theme,
    slideTypes,
    docLang,
    deckLang,
    metaDescription,
    headHtml,
    topbarRightHtml,
    context,
    externalFontCssLinks: externalFonts.cssLinks,
    externalFontScripts: externalFonts.scripts,
    htmlTransform: (html) =>
      embedImgSrcDataUrls(repoRoot, html, {
        transform: imageTransform,
        cache: embedCache,
      }),
  });
}
