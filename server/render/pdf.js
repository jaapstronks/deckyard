import { buildSlidesPdfHtml } from '../export/pdf-slides.js';
import { getPuppeteerBrowser } from '../utils/puppeteer-browser.js';

/** Puppeteer raises a TimeoutError (name === 'TimeoutError') on timeout. */
function isTimeoutError(err) {
  return err?.name === 'TimeoutError' || /Timed out/i.test(err?.message || '');
}

/**
 * Timeout (ms) for the Puppeteer setContent + pdf steps. Puppeteer's own
 * default is 30_000, which a large deck (all slides + base64-embedded images in
 * one HTML) can blow past on the `load` event — surfacing as a hard
 * "Timed out after waiting 30000ms" export error. Configurable via
 * PDF_EXPORT_TIMEOUT_MS; `0` disables the cap (Puppeteer convention), but a
 * finite default keeps a genuinely broken render from hanging forever.
 */
function pdfExportTimeoutMs() {
  const raw = process.env.PDF_EXPORT_TIMEOUT_MS;
  if (raw == null || raw === '') return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 120_000;
}

export async function renderSlidesToPdfBuffer(
  repoRoot,
  pres,
  { theme = null, slideTypes = null } = {}
) {
  const browser = await getPuppeteerBrowser({ featureName: 'PDF export' });
  const page = await browser.newPage();
  const timeout = pdfExportTimeoutMs();
  // Applies to setContent and page.pdf below (and any other page op that honors
  // the default). One call is cleaner than threading `timeout` per option.
  page.setDefaultTimeout(timeout);
  try {
    const html = await buildSlidesPdfHtml(repoRoot, pres, { theme, slideTypes });
    try {
      await page.setContent(html, { waitUntil: 'load', timeout });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error(
          'PDF export timed out while rendering the deck. The deck may be too ' +
            'large; raise PDF_EXPORT_TIMEOUT_MS, or use the browser-print PDF ' +
            'option instead.'
        );
      }
      throw err;
    }
    try {
      await page.evaluate(() => document.fonts?.ready);
    } catch {
      // ignore
    }
    try {
      await page.emulateMediaType('print');
    } catch {
      // ignore
    }
    const buf = await page.pdf({
      timeout,
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
    return buf;
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
