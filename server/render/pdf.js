import { buildSlidesPdfHtml } from '../export/pdf-slides.js';
import {
  getPuppeteerBrowser,
  toNodeBuffer,
} from '../utils/puppeteer-browser.js';
import { settleRenderedPage } from '../utils/settle-rendered-page.js';
import {
  exportRenderTimeoutMs,
  loadExportDocument,
} from './load-export-document.js';

export async function renderSlidesToPdfBuffer(
  repoRoot,
  pres,
  { theme = null, slideTypes = null } = {},
) {
  const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
  const page = await browser.newPage();
  try {
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
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
