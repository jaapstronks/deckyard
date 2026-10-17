/**
 * The "PowerPoint or PDF" sub-tab of the creation view's import method: an
 * existing deck taken over as a new deck, one slide per PDF page, with the
 * speaker notes of the PowerPoint file beside it. Two ways to take it over,
 * each its own endpoint (the route is the endpoint, D235):
 *
 * - **As editable slides** (B753, the default): `/api/presentations/import/slides`
 *   gives each page the slide type its structure asks for, with the same
 *   text; a page that fits none becomes an image of itself, and the report
 *   says which and why.
 * - **As images** (B306, D334): `/api/presentations/import/images`, every
 *   page a picture.
 *
 * Neither interprets and neither needs AI. The chooser, the streamed import
 * and the report's words are the slide-import feature's, shared with the
 * editor's "Import from file" tab.
 *
 * The deck needs a theme and a language, so this sub-tab takes both from the
 * shared setup block.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom/index.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { toast } from '../../../../lib/dom/toast.js';
import { nav } from '../../../../lib/state/router.js';
import {
  createDeckFilesPicker,
  importDeckFiles,
  slidesImportOutcome,
} from '../../../slide-import/index.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../../shared/i18n-utils.js';

/** The two ways to take a deck over, in the order they are offered. */
const MODES = {
  slides: {
    url: '/api/presentations/import/slides',
    title: () =>
      t('list.creationView.importPptxPdf.slides', 'As editable slides'),
    desc: () =>
      t(
        'list.creationView.importPptxPdf.slidesHelp',
        'Each page becomes a slide with the same text and its own images, which you can edit; a page that fits no slide type, such as a chart, becomes an image of itself.',
      ),
  },
  images: {
    url: '/api/presentations/import/images',
    title: () => t('list.creationView.importPptxPdf.images', 'As images'),
    desc: () =>
      t(
        'list.creationView.importPptxPdf.imagesHelp',
        'Each page becomes an image slide that looks exactly like the original; its text cannot be edited.',
      ),
  },
};

let seq = 0;

/**
 * @returns {{
 *   el: HTMLElement,
 *   run: (ctx: object) => Promise<void>,
 * }}
 */
export function createPptxPdfImportPanel() {
  let mode = 'slides';
  const refusal = createInlineError({ callout: true });
  const picker = createDeckFilesPicker({
    pdfUse: mode,
    onRefuse: (message) => (message ? refusal.show(message) : refusal.clear()),
  });

  const group = `creation-import-mode-${++seq}`;
  const choice = h(
    'div',
    {
      class: 'creation-import-choice',
      role: 'radiogroup',
      'aria-label': t(
        'list.creationView.importPptxPdf.choice',
        'How to take the deck over',
      ),
    },
    Object.entries(MODES).map(([key, m]) =>
      h('label', { class: 'share-option' }, [
        h('input', {
          type: 'radio',
          name: group,
          value: key,
          checked: key === mode,
          onchange: () => {
            mode = key;
            picker.setPdfUse(key);
            refusal.clear();
          },
        }),
        h('div', { class: 'share-option-content' }, [
          h('span', { class: 'share-option-title', text: m.title() }),
          h('span', { class: 'share-option-desc', text: m.desc() }),
        ]),
      ]),
    ),
  );

  const el = h('div', { class: 'creation-subpanel' }, [
    choice,
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.creationView.importPptxPdf.help',
        'The speaker notes from the .pptx come along. Export the PDF from PowerPoint or Keynote.',
      ),
    }),
    picker.el,
    refusal.el,
  ]);

  /**
   * Import the chosen files as a new deck and open it, or first say which
   * pages became images when the editable import could not map them all.
   *
   * @param {object} ctx
   * @param {Function} ctx.close - Close the creation view.
   * @param {Function} ctx.setBusy - Lock the creation view.
   * @param {Function} ctx.hideBackdrop - Hide the creation view behind the loading modal.
   * @param {Function} ctx.showBackdrop - Bring it back after a refusal, a cancel or a report.
   * @param {HTMLElement} ctx.root - Where the loading modal mounts.
   * @param {string} ctx.langMode - Deck language.
   * @param {string} ctx.themeId - Selected theme id.
   * @param {(arg: { intro: string, warnings: string[], navUrl: string }) => void} ctx.showWarnings
   *   - Show the report in this sub-tab, turning Create into "Open".
   */
  const run = async ({
    close,
    setBusy,
    hideBackdrop,
    showBackdrop,
    root,
    langMode,
    themeId,
    showWarnings,
  }) => {
    refusal.clear();
    const files = picker.getFiles();
    if (!picker.hasFiles()) {
      refusal.show(
        t(
          'editor.importSlides.error.unsupported',
          'Choose a PDF, a PowerPoint (.pptx) file, or both',
        ),
      );
      return;
    }
    if (mode === 'slides' && !files.pdf) {
      refusal.show(
        t(
          'list.creationView.importPptxPdf.pdfRequired',
          'Editable slides are read from the PDF. Add the PDF of the deck.',
        ),
      );
      return;
    }
    const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;
    setBusy(true);
    hideBackdrop?.();
    try {
      const result = await importDeckFiles({
        url: MODES[mode].url,
        files,
        body: { lang, theme: themeId },
        title: t('editor.importSlides.progressTitle', 'Importing slides'),
        root,
      });
      if (result?.presentation) {
        const navUrl = `/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`;
        const outcome = result.report
          ? slidesImportOutcome(result.report)
          : null;
        if (outcome && !outcome.clean) {
          showBackdrop?.();
          showWarnings({
            intro: outcome.line,
            warnings: outcome.errors,
            navUrl,
          });
          return;
        }
        close();
        nav(navUrl);
        if (outcome) toast.success(outcome.line);
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
