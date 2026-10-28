/**
 * The notice before presenting or exporting a deck with incomplete slides
 * (B590): which slides still have an empty essential picture, and that the
 * output leaves them out.
 *
 * Informative only. The leaving-out happens in the visibility seam
 * (`shared/slide-visibility.js`), so `/present/:id` opened directly, an MCP
 * export or a v1 export skip the same slides without this notice; the editor
 * names them first so the author is not surprised by a shorter deck.
 */

import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { findIncompleteSlides } from '../../../shared/incomplete-slides.js';
import { getSlideVisibility } from '../../../shared/slide-visibility.js';
import { isLiveOnlySlideType } from '../../../shared/slide-types/live-session.js';

/** The visibility flag that already keeps a slide out of each output. */
const HIDDEN_FLAG = Object.freeze({
  presentation: 'hideInPresentation',
  export: 'hideInExport',
});

/**
 * The 1-based numbers of the slides in the list being edited that `context`
 * would show but leaves out for being incomplete.
 *
 * @param {Object} pres - the deck as the editor holds it
 * @param {Record<string, Object>} slideTypes - the editor's registry
 * @param {'presentation'|'export'} context
 * @returns {number[]}
 */
export function incompleteSlideNumbers(pres, slideTypes, context) {
  const flag = HIDDEN_FLAG[context];
  const hits = findIncompleteSlides({ slides: pres?.slides }, slideTypes, {
    include: (slide) =>
      !getSlideVisibility(slide)[flag] &&
      (context !== 'export' || !isLiveOnlySlideType(slide.type, slideTypes)),
  });
  return hits.map((hit) => hit.slideIndex + 1);
}

/**
 * Ask before presenting or exporting when slides will be left out. Resolves
 * `true` straight away when there are none.
 *
 * @param {HTMLElement} root - where the modal mounts
 * @param {Object} opts
 * @param {Object} opts.pres
 * @param {Record<string, Object>} opts.slideTypes
 * @param {'presentation'|'export'} opts.context
 * @returns {Promise<boolean>} whether to go on
 */
export function confirmIncompleteSlides(root, { pres, slideTypes, context }) {
  const numbers = incompleteSlideNumbers(pres, slideTypes, context);
  if (!numbers.length) return Promise.resolve(true);
  const vars = {
    n: numbers[0],
    list: numbers.join(', '),
    count: numbers.length,
  };
  const message =
    context === 'presentation'
      ? t(
          'editor.incomplete.present',
          {
            one: 'Slide {n} still has an empty image, so the presentation skips it. Choose an image to show it.',
            many: 'Slides {list} still have an empty image, so the presentation skips them. Choose an image to show them.',
          },
          vars,
        )
      : t(
          'editor.incomplete.export',
          {
            one: 'Slide {n} still has an empty image, so the export leaves it out. Choose an image to include it.',
            many: 'Slides {list} still have an empty image, so the export leaves them out. Choose an image to include them.',
          },
          vars,
        );
  return confirmModal(root, {
    title: t('editor.incomplete.title', 'Not every slide is finished'),
    message,
    confirmLabel: t('common.continue', 'Continue'),
  });
}
