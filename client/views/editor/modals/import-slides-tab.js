import { t } from '../../../lib/ui-i18n.js';
import { readFileAsDataUrl } from '../../../lib/file.js';
import { formatFileSize } from '../../../lib/format.js';

/**
 * Creates the "Import from file" tab content for the slide-type-modal.
 * Supports PDF files - each page becomes an image-slide.
 *
 * @param {object} options
 * @param {function} options.h - Element creator function
 * @param {function} options.api - API caller function
 * @param {string} options.presentationId - Current presentation ID
 * @param {string|null} options.afterSlideId - Insert slides after this slide ID (null = end)
 * @param {function} options.onComplete - Callback when import completes successfully
 * @param {function} options.onError - Callback when import fails
 * @returns {HTMLElement} The tab content element
 */
export function createImportSlidesTab({
  h,
  api,
  presentationId,
  afterSlideId,
  onComplete,
  onError,
} = {}) {
  const wrap = h('div', { class: 'import-slides-tab' });

  // State
  let selectedFile = null;
  let importing = false;

  // Hidden file input
  const inputFile = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    style: 'display:none',
  });

  // Dropzone
  const dropzoneIcon = h('div', { class: 'import-slides-dropzone-icon' });
  dropzoneIcon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="18" x2="12" y2="12"/>
    <line x1="9" y1="15" x2="12" y2="12"/>
    <line x1="15" y1="15" x2="12" y2="12"/>
  </svg>`;

  const dropzoneText = h('div', {
    class: 'import-slides-dropzone-text',
    text: t('editor.importSlides.dropzone.text', 'Drop PDF here or click to upload'),
  });

  const dropzoneHint = h('div', {
    class: 'import-slides-dropzone-hint help',
    text: t('editor.importSlides.dropzone.hint', 'Each page becomes an image slide'),
  });

  const dropzone = h('div', { class: 'import-slides-dropzone' }, [
    dropzoneIcon,
    dropzoneText,
    dropzoneHint,
  ]);

  // File info section (shown after file selected)
  const fileInfoName = h('span', { class: 'import-slides-file-name' });
  const fileInfoSize = h('span', { class: 'import-slides-file-size help' });
  const btnClear = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('common.clear', 'Clear'),
    onclick: clearFile,
  });
  const fileInfo = h('div', { class: 'import-slides-file-info', hidden: true }, [
    h('div', { class: 'import-slides-file-icon' }, [
      (() => {
        const icon = h('span');
        icon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;
        return icon;
      })(),
    ]),
    h('div', { class: 'import-slides-file-details' }, [fileInfoName, fileInfoSize]),
    btnClear,
  ]);

  // Progress section
  const progressBar = h('div', { class: 'import-slides-progress-bar' });
  const progressTrack = h('div', { class: 'import-slides-progress-track' }, [progressBar]);
  const progressText = h('div', { class: 'import-slides-progress-text help' });
  const progressSection = h('div', { class: 'import-slides-progress', hidden: true }, [
    progressTrack,
    progressText,
  ]);

  // Import button
  const btnImport = h('button', {
    class: 'btn btn-primary',
    text: t('editor.importSlides.importButton', 'Import slides'),
    disabled: true,
    onclick: startImport,
  });

  const actionsSection = h('div', { class: 'import-slides-actions' }, [btnImport]);

  // Status message
  const statusMessage = h('div', { class: 'import-slides-status help', hidden: true });

  function showFile(file) {
    selectedFile = file;
    fileInfoName.textContent = file.name;
    fileInfoSize.textContent = formatFileSize(file.size);
    dropzone.hidden = true;
    fileInfo.hidden = false;
    btnImport.disabled = false;
    statusMessage.hidden = true;
  }

  function clearFile() {
    selectedFile = null;
    inputFile.value = '';
    dropzone.hidden = false;
    fileInfo.hidden = true;
    progressSection.hidden = true;
    btnImport.disabled = true;
    btnImport.textContent = t('editor.importSlides.importButton', 'Import slides');
    statusMessage.hidden = true;
  }

  function setProgress(current, total, message) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = message || `${pct}%`;
  }

  function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.hidden = false;
    statusMessage.classList.toggle('is-error', isError);
  }

  async function startImport() {
    if (!selectedFile || importing) return;

    importing = true;
    btnImport.disabled = true;
    btnImport.textContent = t('editor.importSlides.importing', 'Importing...');
    btnClear.disabled = true;
    progressSection.hidden = false;
    setProgress(0, 100, t('editor.importSlides.progress.reading', 'Reading file...'));

    try {
      // Read file as data URL
      const dataUrl = await readFileAsDataUrl(selectedFile);

      setProgress(5, 100, t('editor.importSlides.progress.uploading', 'Uploading...'));

      // Call the API with SSE for progress
      const url = `/api/presentations/${encodeURIComponent(presentationId)}/import-slides-as-images`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          dataUrl,
          filename: selectedFile.name,
          insertAfterSlideId: afterSlideId,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Handle SSE response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let event = '';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            data = line.slice(6);
          } else if (line === '' && data) {
            // Process the event
            try {
              const parsed = JSON.parse(data);

              if (event === 'progress') {
                const { stage, current, total, message } = parsed;
                let pct = 10;
                if (stage === 'converting' && total > 0) {
                  pct = 10 + Math.round((current / total) * 40);
                } else if (stage === 'uploading' && total > 0) {
                  pct = 50 + Math.round((current / total) * 40);
                } else if (stage === 'saving') {
                  pct = 95;
                }
                setProgress(pct, 100, message);
              } else if (event === 'error') {
                throw new Error(parsed.error || 'Import failed');
              } else if (event === 'complete') {
                setProgress(100, 100, t('editor.importSlides.progress.complete', 'Complete!'));
                showStatus(
                  t('editor.importSlides.success', '{count} slides imported').replace(
                    '{count}',
                    String(parsed.slidesAdded || 0)
                  )
                );
                onComplete?.(parsed);
                return;
              }
            } catch (parseErr) {
              console.error('[import-slides] Failed to parse SSE data:', parseErr);
            }
            event = '';
            data = '';
          }
        }
      }
    } catch (err) {
      console.error('[import-slides] Error:', err);
      showStatus(err.message || 'Import failed', true);
      onError?.(err);
    } finally {
      importing = false;
      btnImport.disabled = false;
      btnImport.textContent = t('editor.importSlides.importButton', 'Import slides');
      btnClear.disabled = false;
    }
  }

  // Handle file selection
  inputFile.addEventListener('change', () => {
    const file = inputFile.files?.[0];
    if (file) {
      if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showStatus(t('editor.importSlides.error.notPdf', 'Please select a PDF file'), true);
        return;
      }
      showFile(file);
    }
  });

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
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showStatus(t('editor.importSlides.error.notPdf', 'Please select a PDF file'), true);
        return;
      }
      showFile(file);
    }
  });

  // Help text
  const helpText = h('div', { class: 'import-slides-help help' });
  helpText.innerHTML = t(
    'editor.importSlides.help',
    'Import slides from a PDF file. Each page will be converted to an image slide at 1920×1080 resolution.'
  );

  // Assemble
  wrap.append(
    helpText,
    inputFile,
    dropzone,
    fileInfo,
    progressSection,
    actionsSection,
    statusMessage
  );

  return wrap;
}