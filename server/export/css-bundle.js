import path from 'node:path';
import {
  buildEmbeddedFontCss,
  stripFontFacesFromCss,
} from '../utils/embed-fonts.js';
import { readCssWithImports } from '../utils/read-css-with-imports.js';
import { themeVarsCssText } from '../utils/themes.js';
import {
  sandboxWatermarkCss,
  sandboxWatermarkEnabled,
  sandboxWatermarkHtml,
} from '../utils/sandbox-watermark.js';
import {
  readTextIfExists,
  toDataUrlIfLocal,
  imageFieldKeysForType,
} from '../utils/html-utils.js';

/**
 * Load the full CSS bundle needed for export/render HTML documents.
 * Consolidates the repeated CSS + font + watermark assembly used across
 * pdf-slides, png-slides, html, print, and render/png.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object|null} theme - Theme object
 * @param {*} watermark - Watermark config (or null)
 * @returns {Promise<Object>} CSS bundle
 */
export async function loadExportCssBundle(repoRoot, theme, watermark) {
  const [appCss, themeCss, slidesCss, fontCss] = await Promise.all([
    readCssWithImports(repoRoot, path.join(repoRoot, 'client', 'styles', 'app.css')),
    readTextIfExists(path.join(repoRoot, 'client', 'styles', 'theme.css')),
    readCssWithImports(repoRoot, path.join(repoRoot, 'client', 'styles', 'slides.css')),
    buildEmbeddedFontCss(repoRoot, theme),
  ]);

  const themeVarsCss = themeVarsCssText(theme);
  const wmOn = sandboxWatermarkEnabled(watermark);
  const wmCss = wmOn ? sandboxWatermarkCss() : '';
  const wmHtml = wmOn ? sandboxWatermarkHtml() : '';

  return { appCss, themeCss, slidesCss, fontCss, themeVarsCss, wmOn, wmCss, wmHtml };
}

/**
 * Build the <style> content block used by most visual exports (pdf, png, render).
 * Strips @font-face rules from app/slides CSS (since fonts are embedded separately).
 *
 * @param {Object} bundle - CSS bundle from loadExportCssBundle
 * @returns {string} CSS text for a <style> block
 */
export function buildExportStyleContent(bundle) {
  return [
    bundle.fontCss,
    stripFontFacesFromCss(bundle.appCss),
    bundle.themeVarsCss,
    bundle.themeCss,
    stripFontFacesFromCss(bundle.slidesCss),
    bundle.wmCss,
  ].join('\n');
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
 * @returns {Promise<Array>} Cloned slides with embedded images
 */
export async function embedSlideImages(repoRoot, rawSlides, { includeClient = true } = {}) {
  const slides = [];
  for (const slide of rawSlides || []) {
    const cloned = structuredClone(slide);
    const imgKeys = imageFieldKeysForType(cloned?.type);
    for (const k of imgKeys) {
      if (cloned?.content?.[k]) {
        cloned.content[k] = await toDataUrlIfLocal(
          repoRoot,
          cloned.content[k],
          { includeClient },
        );
      }
    }
    slides.push(cloned);
  }
  return slides;
}
