/**
 * What an import as editable slides did, in words (B753): the report of
 * `POST /api/presentations/import/slides` (`server/services/deck-slides-import.js`)
 * as one line naming the pages that became an image of themselves and why,
 * plus a sentence per image that could not be uploaded.
 *
 * Pure: no DOM, no fetch. The host decides where the words go.
 */

import { t } from '../../lib/ui-i18n.js';

/**
 * One word per fallback reason, in the closed set of `FALLBACK_REASONS`
 * (`deck-slides-import.js`). A reason this client does not know yet shows as
 * the page number alone.
 */
const REASON_LABELS = {
  'no-text': () => t('editor.importSlides.reason.noText', 'no text'),
  drawing: () => t('editor.importSlides.reason.drawing', 'chart'),
  'table-untagged': () =>
    t('editor.importSlides.reason.tableUntagged', 'table'),
  'multi-image': () =>
    t('editor.importSlides.reason.multiImage', 'several images'),
  'no-heading': () => t('editor.importSlides.reason.noHeading', 'no heading'),
  'too-long': () =>
    t('editor.importSlides.reason.tooLong', 'too much text for one slide'),
};

/**
 * @param {object} report - The `complete` event's `report`.
 * @param {number} [report.slidesExtracted]
 * @param {Array<{ page: number, reason?: string }>} [report.pages]
 * @param {Array<{ page: number, message: string }>} [report.errors]
 * @returns {{ clean: boolean, line: string, errors: string[] }} `clean` when
 *   every page became an editable slide and nothing failed; `line` says how
 *   many pages there were or which fell back; `errors` one sentence each.
 */
export function slidesImportOutcome(report) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const total = Number(report?.slidesExtracted) || pages.length;
  const fallbacks = pages.filter((p) => p.reason);
  const errors = (Array.isArray(report?.errors) ? report.errors : []).map(
    ({ page, message }) =>
      t('editor.importSlides.report.error', 'Page {page}: {message}', {
        page,
        message,
      }),
  );

  if (fallbacks.length === 0) {
    return {
      clean: errors.length === 0,
      line: t(
        'editor.importSlides.report.allEditable',
        {
          one: 'The page was imported as an editable slide.',
          many: 'All {count} pages were imported as editable slides.',
        },
        { count: total },
      ),
      errors,
    };
  }

  const list = fallbacks
    .map(({ page, reason }) => {
      const label = REASON_LABELS[reason]?.();
      return label ? `${page} (${label})` : String(page);
    })
    .join(', ');
  return {
    clean: false,
    line: t(
      'editor.importSlides.report.fallbacks',
      {
        one: '1 of {total} pages was taken over as an image: {pages}.',
        many: '{count} of {total} pages were taken over as images: {pages}.',
      },
      { count: fallbacks.length, total, pages: list },
    ),
    errors,
  };
}
