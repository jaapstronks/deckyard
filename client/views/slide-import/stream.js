/**
 * Run an import of an existing deck: read the chosen files, post them to one
 * of the three deck-import endpoints and follow its SSE progress in the
 * loading modal. Shared by the editor's insert route
 * (`/api/presentations/:id/import-slides-as-images`) and the creation view's
 * two new-deck routes, as images (`/api/presentations/import/images`, B306)
 * and as editable slides (`/api/presentations/import/slides`, B753); the
 * caller names the endpoint and adds what that endpoint needs beside the
 * files. All three share the body and the progress stages.
 *
 * The import is a long task: its Cancel closes the stream, which stops the
 * page renders on the server (B716).
 */

import { t } from '../../lib/ui-i18n.js';
import { errorText } from '../../lib/api.js';
import { readFileAsDataUrl } from '../../lib/net/file.js';
import { showLoadingModal } from '../../lib/dom/loading-modal.js';
import { processSSEStream } from '../../lib/net/sse.js';

/**
 * The bar position of one server `progress` event: rendering the pages is
 * the first half of the work, uploading them (or, as editable slides,
 * building each slide) the second.
 */
function progressOf({ stage, current, total }) {
  if (stage === 'converting' && total > 0) {
    return 10 + Math.round((current / total) * 40);
  }
  if (stage === 'uploading' && total > 0) {
    return 50 + Math.round((current / total) * 40);
  }
  if (stage === 'saving') return 95;
  return 10;
}

/**
 * @param {object} opts
 * @param {string} opts.url - The import endpoint.
 * @param {{ pdf: File|null, pptx: File|null }} opts.files - The chosen files.
 * @param {object} [opts.body] - Further body fields for the endpoint.
 * @param {string} opts.title - Title of the loading modal.
 * @param {HTMLElement} [opts.root] - Where the loading modal mounts.
 * @returns {Promise<object|null>} The `complete` event's data, or null when
 *   the user cancelled. A failure throws an Error that carries the server's
 *   sentence in `err.body.message` when there is one, as `api()` does, so the
 *   caller shows `serverSentence(err) ?? <its own copy>` (B880).
 */
export async function importDeckFiles({
  url,
  files,
  body = {},
  title,
  root = document.body,
}) {
  const controller = new AbortController();
  const modal = showLoadingModal({
    root,
    title,
    initialMessage: t('editor.importSlides.progress.reading', 'Reading file…'),
    onCancel: () => controller.abort(),
  });

  try {
    const dataUrl = files.pdf ? await readFileAsDataUrl(files.pdf) : null;
    const pptxDataUrl = files.pptx ? await readFileAsDataUrl(files.pptx) : null;
    controller.signal.throwIfAborted();

    modal.setProgress(5);
    modal.update(t('editor.importSlides.progress.uploading', 'Uploading…'), {
      immediate: true,
    });

    // SSE stream: progress events are read from response.body.
    // eslint-disable-next-line no-restricted-syntax
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        ...body,
        dataUrl,
        filename: files.pdf?.name,
        pptxDataUrl,
        pptxFilename: files.pptx?.name,
      }),
      credentials: 'include',
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(errorText(errorData, `HTTP ${response.status}`)),
        { body: errorData },
      );
    }

    let result = null;
    await processSSEStream(response.body, {
      onProgress: (data) => {
        modal.setProgress(progressOf(data));
        if (data.message) modal.update(data.message, { immediate: true });
      },
      onError: (data) => {
        throw Object.assign(
          new Error(
            data?.message || t('editor.import.failed', 'Import failed'),
          ),
          { body: data },
        );
      },
      onComplete: (data) => {
        result = data;
      },
    });
    if (!result) throw new Error(t('editor.import.failed', 'Import failed'));

    modal.setProgress(100);
    return result;
  } catch (err) {
    // Cancel aborted the request: the user knows, and the server stopped.
    if (err?.name === 'AbortError') return null;
    throw err;
  } finally {
    modal.close();
  }
}
