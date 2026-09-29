import { envInt } from '../config/utils.js';

/** Puppeteer raises a TimeoutError (name === 'TimeoutError') on timeout. */
function isTimeoutError(err) {
  return err?.name === 'TimeoutError' || /Timed out/i.test(err?.message || '');
}

/**
 * Timeout (ms) for every headless-Chrome export render: the `setContent` load,
 * and whatever page op honours the page default after it (`page.pdf`,
 * `page.screenshot`). Puppeteer's own default is 30_000, which a document with
 * base64-embedded images can blow past while Chrome is still parsing it.
 * Configurable via EXPORT_RENDER_TIMEOUT_MS; `0` disables the cap (Puppeteer
 * convention), but a finite default keeps a genuinely broken render from
 * hanging forever.
 *
 * @returns {number}
 */
export function exportRenderTimeoutMs() {
  return envInt('EXPORT_RENDER_TIMEOUT_MS', 120_000, { min: 0 });
}

/**
 * Load an assembled export document into a page, the one way every export
 * render does it.
 *
 * Waits for `load`, never `networkidle0`: the document carries its images as
 * data URLs, which are not network, so Chrome's idle timer can fire while the
 * parser is still writing a large document — before the new document's `init`,
 * which clears what Puppeteer has seen. The `networkIdle` it then waits for
 * never comes and the render dies on the timeout (B302). `load` fires after
 * every `<img>` has decoded; `settleRenderedPage()` covers fonts and frames.
 *
 * Sets the page default timeout too, so the capture step that follows (pdf,
 * screenshot) shares the cap. A timeout is rethrown as a plain Error naming the
 * env var, so an `export_failed` in the log says what to do about it.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} html - Complete export document
 * @param {Object} opts
 * @param {string} opts.label - What is rendering, e.g. 'PDF export'
 * @param {string} [opts.hint] - An extra remedy appended to the timeout message
 * @returns {Promise<void>}
 */
export async function loadExportDocument(page, html, { label, hint = '' }) {
  const timeout = exportRenderTimeoutMs();
  page.setDefaultTimeout(timeout);
  try {
    await page.setContent(html, { waitUntil: 'load', timeout });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        `${label} timed out while rendering. The document may be too large; ` +
          `raise EXPORT_RENDER_TIMEOUT_MS${hint ? `, ${hint}` : ''}.`,
        { cause: err },
      );
    }
    throw err;
  }
}
