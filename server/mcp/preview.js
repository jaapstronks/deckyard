/**
 * MCP Slide Preview — generates self-contained HTML for rendering in Claude Desktop artifacts.
 *
 * Uses a minimal CSS bundle (slide CSS + theme vars only, no app.css or fonts)
 * to keep the output small enough for inline artifact rendering.
 * Slides are rendered at a 1600×900 canvas and scaled to fit the preview frame.
 */

import path from 'node:path';
import { renderSlideHtml } from '../../shared/slide-types.js';
import { readCssWithImports } from '../utils/read-css-with-imports.js';
import { readTextIfExists } from '../utils/html-utils.js';
import { themeVarsCssText } from '../utils/themes.js';
import { embedSlideImages } from '../export/css-bundle.js';
import { repoRoot } from '../config/paths.js';

let _slidesCssCache = null;

/**
 * Load and cache the minimal slide CSS (slides.css + theme.css only).
 * Skips app.css (~458KB) and font embeddings to keep output small.
 */
async function getMinimalCss() {
  if (_slidesCssCache) return _slidesCssCache;

  const [slidesCss, themeCss] = await Promise.all([
    readCssWithImports(repoRoot, path.join(repoRoot, 'client', 'styles', 'slides.css')),
    readTextIfExists(path.join(repoRoot, 'client', 'styles', 'theme.css')),
  ]);

  _slidesCssCache = `${themeCss || ''}\n${slidesCss}`;
  return _slidesCssCache;
}

/**
 * Build a self-contained HTML preview of one or more slides.
 * Uses the same rendering pipeline as the PDF/PNG export.
 *
 * @param {Array} slides - Array of slide objects ({ type, content, ... })
 * @param {Object} options
 * @param {Object} options.theme - Theme object (from loadTheme)
 * @param {string} options.title - Presentation title
 * @param {number} options.startIndex - Starting slide index (for numbering)
 * @returns {Promise<string>} Self-contained HTML string
 */
export async function buildSlidePreviewHtml(slides, { theme = null, title = '', startIndex = 0 } = {}) {
  const baseCss = await getMinimalCss();
  const themeVars = theme ? themeVarsCssText(theme) : '';

  // Embed local images as data URLs
  const embeddedSlides = await embedSlideImages(repoRoot, slides);

  // Render each slide at 1600×900
  const slideHtmls = embeddedSlides.map((slide, i) => {
    const html = renderSlideHtml(slide, { theme });
    const num = startIndex + i + 1;
    return `
      <div class="preview-item">
        <div class="preview-label">${num}. ${escHtml(slide.type)}</div>
        <div class="preview-frame">
          <div class="preview-stage ps-theme">${html}</div>
        </div>
      </div>
    `;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escHtml(title || 'Slide Preview')}</title>
  <style>
    /* Theme variables */
    ${themeVars}
    /* Deckyard slide styles */
    ${baseCss}

    /* Disable animated gradients in preview */
    .ps-theme { --t-gradient-enabled: 0; }

    /* Preview chrome */
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
  </style>
  <script>
    // Scale each 1600×900 stage to fit its frame container
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
  </script>
</head>
<body>
  <div class="preview-header">
    <h1>${escHtml(title || 'Slide Preview')}</h1>
    <p>${slides.length} slide${slides.length !== 1 ? 's' : ''}</p>
  </div>
  <div class="preview-list">
    ${slideHtmls.join('\n')}
  </div>
</body>
</html>`;
}

/**
 * Build preview for a single slide (same technique, lighter output).
 */
export async function buildSingleSlidePreviewHtml(slide, { theme = null } = {}) {
  const baseCss = await getMinimalCss();
  const themeVars = theme ? themeVarsCssText(theme) : '';

  // Embed local images
  const [embeddedSlide] = await embedSlideImages(repoRoot, [slide]);

  const html = renderSlideHtml(embeddedSlide, { theme });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    ${themeVars}
    ${baseCss}
    .ps-theme { --t-gradient-enabled: 0; }
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
  </style>
  <script>
    function scaleStage() {
      var frame = document.querySelector('.frame');
      var stage = document.querySelector('.stage');
      if (frame && stage) {
        stage.style.transform = 'scale(' + (frame.offsetWidth / 1600) + ')';
      }
    }
    window.addEventListener('load', scaleStage);
    window.addEventListener('resize', scaleStage);
  </script>
</head>
<body>
  <div class="frame">
    <div class="stage ps-theme">${html}</div>
  </div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
