/**
 * The two ways the export modal gets a file.
 *
 * - {@link downloadExport}: fetch a file route and save what it answers. For
 *   the exports that are done in a second or two (HTML, notes, .deck, JSON).
 * - {@link streamExport}: the long task (B716). Every export that renders in
 *   Chrome (PDF, PNG ZIP, both PowerPoints, the handoff ZIP) asks the route's
 *   streamed twin (`…/stream`) instead, shows its progress in the loading
 *   modal ("Slide 12 of 54") and fetches the file the stream points at when
 *   it completes. Cancel closes the stream, and that stops the server
 *   (`server/export/pipeline.js` → `createExportStreamRoute`).
 */

import { t } from '../../../lib/ui-i18n.js';
import { showLoadingModal } from '../../../lib/dom/loading-modal.js';
import { downloadBlob } from '../../../lib/dom/download.js';
import { processSSEStream } from '../../../lib/net/sse.js';

/** Pull a filename out of a Content-Disposition header, else a fallback. */
function filenameFromDisposition(cd, fallback) {
  if (!cd) return fallback;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Read the error envelope's sentence off a failed response. */
async function failureOf(res) {
  // The error envelope's sentence when the server sent one, with its code and
  // details, so a caller can place a refusal that names a field.
  const body = await res.json().catch(() => null);
  return Object.assign(new Error(body?.message || `HTTP ${res.status}`), {
    code: body?.error || null,
    details: body?.details || null,
  });
}

/**
 * Fetch an export file and save it under the server's filename.
 *
 * Binary download: the response is file bytes read as a blob, which api()'s
 * json/text contract cannot express. Resolves to the response's headers, so a
 * caller can read a finding the file itself cannot carry; throws on a failed
 * or aborted fetch.
 *
 * @param {string} url
 * @param {string} fallbackName - used when the response names no file
 * @param {AbortSignal} [signal]
 * @returns {Promise<Headers>}
 */
export async function downloadExport(url, fallbackName, signal) {
  // eslint-disable-next-line no-restricted-syntax
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw await failureOf(res);
  const blob = await res.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(
      res.headers.get('Content-Disposition'),
      fallbackName,
    ),
  );
  return res.headers;
}

/**
 * The modal's message line for one `status` event: the counter the server
 * measured, worded here. A status without one (the start, the PDF's creep)
 * leaves the line as it is.
 *
 * @param {{ phase?: string, done?: number, total?: number, unit?: string }} status
 * @returns {string}
 */
export function exportStatusLine({ phase, done, total, unit } = {}) {
  if (phase === 'pack') {
    return t('editor.export.progress.packing', 'Packing the file…');
  }
  if (!total || done == null) return '';
  return unit === 'step'
    ? t('editor.export.progress.step', 'Step {n} of {total}', {
        n: String(done),
        total: String(total),
      })
    : t('editor.export.progress.slide', 'Slide {n} of {total}', {
        n: String(done),
        total: String(total),
      });
}

/**
 * Run a Chrome export as a long task: the loading modal with its progress and
 * a Cancel button, then the file.
 *
 * Resolves to the file response's headers, or to `null` when the user
 * cancelled (nothing to say then: they know). Throws on a refusal or a failed
 * export, with the server's sentence; with `timeoutMs`, a render that takes
 * longer is aborted and throws an error with `code: 'timeout'`.
 *
 * @param {Object} opts
 * @param {string} opts.url - the streamed twin (`…/export/<path>/stream`)
 * @param {string} opts.title - the modal's title
 * @param {string} opts.fallbackName - used when the file response names none
 * @param {number} [opts.timeoutMs] - give up after this long
 * @returns {Promise<Headers|null>}
 */
export async function streamExport({ url, title, fallbackName, timeoutMs }) {
  const controller = new AbortController();
  let timedOut = false;
  const modal = showLoadingModal({
    root: document.body,
    title,
    initialMessage: t(
      'editor.export.progress.starting',
      'Preparing the export…',
    ),
    onCancel: () => controller.abort(),
  });
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    // SSE stream: progress events are read from response.body.
    // eslint-disable-next-line no-restricted-syntax
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) throw await failureOf(res);

    let downloadUrl = null;
    await processSSEStream(res.body, {
      onStatus: (status) => {
        if (status.progress) modal.setProgress(status.progress);
        if (status.creepTo) {
          modal.creepTo(status.creepTo, { durationMs: status.creepMs });
        }
        const line = exportStatusLine(status);
        if (line) modal.update(line, { immediate: true });
      },
      onComplete: (data) => {
        downloadUrl = data?.downloadUrl || null;
      },
      onError: (data) => {
        throw new Error(
          data?.message || t('editor.export.failed', 'Export failed'),
        );
      },
    });
    if (!downloadUrl) {
      throw new Error(t('editor.export.failed', 'Export failed'));
    }

    modal.update(t('editor.export.progress.saving', 'Downloading…'), {
      immediate: true,
    });
    const headers = await downloadExport(
      downloadUrl,
      fallbackName,
      controller.signal,
    );
    modal.setProgress(100);
    return headers;
  } catch (err) {
    if (err?.name !== 'AbortError') throw err;
    if (!timedOut) return null;
    throw Object.assign(
      new Error(
        t(
          'editor.export.timedOut',
          'The export took too long and was stopped.',
        ),
      ),
      { code: 'timeout' },
    );
  } finally {
    clearTimeout(timer);
    modal.close();
  }
}
