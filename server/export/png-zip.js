import JSZip from 'jszip';
import { renderSlideToPngBuffer } from '../render/png.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { progressCounter } from './progress.js';

function safeScale(n) {
  const s = Number(n) || 2;
  return Math.max(1, Math.min(3, s));
}

/**
 * Render every slide of a presentation to PNG and bundle them into a single ZIP.
 *
 * Used by the "Download all PNGs" action so the browser receives one file
 * instead of N separate downloads (which browsers block after the first).
 *
 * @param {string} repoRoot - Repository root path
 * @param {Object} pres - Presentation document
 * @param {Object} [options]
 * @param {Object|null} [options.theme] - Resolved theme
 * @param {number} [options.scale=2] - PNG render scale (clamped 1-3)
 * @param {Object|null} [options.slideTypes] - Merged slide types
 * @param {(step: { done: number, total: number }) => void} [options.onProgress]
 *   - called after each rendered slide (`export/progress.js`)
 * @param {AbortSignal} [options.signal] - stops the loop and the slide in
 *   flight when the client went away
 * @returns {Promise<Buffer>} ZIP archive as a Node buffer
 */
export async function buildSlidesPngZipBuffer(
  repoRoot,
  pres,
  {
    theme = null,
    scale = 2,
    slideTypes = null,
    onProgress,
    signal = null,
  } = {},
) {
  const filteredPres = stripLiveOnlySlidesFromPresentation(pres);
  const slides = Array.isArray(filteredPres?.slides) ? filteredPres.slides : [];
  const s = safeScale(scale);
  const lang = resolveDeckLang(pres);
  const docLang = resolveDocLangFromPresentation(pres);

  const zip = new JSZip();
  const rendered = progressCounter(onProgress, slides.length);

  for (let i = 0; i < slides.length; i += 1) {
    const buf = await renderSlideToPngBuffer(repoRoot, slides[i], {
      scale: s,
      theme,
      slideTypes,
      lang,
      docLang,
      signal,
    });
    const name = `slide-${String(i + 1).padStart(2, '0')}.png`;
    zip.file(name, buf);
    rendered();
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
