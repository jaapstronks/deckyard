import { openTranslateSlideModal as openTranslateSlideModalImpl } from './modals/translate-slide-modal.js';
import { openTranslateFieldModal as openTranslateFieldModalImpl } from './modals/translate-field-modal.js';

/**
 * Wire the two translation modals the editor opens from a slide's language
 * controls: whole-slide translate and single-field translate. Both are thin
 * dep-spreading wrappers over their modal implementations and share nearly the
 * whole dependency set, so they live behind one factory.
 *
 * `rerenderEditor` / `rerenderPreview` come in as indirections (`() => fn()`)
 * because the controller binds the real renderers *after* this factory runs;
 * reading them at call time is what keeps a post-translate repaint pointed at
 * the live renderers rather than the boot-time no-op stubs.
 *
 * @param {object} ctx
 * @param {Function} ctx.h - hyperscript DOM helper
 * @param {object} ctx.api - API client
 * @param {string} ctx.id - presentation id
 * @param {object} ctx.pres - presentation model
 * @param {object} ctx.SLIDE_TYPES - slide-type registry
 * @param {object} ctx.toast - toast helper
 * @param {HTMLElement} ctx.root - editor root (overlay mount host)
 * @param {Function} ctx.lockDocumentScroll - scroll-lock helper
 * @param {Function} ctx.openOverlayClosers - overlay registry closer collector
 * @param {Function} ctx.normalizeLang - language normalizer
 * @param {Function} ctx.otherLang - "the other" language resolver
 * @param {Function} ctx.translatableKeysForType - translatable-keys resolver (slide modal only)
 * @param {Function} ctx.markDirty - mark the model dirty
 * @param {Function} ctx.rerenderEditor - repaint the editor form (late-bound indirection)
 * @param {Function} ctx.rerenderPreview - repaint the preview (late-bound indirection)
 * @param {Function} ctx.requestSave - schedule a save
 * @returns {{ openTranslateSlideModal: Function, openTranslateFieldModal: Function }}
 */
export function createTranslateOpeners({
  h,
  api,
  id,
  pres,
  SLIDE_TYPES,
  toast,
  root,
  lockDocumentScroll,
  openOverlayClosers,
  normalizeLang,
  otherLang,
  translatableKeysForType,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  requestSave,
}) {
  const openTranslateSlideModal = ({ slideId } = {}) =>
    openTranslateSlideModalImpl({
      slideId,
      h,
      api,
      id,
      pres,
      SLIDE_TYPES,
      toast,
      root,
      lockDocumentScroll,
      openOverlayClosers,
      normalizeLang,
      otherLang,
      translatableKeysForType,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      requestSave,
    });

  const openTranslateFieldModal = ({ slideId, key } = {}) =>
    openTranslateFieldModalImpl({
      slideId,
      key,
      h,
      api,
      id,
      pres,
      SLIDE_TYPES,
      toast,
      root,
      lockDocumentScroll,
      openOverlayClosers,
      normalizeLang,
      otherLang,
      markDirty,
      rerenderEditor,
      rerenderPreview,
      requestSave,
    });

  return { openTranslateSlideModal, openTranslateFieldModal };
}
