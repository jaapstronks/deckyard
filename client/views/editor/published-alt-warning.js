/**
 * The warning a published deck keeps up while a picture on it has no name
 * (B331, D164).
 *
 * Publishing refuses a meaningful picture without alt text (D137), but the
 * published page shows the deck as it is now, not as it was when the button
 * was pressed: remove an alt afterwards, or add a logo without a name, and it
 * goes live like that. The gate guards a moment; this guards the state.
 *
 * It is a state of the deck, not the outcome of something the user just did
 * (`docs/reference/feedback-surfaces.md`): a strip under the topbar that stays
 * while the state lasts and goes away by itself, never a toast and never an
 * inline refusal. Saving and publishing are untouched.
 *
 * The count comes from {@link findUnnamedImages}, the same function the
 * server's publish gate calls, so the warning and the refusal cannot disagree
 * about what counts.
 *
 * @module client/views/editor/published-alt-warning
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { findUnnamedImages } from '../../../shared/unnamed-images.js';
import { normalizeLang } from '../../../shared/i18n-utils.js';

/**
 * The deck as the published page will read it once the editor's state is
 * saved. The editor edits `pres.slides` in place and mirrors it into the
 * active version on save, so between the two the version entry can lag; the
 * active version is read from `pres.slides` so the warning follows the edit.
 *
 * @param {object} pres
 * @returns {object}
 */
function deckAsPublished(pres) {
  const active = normalizeLang(pres?.i18n?.active);
  const versions = pres?.i18n?.versions;
  if (!active || !versions?.[active]) return pres;
  return {
    ...pres,
    i18n: {
      ...pres.i18n,
      versions: {
        ...versions,
        [active]: { ...versions[active], slides: pres.slides },
      },
    },
  };
}

/**
 * Create the warning strip. It starts hidden; call `sync()` whenever the deck
 * or its published state may have changed.
 *
 * @param {Object} opts
 * @param {Object} opts.pres - the deck being edited
 * @param {Record<string, Object>} opts.slideTypes - the editor's registry
 * @param {(slideId: string) => void} [opts.onGoToSlide] - select a slide
 * @returns {{ el: HTMLElement, sync: () => void, detach: () => void }}
 */
export function createPublishedAltWarning({ pres, slideTypes, onGoToSlide }) {
  const text = h('span', { class: 'published-alt-warning-text' });
  const goBtn = h('button', {
    type: 'button',
    class: 'published-alt-warning-go',
  });
  let target = null;
  goBtn.addEventListener('click', () => {
    if (target) onGoToSlide?.(target);
  });
  // A status, not an alert: it describes a state the author may leave for a
  // while, and must not talk over what they are doing when it appears.
  const el = h('div', { class: 'published-alt-warning', role: 'status' }, [
    text,
    goBtn,
  ]);
  el.hidden = true;

  const sync = () => {
    const published = !!(
      typeof pres?.published?.id === 'string' && pres.published.id
    );
    const missing = published
      ? findUnnamedImages(deckAsPublished(pres), slideTypes)
      : [];
    if (!missing.length) {
      el.hidden = true;
      target = null;
      return;
    }
    // Point at a picture in the language being edited when there is one:
    // the fix is in that version's fields.
    const active = normalizeLang(pres?.i18n?.active);
    const first =
      missing.find((m) => m.lang === null || m.lang === active) || missing[0];
    const vars = {
      count: missing.length,
      slide: first.slideIndex + 1,
      lang: first.lang || '',
    };
    text.textContent =
      missing.length > 1
        ? t(
            'editor.publishedAltWarning.many',
            'This deck is published, and {count} images on it have no alt text.',
            vars,
          )
        : t(
            'editor.publishedAltWarning.one',
            'This deck is published, and an image on it has no alt text.',
            vars,
          );
    goBtn.textContent =
      first.lang && first.lang !== active
        ? t(
            'editor.publishedAltWarning.goToLang',
            'Go to slide {slide} ({lang})',
            vars,
          )
        : t('editor.publishedAltWarning.goTo', 'Go to slide {slide}', vars);
    target = first.slideId || null;
    goBtn.hidden = !target || !onGoToSlide;
    el.hidden = false;
  };

  return { el, sync, detach: () => el.remove() };
}
