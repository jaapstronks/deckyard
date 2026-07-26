/**
 * Selection-aware inspector element tab — the pure decision + label helpers
 * behind the "[This element | Slide]" tab bar. Split out of `editor-form.js` as
 * a behaviour-preserving concern module (B10). Both functions are pure: they
 * take the current slide and selection ({kind, idx, fieldKey}) explicitly and
 * hold no state from the editor-form closure. The tab-bar rendering stays in
 * the closure (it sews over DOM/rerender state); this module owns only the
 * "does this element get a tab, and what is it called" logic.
 */
import { t } from '../../../lib/ui-i18n.js';

/**
 * Whether a selected canvas element ({kind, idx}) has an element tab on this
 * slide type. Every image type now carries a "This image" tab (the shared
 * image-element card, or image-text's own images manager). Cards: icon-card-grid
 * (idx in range).
 * @returns {boolean}
 */
export function elementAppliesToSlide(slide, sel) {
  if (!slide || !sel) return false;
  const c = slide.content || {};
  // Any text field the user selected on this slide is stylable (block-level
  // alignment/colour, editing-surfaces text step 3). The selection is cleared
  // on slide change, so a non-empty fieldKey is enough — no schema lookup.
  if (sel.kind === 'text') {
    return typeof sel.fieldKey === 'string' && sel.fieldKey.length > 0;
  }
  if (sel.kind === 'image') {
    const inList = (key) =>
      Array.isArray(c[key]) && sel.idx >= 0 && sel.idx < c[key].length;
    switch (slide.type) {
      case 'image-slide':
        return sel.idx === 0;
      case 'image-text-slide':
        return true; // images[] is padded to the layout's cell count on demand
      case 'gallery-slide':
        return inList('images');
      case 'team-cards-slide':
        return inList('members');
      case 'logo-wall-slide':
        return inList('logos');
      case 'content-columns-slide': {
        const count = Math.max(1, Math.min(7, Number(c.columnCount || 3) || 3));
        return sel.idx >= 1 && sel.idx <= count; // 1-based column number
      }
      case 'quote-slide':
        return sel.idx >= 1 && sel.idx <= 3; // up to three author portraits
      default:
        return false;
    }
  }
  if (sel.kind === 'card' && slide.type === 'icon-card-grid-slide') {
    const items = slide.content?.items;
    return Array.isArray(items) && sel.idx >= 0 && sel.idx < items.length;
  }
  return false;
}

/** Label for the element tab, by selected element kind. */
export function elementTabLabel(sel) {
  if (sel?.kind === 'image') return t('editor.inspector.tab.image', 'This image');
  if (sel?.kind === 'card') return t('editor.inspector.tab.card', 'This card');
  if (sel?.kind === 'text') return t('editor.inspector.tab.text', 'This text');
  return t('editor.inspector.tab.element', 'This element');
}
