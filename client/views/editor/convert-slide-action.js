/**
 * Shared "convert this slide to another type" action.
 *
 * One mutation path for every conversion entry point - the form dropdown's
 * Convert… menu and the inline (WYSIWYG) add/remove-image affordances: the
 * lossy-fields confirm, the conversion through the shared convert seam
 * (`convertSlideToType`), and the editor refresh. The slide id (and with it
 * notes, comments, locks and the URL) is untouched by design.
 */
import { confirmModal } from '../../lib/dom/modal.js';
import { t } from '../../lib/ui-i18n.js';
import { toast } from '../../lib/dom/toast.js';
import { debugLog } from '../../lib/state/debug.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import {
  convertSlideToType,
  getConvertibleSlideTypes,
  getConversionLossyKeys,
} from '../../../shared/slide-types.js';
import { declaredContentKeys } from '../../../shared/slide-types/declared-keys.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../shared/i18n-utils.js';

/**
 * Human label for a slide type (i18n key with definition-label fallback).
 * @param {string} type
 * @param {Object} SLIDE_TYPES
 * @returns {string}
 */
export function slideTypeLabel(type, SLIDE_TYPES) {
  const def = SLIDE_TYPES?.[type] || null;
  return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
}

/**
 * Whether the convert seam supports `slide` -> `toType`. The inline
 * affordances use this so a custom type that overrides a core name keeps
 * working while unrelated types never show the affordance.
 * @param {Object} slide
 * @param {string} toType
 * @param {Object} SLIDE_TYPES
 * @returns {boolean}
 */
export function canConvertSlideTo(slide, toType, SLIDE_TYPES) {
  return getConvertibleSlideTypes(slide, { slideTypes: SLIDE_TYPES }).includes(
    String(toType || ''),
  );
}

/**
 * Give the slide with `slideId` its new type in every language version other
 * than the one being edited.
 *
 * The save mirrors the active version's structure into the others, type
 * included, but keeps each version's own prose: also a string the new type
 * does not declare (D79). A conversion therefore left the old type's text
 * keys behind in every other version (`body` on a list slide), and the
 * server refuses such a deck as `unknown_field` on every save after it. So
 * each other version converts with the slide: through the convert seam where
 * it knows the pair, else by keeping the keys the new type declares (the
 * title survives; what does not fit becomes a translation gap, not a stale
 * key).
 *
 * @param {Object} opts
 * @param {Object} opts.pres
 * @param {string} opts.slideId
 * @param {string} opts.toType
 * @param {Object} opts.SLIDE_TYPES
 * @param {Object|null} [opts.theme]
 */
export function convertSlideInOtherVersions({
  pres,
  slideId,
  toType,
  SLIDE_TYPES,
  theme = null,
}) {
  const versions = pres?.i18n?.versions;
  if (!slideId || !versions || typeof versions !== 'object') return;
  const active = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
  const def = SLIDE_TYPES?.[toType];
  for (const [lang, version] of Object.entries(versions)) {
    if (normalizeLang(lang) === active || version?.slides === pres.slides)
      continue;
    const other = (version?.slides || []).find((s) => s?.id === slideId);
    if (!other || other.type === toType) continue;
    if (canConvertSlideTo(other, toType, SLIDE_TYPES)) {
      const next = convertSlideToType(other, toType, {
        slideTypes: SLIDE_TYPES,
        lang,
        theme,
      });
      other.type = next.type;
      other.content = next.content;
      continue;
    }
    const declared = declaredContentKeys(def);
    other.type = toType;
    other.content = Object.fromEntries(
      Object.entries(other.content || {}).filter(([key]) => declared.has(key)),
    );
  }
}

/**
 * Confirm (when fields would be lost) and convert `slide` to `toType` in
 * place, then refresh the editor.
 * @param {Object} opts
 * @param {Object} opts.slide - the live slide object (mutated on success)
 * @param {string} opts.toType
 * @param {Object} opts.pres
 * @param {Object} opts.editorState - createEditorStateUpdater instance
 * @param {Object} opts.SLIDE_TYPES
 * @returns {Promise<boolean>} true when the conversion was applied
 */
export async function convertSlideWithConfirm({
  slide,
  toType,
  pres,
  editorState,
  SLIDE_TYPES,
}) {
  if (!slide || !canConvertSlideTo(slide, toType, SLIDE_TYPES)) return false;

  const lossy = getConversionLossyKeys(slide, toType, {
    slideTypes: SLIDE_TYPES,
  });
  if (lossy.length) {
    const ok = await confirmModal(document.body, {
      title: t('editor.slide.convert', 'Convert…'),
      message: t(
        'editor.slide.convert.confirmLossy',
        'Convert "{from}" → "{to}"?\n\nThis will remove some fields:\n{fields}\n\n(Notes are kept.)',
        {
          from: slideTypeLabel(slide.type, SLIDE_TYPES),
          to: slideTypeLabel(toType, SLIDE_TYPES),
          fields: lossy.map((k) => `- ${k}`).join('\n'),
        },
      ),
      confirmLabel: t('editor.slide.convert', 'Convert…'),
      danger: true,
    });
    if (!ok) return false;
  }

  try {
    const lang = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
    // Conversions that gain a background image (chapter-title → title) take it
    // from the theme's own presets. Resolved here rather than threaded through
    // every caller, so all three entry points behave identically; loadThemeById
    // is cached, so this is a map lookup after the first call.
    let theme = null;
    try {
      theme = await loadThemeById(pres?.theme);
    } catch {
      theme = null;
    }
    const next = convertSlideToType(slide, toType, {
      slideTypes: SLIDE_TYPES,
      lang,
      theme,
    });
    slide.type = next.type;
    slide.content = next.content;
    convertSlideInOtherVersions({
      pres,
      slideId: slide.id,
      toType: next.type,
      SLIDE_TYPES,
      theme,
    });
    editorState.dirtyRefreshWithItem();
    return true;
  } catch (e) {
    debugLog('[editor] convert slide failed', e);
    toast.error(e);
    return false;
  }
}
