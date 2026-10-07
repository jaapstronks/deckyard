/**
 * Shared "This card" inspector card for one selected collection item — the
 * item counterpart of image-element-card.js.
 *
 * The editing-surface principle (docs/reference/editing-surfaces.md): content
 * goes on the canvas, settings go in the inspector, and the bulk "All text"
 * modal is never the only home of a field. An item's settings — text-blocks'
 * row colour and the arrow to the next row, a matrix cell's tone — are not
 * content you can point at, so they render here when the item is selected on
 * the canvas (B450, D313).
 *
 * Driven entirely by the type's declaration: `elementTab.card` names the list
 * and the item fields this card renders (`fields`), and each field renders
 * through the same per-item widget the collection editor uses
 * (item-field-widget.js). A fork type gets the card by declaring it, without a
 * file outside its own directory.
 */
import { renderItemFieldWidget } from './item-field-widget.js';
import { slideTypeElementTab } from '../../../../shared/slide-types/inline-edit-companions.js';

/**
 * Render the declared item fields of the selected item into `container`.
 * Renders nothing when the type declares no card fields or the index is out
 * of range, so the caller can always call it.
 *
 * A collection's `relationField` (the relation to the NEXT item) is skipped
 * on the last item, the same rule the collection editor applies.
 *
 * @param {Object} o
 * @param {HTMLElement} o.container - the element-tab form
 * @param {Object} o.slide - the current slide
 * @param {Object} o.def - the slide-type definition
 * @param {number} o.idx - the selected item's index
 * @param {Object} o.fieldRenderers - the editor's field renderers
 * @param {Array<Object>} [o.deckSlides] - options for a card-link field
 * @param {Function} [o.markDirty]
 * @param {Function} [o.rerenderEditor]
 * @param {Function} [o.rerenderPreview]
 * @param {Function} [o.scheduleUiRefresh]
 */
export function renderItemElementCard({
  container,
  slide,
  def,
  idx,
  fieldRenderers,
  deckSlides = [],
  markDirty,
  rerenderEditor,
  rerenderPreview,
  scheduleUiRefresh,
}) {
  const card = slideTypeElementTab(slide?.type, def)?.card;
  if (typeof card?.list !== 'string' || !Array.isArray(card.fields)) return;
  const items = slide.content?.[card.list];
  if (!Array.isArray(items) || !Number.isInteger(idx) || !items[idx]) return;
  const listField = (def?.fields || []).find((f) => f.key === card.list);
  const byKey = new Map(
    (listField?.itemFields || []).map((f) => [String(f.key), f]),
  );
  const item = items[idx];

  const setItemKey = (k, v) => {
    item[k] = v;
    markDirty?.();
    rerenderPreview?.();
    scheduleUiRefresh?.();
  };

  for (const key of card.fields) {
    const field = byKey.get(String(key));
    if (!field || field.hidden) continue;
    if (listField.relationField === field.key && idx >= items.length - 1) {
      continue;
    }
    const widget = renderItemFieldWidget({
      field,
      item,
      setItemKey,
      slide,
      def,
      fieldRenderers,
      deckSlides,
      onImageChange: rerenderEditor,
    });
    if (widget) container.append(widget);
  }
}
