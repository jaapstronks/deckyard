/**
 * MCP Slide Preview — generates self-contained HTML for rendering in Claude Desktop artifacts.
 *
 * Uses a minimal CSS bundle (slide CSS + theme vars only, no app.css or fonts)
 * to keep the output small enough for inline artifact rendering.
 * Slides are rendered at a 1600×900 canvas and scaled to fit the preview frame.
 */

import path from 'node:path';
import { renderSlideHtml } from '../../shared/slide-types.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { readCssWithImports } from '../utils/read-css-with-imports.js';
import { readTextIfExists } from '../utils/html-utils.js';
import { themeVarsCssText } from '../utils/themes.js';
import { embedSlideImages } from '../export/css-bundle.js';
import { buildCssChain } from '../utils/css-chain.js';
import { buildDocumentHead } from '../utils/head-chain.js';
import { buildScriptChain } from '../utils/script-chain.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../utils/prism-katex.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { repoRoot as defaultRepoRoot } from '../config/paths.js';

/** Fit each 1600x900 stage into its frame. Inert until load/resize, so it can
 *  sit in the head next to the CSS it depends on. */
const LIST_SCALE_SCRIPT = `<script>
  function scaleStages() {
    document.querySelectorAll('.preview-frame').forEach(frame => {
      const stage = frame.querySelector('.preview-stage');
      if (!stage) return;
      const scale = frame.offsetWidth / 1600;
      stage.style.transform = 'scale(' + scale + ')';
    });
  }
  window.addEventListener('load', scaleStages);
  window.addEventListener('resize', scaleStages);
</script>`;

/** The single-slide variant of the same thing. */
const SINGLE_SCALE_SCRIPT = `<script>
  function scaleStage() {
    var frame = document.querySelector('.frame');
    var stage = document.querySelector('.stage');
    if (frame && stage) {
      stage.style.transform = 'scale(' + (frame.offsetWidth / 1600) + ')';
    }
  }
  window.addEventListener('load', scaleStage);
  window.addEventListener('resize', scaleStage);
</script>`;

/** repoRoot -> minimal CSS text. Keyed so a test can point at a fixture root. */
const _slidesCssCache = new Map();

/**
 * Load and cache the minimal slide CSS (slides.css + theme.css only).
 * Skips app.css (~458KB) and font embeddings to keep output small.
 *
 * @param {string} root - Repository root path
 * @returns {Promise<string>}
 */
async function getMinimalCss(root) {
  const hit = _slidesCssCache.get(root);
  if (hit) return hit;

  const [slidesCss, themeCss] = await Promise.all([
    readCssWithImports(root, path.join(root, 'client', 'styles', 'slides.css')),
    readTextIfExists(path.join(root, 'client', 'styles', 'theme.css')),
  ]);

  const css = `${themeCss || ''}\n${slidesCss}`;
  _slidesCssCache.set(root, css);
  return css;
}

/** Previews are static images in a chat client; no animated gradients. */
const GRADIENT_OFF_CSS = `.ps-theme { --t-gradient-enabled: 0; }`;

/** The preview page's own chrome (header, frame, scaled stage) for the list view. */
const PREVIEW_CHROME_CSS = `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #333;
    }
    .preview-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .preview-header h1 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 4px;
    }
    .preview-header p {
      font-size: 13px;
      color: #888;
      margin: 0;
    }
    .preview-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 960px;
      margin: 0 auto;
    }
    .preview-label {
      font-size: 11px;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .preview-frame {
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      position: relative;
      /* 16:9 aspect ratio via padding trick */
      width: 100%;
      padding-top: 56.25%; /* 9/16 = 0.5625 */
    }
    .preview-stage {
      position: absolute;
      top: 0;
      left: 0;
      width: 1600px;
      height: 900px;
      transform-origin: top left;
      /* Scale 1600px canvas to fit the container width */
    }
    .preview-stage .slide {
      width: 1600px;
      height: 900px;
      max-width: none;
      max-height: none;
    }
`;

/** Same chrome, single-slide variant. */
const SINGLE_PREVIEW_CHROME_CSS = `
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f5f5; }
    .frame {
      position: relative;
      width: 100%;
      padding-top: 56.25%;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .stage {
      position: absolute;
      top: 0;
      left: 0;
      width: 1600px;
      height: 900px;
      transform-origin: top left;
    }
    .stage .slide {
      width: 1600px;
      height: 900px;
      max-width: none;
      max-height: none;
    }
`;

/**
 * Build a self-contained HTML preview of one or more slides.
 * Uses the same rendering pipeline as the PDF/PNG export.
 *
 * @param {Array} slides - Array of slide objects ({ type, content, ... })
 * @param {Object} options
 * @param {Object} options.theme - Theme object (from loadThemeAssets)
 * @param {string} options.title - Presentation title
 * @param {number} options.startIndex - Starting slide index (for numbering)
 * @param {'nl'|'en-GB'|null} [options.lang] - Deck language, from `resolveDeckLang(pres)`:
 *   which copy table a slide type reads. Not the same as `docLang`.
 * @param {string} [options.docLang] - Document language for `<html lang>`, from
 *   `resolveDocLangFromPresentation(pres)`. Falls back to resolving it from the
 *   slides alone, which cannot see a deck-level `pres.lang`.
 * @param {string} [options.repoRoot] - Repository root (override for tests)
 * @returns {Promise<string>} Self-contained HTML string
 */
export async function buildSlidePreviewHtml(
  slides,
  {
    theme = null,
    title = '',
    startIndex = 0,
    lang = null,
    docLang = '',
    repoRoot = defaultRepoRoot,
  } = {},
) {
  const baseCss = await getMinimalCss(repoRoot);
  const themeVars = theme ? themeVarsCssText(theme) : '';

  // Embed local images as data URLs
  const embeddedSlides = await embedSlideImages(repoRoot, slides);

  // Render each slide at 1600×900
  const slideHtmls = embeddedSlides.map((slide, i) => {
    const html = renderSlideHtml(slide, {
      theme,
      stripEditorAttrs: true,
      lang,
    });
    const num = startIndex + i + 1;
    return `
      <div class="preview-item">
        <div class="preview-label">${num}. ${escapeHtml(slide.type)}</div>
        <div class="preview-frame">
          <div class="preview-stage ps-theme">${html}</div>
        </div>
      </div>
    `;
  });

  const highlightNeeds = detectPrismKatexNeeds(slideHtmls.join('\n'));
  return `${buildDocumentHead({
    lang: docLang || resolveDocLangFromPresentation({ slides }),
    title: title || 'Slide Preview',
    head: [
      LIST_SCALE_SCRIPT,
      // A preview is rendered inside a host artifact frame, with no Deckyard
      // origin behind it — everything it needs travels in the string.
      buildPrismKatexTags({ ...highlightNeeds, mode: 'inlined' }),
    ],
    styles: [
      buildCssChain(repoRoot, [
        themeVars,
        baseCss,
        GRADIENT_OFF_CSS,
        PREVIEW_CHROME_CSS,
      ]),
    ],
  })}
  <body>
    <div class="preview-header">
      <h1>${escapeHtml(title || 'Slide Preview')}</h1>
      <p>${slides.length} slide${slides.length !== 1 ? 's' : ''}</p>
    </div>
    <div class="preview-list">
      ${slideHtmls.join('\n')}
    </div>
    ${buildScriptChain({ needs: highlightNeeds })}
  </body>
</html>`;
}

/**
 * Build preview for a single slide (same technique, lighter output).
 *
 * @param {Object} slide - Slide object
 * @param {Object} [options]
 * @param {Object} [options.theme] - Theme object (from loadThemeAssets)
 * @param {'nl'|'en-GB'|null} [options.lang] - Deck language, from `resolveDeckLang(pres)`:
 *   which copy table a slide type reads. Not the same as `docLang`.
 * @param {string} [options.docLang] - Document language for `<html lang>`, from
 *   `resolveDocLangFromPresentation(pres)`. Falls back to resolving it from the
 *   slide alone, which cannot see a deck-level `pres.lang`.
 * @param {string} [options.repoRoot] - Repository root (override for tests)
 * @returns {Promise<string>} Self-contained HTML string
 */
export async function buildSingleSlidePreviewHtml(
  slide,
  { theme = null, lang = null, docLang = '', repoRoot = defaultRepoRoot } = {},
) {
  const baseCss = await getMinimalCss(repoRoot);
  const themeVars = theme ? themeVarsCssText(theme) : '';

  // Embed local images
  const [embeddedSlide] = await embedSlideImages(repoRoot, [slide]);

  const html = renderSlideHtml(embeddedSlide, {
    theme,
    stripEditorAttrs: true,
    lang,
  });

  // No <title>: a single-slide preview is rendered inside a host artifact frame.
  const highlightNeeds = detectPrismKatexNeeds(html);
  return `${buildDocumentHead({
    lang: docLang || resolveDocLangFromPresentation({ slides: [slide] }),
    head: [
      SINGLE_SCALE_SCRIPT,
      buildPrismKatexTags({ ...highlightNeeds, mode: 'inlined' }),
    ],
    styles: [
      buildCssChain(repoRoot, [
        themeVars,
        baseCss,
        GRADIENT_OFF_CSS,
        SINGLE_PREVIEW_CHROME_CSS,
      ]),
    ],
  })}
  <body>
    <div class="frame">
      <div class="stage ps-theme">${html}</div>
    </div>
    ${buildScriptChain({ needs: highlightNeeds })}
  </body>
</html>`;
}
