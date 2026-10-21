/**
 * What an import as editable slides did, in words (B753): the report of
 * `POST /api/presentations/import/slides` (`server/services/deck-slides-import.js`)
 * as one line naming the pages that became an image of themselves and why,
 * plus a sentence per picture that is missing, in the words of its code, and
 * one sentence for the pictures left out as decoration (B831).
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
 * What went wrong with a picture, per code in the closed set of
 * `REPORT_ERROR_CODES` (`deck-slides-import.js`); a code this client does
 * not know yet reads as the plain fact that something went wrong (B826).
 */
const ERROR_LABELS = {
  'upload-failed': () =>
    t(
      'editor.importSlides.error.uploadFailed',
      'an image could not be uploaded',
    ),
  'not-rendered': () =>
    t('editor.importSlides.error.notRendered', 'the page was not rendered'),
};

const errorLabel = (code) =>
  ERROR_LABELS[code]?.() ??
  t('editor.importSlides.error.other', 'something went wrong');

/**
 * @param {object} report - The `complete` event's `report`.
 * @param {number} [report.slidesExtracted]
 * @param {Array<{ page: number, reason?: string }>} [report.pages]
 * @param {Array<{ page: number, code: string }>} [report.errors]
 * @param {Array<{ pages: number[] }>} [report.decorations]
 * @returns {{ clean: boolean, line: string, errors: string[] }} `clean` when
 *   every page became an editable slide, nothing failed and nothing was left
 *   out; `line` says how many pages there were or which fell back; `errors`
 *   one sentence each, the decoration sentence last.
 */
export function slidesImportOutcome(report) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const total = Number(report?.slidesExtracted) || pages.length;
  const fallbacks = pages.filter((p) => p.reason);
  const errors = (Array.isArray(report?.errors) ? report.errors : []).map(
    ({ page, code }) =>
      t('editor.importSlides.report.error', 'Page {page}: {message}', {
        page,
        message: errorLabel(code),
      }),
  );
  const decorations = Array.isArray(report?.decorations)
    ? report.decorations
    : [];
  if (decorations.length) {
    errors.push(
      t(
        'editor.importSlides.report.decorations',
        {
          one: 'A picture repeated on {pages} pages (a logo or mark) was left out.',
          many: '{count} pictures repeated on {pages} pages (logos or marks) were left out.',
        },
        {
          count: decorations.length,
          pages: new Set(decorations.flatMap((d) => d.pages || [])).size,
        },
      ),
    );
  }

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
