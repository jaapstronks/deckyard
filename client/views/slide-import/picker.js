/**
 * The two-slot file chooser for importing an existing deck as images (B700,
 * D334): a PDF the presentation app exported gives the pictures, the
 * PowerPoint file beside it the speaker notes. Either may come alone; a later
 * file of the same kind replaces the earlier one.
 *
 * Shared by the editor's "Import from file" tab and the creation view's
 * "PowerPoint or PDF" import sub-tab (B306). The chooser only holds the files;
 * each host owns its button, its help text and what the import writes.
 */

import { icon } from '../../lib/dom/icons.js';
import { t } from '../../lib/ui-i18n.js';
import { formatFileSize } from '../../lib/format/format.js';
import { h } from '../../lib/dom/index.js';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const DECK_IMAGES_ACCEPT = `application/pdf,.pdf,${PPTX_MIME},.pptx`;

const KINDS = ['pdf', 'pptx'];

/**
 * @param {object} [opts]
 * @param {() => void} [opts.onChange] - Called after the chosen files change.
 * @param {(message: string|null) => void} [opts.onRefuse] - A file of the
 *   wrong kind was offered (message), or the next pick fit (null). The host
 *   shows it in its form's one refusal element.
 * @returns {{
 *   el: HTMLElement,
 *   getFiles: () => { pdf: File|null, pptx: File|null },
 *   hasFiles: () => boolean,
 *   setDisabled: (disabled: boolean) => void,
 * }}
 */
export function createDeckImagesPicker({ onChange, onRefuse } = {}) {
  const selected = { pdf: null, pptx: null };

  const inputFile = h('input', {
    type: 'file',
    accept: DECK_IMAGES_ACCEPT,
    multiple: true,
    style: 'display:none',
  });

  const dropzone = h('div', { class: 'import-slides-dropzone' }, [
    h('div', { class: 'import-slides-dropzone-icon' }, [
      icon('file-up', { size: 48 }),
    ]),
    h('div', {
      class: 'import-slides-dropzone-text',
      text: t(
        'editor.importSlides.dropzone.text',
        'Drop a PDF and the PowerPoint file here, or click to choose',
      ),
    }),
    h('div', {
      class: 'import-slides-dropzone-hint help',
      text: t(
        'editor.importSlides.dropzone.hint',
        'The PDF gives the images, the .pptx the speaker notes; either can come alone',
      ),
    }),
  ]);

  // One row per chosen file, with what it is used for.
  const ROLE_LABELS = {
    pdf: () => t('editor.importSlides.role.pdf', 'Images'),
    pptx: () => t('editor.importSlides.role.pptx', 'Speaker notes'),
  };
  const fileRows = {};
  for (const kind of KINDS) {
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

  /** Bring the rows and the dropzone in line with the slots. */
  function render() {
    for (const kind of KINDS) {
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
  }

  function changed() {
    render();
    onChange?.();
  }

  function clearFile(kind) {
    selected[kind] = null;
    inputFile.value = '';
    onRefuse?.(null);
    changed();
  }

  /**
   * Put picked or dropped files in their slot, or say why one does not fit.
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
    onRefuse?.(
      refused
        ? t(
            'editor.importSlides.error.unsupported',
            'Choose a PDF, a PowerPoint (.pptx) file, or both',
          )
        : null,
    );
    changed();
  }

  inputFile.addEventListener('change', () => pickFiles(inputFile.files));
  dropzone.addEventListener('click', () => inputFile.click());
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

  const el = h('div', { class: 'import-slides-picker' }, [
    inputFile,
    dropzone,
    fileRows.pdf.el,
    fileRows.pptx.el,
    pptxOnlyNotice,
  ]);

  return {
    el,
    getFiles: () => ({ ...selected }),
    hasFiles: () => Boolean(selected.pdf || selected.pptx),
    setDisabled: (disabled) => {
      for (const row of Object.values(fileRows)) row.clear.disabled = disabled;
      inputFile.disabled = disabled;
    },
  };
}
