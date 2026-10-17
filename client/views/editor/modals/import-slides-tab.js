import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import {
  createDeckFilesPicker,
  importDeckFiles,
} from '../../slide-import/index.js';

/**
 * Creates the "Import from file" tab content for the slide-type-modal.
 * Each page of a PDF becomes an image-slide; the PowerPoint file beside it
 * gives each slide its speaker notes, paired by slide order (B700, D334).
 * Either file may come alone. The chooser and the streamed import are the
 * slide-import feature's, shared with the creation view (B306); this tab
 * inserts into the open deck.
 *
 * @param {object} options
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
  let importing = false;

  // The "n slides imported" confirmation. A refusal (not a PDF,
  // the import itself failed) is a state of this form and gets the inline
  // element beside the button.
  const statusMessage = h('div', {
    class: 'import-slides-status help',
    hidden: true,
  });
  const refusal = createInlineError({ callout: true });

  const picker = createDeckFilesPicker({
    onChange: () => {
      statusMessage.hidden = true;
      render();
    },
    onRefuse: (message) => (message ? refusal.show(message) : refusal.clear()),
  });

  const btnImport = h('button', {
    class: 'btn btn-primary',
    text: t('editor.importSlides.importButton', 'Import slides'),
    disabled: true,
    onclick: startImport,
  });

  function render() {
    btnImport.disabled = importing || !picker.hasFiles();
  }

  async function startImport() {
    if (!picker.hasFiles() || importing) return;

    importing = true;
    render();
    picker.setDisabled(true);
    refusal.clear();
    statusMessage.hidden = true;

    try {
      const result = await importDeckFiles({
        url: `/api/presentations/${encodeURIComponent(presentationId)}/import-slides-as-images`,
        files: picker.getFiles(),
        body: { insertAfterSlideId: afterSlideId },
        title: t('editor.importSlides.progressTitle', 'Importing slides'),
      });
      if (result) {
        statusMessage.textContent = t(
          'editor.importSlides.success',
          {
            one: '1 slide imported',
            many: '{count} slides imported',
          },
          { count: result.slidesAdded || 0 },
        );
        statusMessage.hidden = false;
        onComplete?.(result);
      }
    } catch (err) {
      console.error('[import-slides] Error:', err);
      refusal.show(err.message || t('editor.import.failed', 'Import failed'));
      onError?.(err);
    } finally {
      importing = false;
      picker.setDisabled(false);
      render();
    }
  }

  wrap.append(
    h('div', {
      class: 'import-slides-help help',
      text: t(
        'editor.importSlides.help',
        'Import an existing deck as images. Export it as a PDF from PowerPoint or Keynote: each page becomes an image slide at 1920x1080 resolution. Add the .pptx file too and every slide gets its speaker notes.',
      ),
    }),
    picker.el,
    h('div', { class: 'import-slides-actions' }, [btnImport]),
    refusal.el,
    statusMessage,
  );

  return wrap;
}
