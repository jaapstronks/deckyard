/**
 * The "PowerPoint or PDF" sub-tab of the creation view's import method
 * (B306): an existing deck taken over as a new deck of image slides, one per
 * PDF page, with the speaker notes of the PowerPoint file beside it. It posts
 * to `/api/presentations/import/images`, never to the AI conversion, and
 * needs no AI. The chooser and the streamed import are the slide-import
 * feature's, shared with the editor's "Import from file" tab.
 *
 * Image slides are theme-neutral, but the deck needs a theme and a language,
 * so this sub-tab takes both from the shared setup block.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom/index.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { nav } from '../../../../lib/state/router.js';
import {
  createDeckImagesPicker,
  importDeckImages,
} from '../../../slide-import/index.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../../shared/i18n-utils.js';

/**
 * @returns {{
 *   el: HTMLElement,
 *   run: (ctx: object) => Promise<void>,
 * }}
 */
export function createImagesImportPanel() {
  const refusal = createInlineError({ callout: true });
  const picker = createDeckImagesPicker({
    onRefuse: (message) => (message ? refusal.show(message) : refusal.clear()),
  });

  const el = h('div', { class: 'creation-subpanel' }, [
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.creationView.importImages.help',
        'Each page becomes an image slide. The text is not editable afterwards; the speaker notes from the .pptx come along. Export the PDF from PowerPoint or Keynote.',
      ),
    }),
    picker.el,
    refusal.el,
  ]);

  /**
   * Import the chosen files as a new deck and open it.
   *
   * @param {object} ctx
   * @param {Function} ctx.close - Close the creation view.
   * @param {Function} ctx.setBusy - Lock the creation view.
   * @param {Function} ctx.hideBackdrop - Hide the creation view behind the loading modal.
   * @param {Function} ctx.showBackdrop - Bring it back after a refusal or cancel.
   * @param {HTMLElement} ctx.root - Where the loading modal mounts.
   * @param {string} ctx.langMode - Deck language.
   * @param {string} ctx.themeId - Selected theme id.
   */
  const run = async ({
    close,
    setBusy,
    hideBackdrop,
    showBackdrop,
    root,
    langMode,
    themeId,
  }) => {
    refusal.clear();
    if (!picker.hasFiles()) {
      refusal.show(
        t(
          'editor.importSlides.error.unsupported',
          'Choose a PDF, a PowerPoint (.pptx) file, or both',
        ),
      );
      return;
    }
    const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;
    setBusy(true);
    hideBackdrop?.();
    try {
      const result = await importDeckImages({
        url: '/api/presentations/import/images',
        files: picker.getFiles(),
        body: { lang, theme: themeId },
        title: t('editor.importSlides.progressTitle', 'Importing slides'),
        root,
      });
      if (result?.presentation) {
        close();
        nav(`/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`);
        return;
      }
    } catch (err) {
      refusal.show(err.message || t('editor.import.failed', 'Import failed'));
    }
    showBackdrop?.();
    setBusy(false);
  };

  return { el, run };
}
