/**
 * Selection-aware inspector element tab — the pure decision + label helpers
 * behind the "[This element | Slide]" tab bar. Split out of `editor-form.js` as
 * a behaviour-preserving concern module (B10). Both functions are pure: they
 * take the current slide and selection ({kind, idx, fieldKey}) explicitly and
 * hold no state from the editor-form closure. The tab-bar rendering stays in
 * the closure (it sews over DOM/rerender state); this module owns only the
 * "does this element get a tab, and what is it called" logic.
 *
 * Which sub-element kinds a type offers used to be a `switch (slide.type)` over
 * seven names here — per-type data written as code, in the one place a new type
 * would silently be missing from. The type declares it now (`elementTab`,
 * beside `inspectorKeeps` in its own directory) and this module reads the
 * grammar through shared/slide-types/inline-edit-companions.js.
 */
import { t } from '../../../lib/ui-i18n.js';
import {
  elementTabOffersIndex,
  slideTypeElementTab,
} from '../../../../shared/slide-types/inline-edit-companions.js';

/**
 * Whether a selected canvas element ({kind, idx}) has an element tab on this
 * slide type.
 *
 * @param {Object} slide - the current slide
 * @param {Object} sel - the selection ({kind, idx, fieldKey})
 * @param {Object} [opts]
 * @param {Object} [opts.slideTypes] - the editor's slide-type metadata, so a
 *   fork type's own declaration is heard (the definition is asked first)
 * @returns {boolean}
 */
export function elementAppliesToSlide(slide, sel, { slideTypes = null } = {}) {
  if (!slide || !sel) return false;
  // Any text field the user selected on this slide is stylable (block-level
  // alignment/colour, editing-surfaces text step 3). The selection is cleared
  // on slide change, so a non-empty fieldKey is enough — no schema lookup, and
  // nothing per-type to declare.
  if (sel.kind === 'text') {
    return typeof sel.fieldKey === 'string' && sel.fieldKey.length > 0;
  }
  const offer = slideTypeElementTab(
    slide.type,
    slideTypes?.[slide.type] || null,
  )?.[sel.kind];
  return elementTabOffersIndex(offer, slide.content || {}, sel.idx);
}

/** Label for the element tab, by selected element kind. */
export function elementTabLabel(sel) {
  if (sel?.kind === 'image')
    return t('editor.inspector.tab.image', 'This image');
  if (sel?.kind === 'card') return t('editor.inspector.tab.card', 'This card');
  if (sel?.kind === 'text') return t('editor.inspector.tab.text', 'This text');
  return t('editor.inspector.tab.element', 'This element');
}
