import { buildSlidesPdfHtml } from '../export/pdf-slides.js';
import {
  getPuppeteerBrowser,
  toNodeBuffer,
} from '../utils/puppeteer-browser.js';
import { fireAndForget } from '../utils/fire-and-forget.js';
import { settleRenderedPage } from '../utils/settle-rendered-page.js';
import {
  exportRenderTimeoutMs,
  loadExportDocument,
} from './load-export-document.js';

/**
 * Render the whole deck to one PDF in the shared export browser.
 *
 * One Chrome document for every slide, so there is no slide loop to report
 * from: a streamed PDF export creeps (`export/progress.js`). `signal` cancels
 * it the way it cancels a PNG render: no page when already aborted, and an
 * abort mid-render closes the page.
 *
 * @param {string} repoRoot
 * @param {Object} pres
 * @param {{ theme?: Object|null, slideTypes?: Object|null,
 *   signal?: AbortSignal|null }} [options]
 * @returns {Promise<Buffer>}
 */
export async function renderSlidesToPdfBuffer(
  repoRoot,
  pres,
  { theme = null, slideTypes = null, signal = null } = {},
) {
  signal?.throwIfAborted();
  const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
  const page = await browser.newPage();
  const closeOnAbort = () =>
    fireAndForget(page.close(), 'PDF export: close page on abort');
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  try {
    // An abort while newPage() ran fired before the listener existed.
    signal?.throwIfAborted();
    const html = await buildSlidesPdfHtml(repoRoot, pres, {
      theme,
      slideTypes,
    });
    await loadExportDocument(page, html, {
      label: 'PDF export',
      hint: 'or use the browser-print PDF option instead',
    });
    await settleRenderedPage(page);
    try {
      await page.emulateMediaType('print');
    } catch {
      // ignore
    }
    const buf = await page.pdf({
      timeout: exportRenderTimeoutMs(),
      printBackground: true,
      preferCSSPageSize: true,
      // Native slide size (16:9). No scale transform — see pdf-slides.js for why.
      width: '1600px',
      height: '900px',
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });
    return toNodeBuffer(buf);
  } catch (err) {
    signal?.throwIfAborted();
    throw err;
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
