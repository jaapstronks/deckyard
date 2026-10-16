import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { errorText } from '../../../lib/api.js';
import { readFileAsDataUrl } from '../../../lib/net/file.js';
import { formatFileSize } from '../../../lib/format/format.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { showLoadingModal } from '../../../lib/dom/loading-modal.js';
import { processSSEStream } from '../../../lib/net/sse.js';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Creates the "Import from file" tab content for the slide-type-modal.
 * Each page of a PDF becomes an image-slide; the PowerPoint file beside it
 * gives each slide its speaker notes, paired by slide order (B700, D334).
 * Either file may come alone.
 *
 * The import itself is a long task: it runs in the loading modal, page by
 * page, and its Cancel closes the stream, which stops the page renders on the
 * server (B716).
 *
 * @param {object} options
 * @param {function} options.api - API caller function
 * @param {string} options.presentationId - Current presentation ID
 * @param {string|null} options.afterSlideId - Insert slides after this slide ID (null = end)
 * @param {function} options.onComplete - Callback when import completes successfully
 * @param {function} options.onError - Callback when import fails
 * @returns {HTMLElement} The tab content element
 */
export function createImportSlidesTab({
  presentationId,
  afterSlideId,
  onComplete,
  onError,
} = {}) {
  const wrap = h('div', { class: 'import-slides-tab' });

  // State: one slot per role, the PDF for the images and the PowerPoint
  // file for the notes.
  const selected = { pdf: null, pptx: null };
  let importing = false;

  // Hidden file input
  const inputFile = h('input', {
    type: 'file',
    accept: `application/pdf,.pdf,${PPTX_MIME},.pptx`,
    multiple: true,
    style: 'display:none',
  });

  // Dropzone
  const dropzoneIcon = h('div', { class: 'import-slides-dropzone-icon' }, [
    icon('file-up', { size: 48 }),
  ]);

  const dropzoneText = h('div', {
    class: 'import-slides-dropzone-text',
    text: t(
      'editor.importSlides.dropzone.text',
      'Drop a PDF and the PowerPoint file here, or click to choose',
    ),
  });

  const dropzoneHint = h('div', {
    class: 'import-slides-dropzone-hint help',
    text: t(
      'editor.importSlides.dropzone.hint',
      'The PDF gives the images, the .pptx the speaker notes; either can come alone',
    ),
  });

  const dropzone = h('div', { class: 'import-slides-dropzone' }, [
    dropzoneIcon,
    dropzoneText,
    dropzoneHint,
  ]);

  // One row per chosen file, with what it is used for.
  const ROLE_LABELS = {
    pdf: () => t('editor.importSlides.role.pdf', 'Images'),
    pptx: () => t('editor.importSlides.role.pptx', 'Speaker notes'),
  };
  const fileRows = {};
  for (const kind of ['pdf', 'pptx']) {
    const name = h('span', { class: 'import-slides-file-name' });
    const size = h('span', { class: 'import-slides-file-size help' });
    const clear = h('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      text: t('common.clear', 'Clear'),
      onclick: () => clearFile(kind),
    });
    const el = h('div', { class: 'import-slides-file-info', hidden: true }, [
      h('div', { class: 'import-slides-file-icon' }, [
        icon('file', { size: 24 }),
      ]),
      h('div', { class: 'import-slides-file-details' }, [name, size]),
      clear,
    ]);
    fileRows[kind] = { el, name, size, clear };
  }

  // Said before the import, not after: a PowerPoint file alone brings notes
  // but no pictures.
  const pptxOnlyNotice = h('div', {
    class: 'import-slides-help help',
    hidden: true,
    text: t(
      'editor.importSlides.pptxOnlyNotice',
      'Without a PDF the slides get their speaker notes but no images. Export a PDF from PowerPoint or Keynote and add it for the images.',
    ),
  });

  // Import button
  const btnImport = h('button', {
    class: 'btn btn-primary',
    text: t('editor.importSlides.importButton', 'Import slides'),
    disabled: true,
    onclick: startImport,
  });

  const actionsSection = h('div', { class: 'import-slides-actions' }, [
    btnImport,
  ]);

  // The "n slides imported" confirmation. A refusal (not a PDF,
  // the import itself failed) is a state of this form and gets the inline
  // element beside the button.
  const statusMessage = h('div', {
    class: 'import-slides-status help',
    hidden: true,
  });
  const refusal = createInlineError({ callout: true });

  /** Bring the rows, the dropzone and the button in line with the slots. */
  function render() {
    for (const kind of ['pdf', 'pptx']) {
      const file = selected[kind];
      const row = fileRows[kind];
      row.el.hidden = !file;
      if (file) {
        row.name.textContent = file.name;
        row.size.textContent = `${ROLE_LABELS[kind]()} · ${formatFileSize(file.size)}`;
      }
    }
    // The dropzone stays until both roles are filled.
    dropzone.hidden = Boolean(selected.pdf && selected.pptx);
    pptxOnlyNotice.hidden = !(selected.pptx && !selected.pdf);
    btnImport.disabled = !(selected.pdf || selected.pptx);
  }

  function clearFile(kind) {
    selected[kind] = null;
    inputFile.value = '';
    btnImport.textContent = t(
      'editor.importSlides.importButton',
      'Import slides',
    );
    statusMessage.hidden = true;
    refusal.clear();
    render();
  }

  function showStatus(message) {
    statusMessage.textContent = message;
    statusMessage.hidden = false;
  }

  /**
   * The bar position of one server `progress` event: rendering the pages is
   * the first half of the work, uploading them the second.
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

  async function startImport() {
    if (!(selected.pdf || selected.pptx) || importing) return;

    importing = true;
    btnImport.disabled = true;
    for (const row of Object.values(fileRows)) row.clear.disabled = true;
    refusal.clear();
    statusMessage.hidden = true;

    const controller = new AbortController();
    const modal = showLoadingModal({
      root: document.body,
      title: t('editor.importSlides.progressTitle', 'Importing slides'),
      initialMessage: t(
        'editor.importSlides.progress.reading',
        'Reading file…',
      ),
      onCancel: () => controller.abort(),
    });

    try {
      // Read the files as data URLs
      const dataUrl = selected.pdf
        ? await readFileAsDataUrl(selected.pdf)
        : null;
      const pptxDataUrl = selected.pptx
        ? await readFileAsDataUrl(selected.pptx)
        : null;
      controller.signal.throwIfAborted();

      modal.setProgress(5);
      modal.update(t('editor.importSlides.progress.uploading', 'Uploading…'), {
        immediate: true,
      });

      // Call the API with SSE for progress
      const url = `/api/presentations/${encodeURIComponent(presentationId)}/import-slides-as-images`;

      // SSE stream: progress events are read from response.body.
      // eslint-disable-next-line no-restricted-syntax
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          dataUrl,
          filename: selected.pdf?.name,
          pptxDataUrl,
          pptxFilename: selected.pptx?.name,
          insertAfterSlideId: afterSlideId,
        }),
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorText(errorData, `HTTP ${response.status}`));
      }

      let result = null;
      await processSSEStream(response.body, {
        onProgress: (data) => {
          modal.setProgress(progressOf(data));
          if (data.message) modal.update(data.message, { immediate: true });
        },
        onError: (data) => {
          throw new Error(
            data?.message || t('editor.import.failed', 'Import failed'),
          );
        },
        onComplete: (data) => {
          result = data;
        },
      });
      if (!result) {
        throw new Error(t('editor.import.failed', 'Import failed'));
      }

      modal.setProgress(100);
      showStatus(
        t(
          'editor.importSlides.success',
          {
            one: '1 slide imported',
            many: '{count} slides imported',
          },
          { count: result.slidesAdded || 0 },
        ),
      );
      onComplete?.(result);
    } catch (err) {
      // Cancel aborted the request: the user knows, and the server stopped.
      if (err?.name !== 'AbortError') {
        console.error('[import-slides] Error:', err);
        statusMessage.hidden = true;
        refusal.show(err.message || t('editor.import.failed', 'Import failed'));
        onError?.(err);
      }
    } finally {
      modal.close();
      importing = false;
      btnImport.disabled = false;
      for (const row of Object.values(fileRows)) row.clear.disabled = false;
      render();
    }
  }

  /**
   * Put picked or dropped files in their slot (a later file of the same kind
   * replaces the earlier one), or say why one does not fit.
   */
  function pickFiles(files) {
    let refused = false;
    for (const file of files || []) {
      const name = file.name.toLowerCase();
      if (file.type.includes('pdf') || name.endsWith('.pdf')) {
        selected.pdf = file;
      } else if (file.type === PPTX_MIME || name.endsWith('.pptx')) {
        selected.pptx = file;
      } else {
        refused = true;
      }
    }
    statusMessage.hidden = true;
    if (refused) {
      refusal.show(
        t(
          'editor.importSlides.error.unsupported',
          'Choose a PDF, a PowerPoint (.pptx) file, or both',
        ),
      );
    } else {
      refusal.clear();
    }
    render();
  }

  // Handle file selection
  inputFile.addEventListener('change', () => pickFiles(inputFile.files));

  // Dropzone click
  dropzone.addEventListener('click', () => inputFile.click());

  // Drag and drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    pickFiles(e.dataTransfer?.files);
  });

  // Help text
  const helpText = h('div', {
    class: 'import-slides-help help',
    text: t(
      'editor.importSlides.help',
      'Import an existing deck as images. Export it as a PDF from PowerPoint or Keynote: each page becomes an image slide at 1920x1080 resolution. Add the .pptx file too and every slide gets its speaker notes.',
    ),
  });

  // Assemble
  wrap.append(
    helpText,
    inputFile,
    dropzone,
    fileRows.pdf.el,
    fileRows.pptx.el,
    pptxOnlyNotice,
    actionsSection,
    refusal.el,
    statusMessage,
  );

  return wrap;
}
