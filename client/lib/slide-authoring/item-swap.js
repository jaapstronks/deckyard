/**
 * Factory function that creates an item swap function for slide content.
 *
 * Used in slide form editors to enable drag-and-drop reordering of items
 * like cards, blocks, columns, etc.
 *
 * @param {Object} options
 * @param {Function} options.getSlide - Returns the current slide object
 * @param {Function} options.getPrefix - (index) => field prefix string (e.g., (i) => `card${i}`)
 * @param {string[]} options.fields - Field suffixes to swap (e.g., ['Title', 'Body'])
 * @param {Object} options.callbacks - Editor callbacks
 * @param {Function} [options.callbacks.markDirty] - Mark slide as dirty
 * @param {Function} [options.callbacks.rerenderEditor] - Re-render the editor form
 * @param {Function} [options.callbacks.scheduleUiRefresh] - Schedule UI refresh
 * @returns {Function} swap(fromIndex, toIndex) - Swaps content between two indices
 */
export function createItemSwapper({ getSlide, getPrefix, fields, callbacks = {} }) {
  const { markDirty, rerenderEditor, scheduleUiRefresh } = callbacks;

  /**
   * Swap content between two item positions
   * @param {number} fromIndex - Source item index
   * @param {number} toIndex - Target item index
   */
  return function swap(fromIndex, toIndex) {
    const slide = getSlide();
    if (!slide?.content) return;

    // Store "from" values in temp
    const tempValues = {};
    for (const field of fields) {
      const fromKey = `${getPrefix(fromIndex)}${field}`;
      tempValues[field] = slide.content?.[fromKey] ?? '';
    }

    // Copy "to" values to "from"
    for (const field of fields) {
      const fromKey = `${getPrefix(fromIndex)}${field}`;
      const toKey = `${getPrefix(toIndex)}${field}`;
      slide.content[fromKey] = slide.content?.[toKey] ?? '';
    }

    // Copy temp values to "to"
    for (const field of fields) {
      const toKey = `${getPrefix(toIndex)}${field}`;
      slide.content[toKey] = tempValues[field];
    }

    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };
}
