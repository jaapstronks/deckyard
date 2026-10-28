/**
 * "Choose image" for an incomplete slide (B590): open the image picker for
 * the picture the slide still lacks and write the pick where the slide's own
 * image field would have written it.
 *
 * Which picture is missing is the one shared answer, `missingPicture()` in
 * `shared/incomplete-slides.js`; nothing marks the slide, so this is only a
 * shortcut to the field. Filling it by any other route (the form, inline, the
 * canvas, MCP, v1, a collaborator) finishes the slide just the same.
 */
import { t } from '../../../lib/ui-i18n.js';
import { missingPicture } from '../../../../shared/incomplete-slides.js';
import {
  DEFAULT_DECK_LANG,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';
import { createAltSetter, imageAltKey } from '../fields/images/alt-utils.js';
import { applyAltFromPick, applyPickMeta } from './apply-pick.js';

/**
 * The alt text a pick carries for one language: its per-language map wins,
 * the single seed is the fallback (the order `applyAltFromPick` follows).
 */
function altFor(picked, lang) {
  const alts =
    picked?.alts && typeof picked.alts === 'object' ? picked.alts : null;
  if (alts) return typeof alts[lang] === 'string' ? alts[lang] : '';
  return typeof picked?.alt === 'string' ? picked.alt.trim() : '';
}

/**
 * Whether the slide lacks a picture this shortcut can fill.
 * @param {Object} slide
 * @param {Record<string, Object>} slideTypes - the editor's registry
 * @returns {boolean}
 */
export function canPickMissingPicture(slide, slideTypes) {
  return missingPicture(slide, slideTypes) !== null;
}

/**
 * Open the picker for the slide's missing picture.
 *
 * @param {Object} options
 * @param {Function} options.openImagePicker - the editor's picker seam
 * @param {Object} options.slide - the slide to fill, mutated on pick
 * @param {Record<string, Object>} options.slideTypes - the editor's registry
 * @param {Object|null} [options.pres] - the deck, when the slide lives in it:
 *   the alt text then seeds every language version the deck has
 * @param {string|null} [options.lang] - the language being edited; the
 *   deck's active one when omitted
 * @param {Function} [options.normalizeLang]
 * @param {Function} options.onPicked - () => void, after the slide changed
 */
export function pickMissingPicture({
  openImagePicker,
  slide,
  slideTypes,
  pres = null,
  lang = null,
  normalizeLang = (value) => value,
  onPicked,
}) {
  const target = missingPicture(slide, slideTypes);
  if (!target || typeof openImagePicker !== 'function') return;
  const { field, picture } = target;
  openImagePicker({
    title: t('editor.image.libraryTitle', 'Library: choose an image'),
    docId: pres?.id || '',
    allowCaptionCredit: false,
    context: {
      presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
      slideId: slide?.id || '',
      slideType: slide?.type || '',
    },
    onPick: (picked) => {
      const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
      if (!url) return;
      slide.content =
        slide.content && typeof slide.content === 'object' ? slide.content : {};
      const activeLang =
        normalizeLang(lang || pres?.i18n?.active) || DEFAULT_DECK_LANG;
      if (picture) {
        // A list of pictures: the first item is the one that is missing.
        const list = Array.isArray(slide.content[field.key])
          ? [...slide.content[field.key]]
          : [];
        const item = { ...(list[0] || {}), [picture.key]: url };
        // The item's own alt sibling, spelled as `pictureOf()` reads it.
        const altKey = (field.itemFields || []).some((f) => f?.key === 'alt')
          ? 'alt'
          : `${picture.key}Alt`;
        item[altKey] = altFor(picked, activeLang);
        list[0] = item;
        slide.content[field.key] = list;
      } else {
        slide.content[field.key] = url;
        applyAltFromPick({
          picked,
          activeLang,
          sourceLang: pres ? translationSourceFor(pres, activeLang) : null,
          setAltForLang: createAltSetter({
            slide,
            pres,
            normalizeLang,
            activeLang,
            fieldKey: imageAltKey(field),
          }),
        });
        applyPickMeta({
          picked,
          content: slide.content,
          providerIdKey: 'imagekitFileId',
        });
      }
      onPicked?.();
    },
  });
}
