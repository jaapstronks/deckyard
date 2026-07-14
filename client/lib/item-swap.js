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

/**
 * Factory for creating a swapper for nested items (e.g., blocks within rows).
 *
 * Used when items have a parent context, like text blocks within rows.
 *
 * @param {Object} options
 * @param {Function} options.getSlide - Returns the current slide object
 * @param {Function} options.getPrefix - (parentIndex, itemIndex) => field prefix string
 * @param {string[]} options.fields - Field suffixes to swap
 * @param {Object} options.callbacks - Editor callbacks
 * @returns {Function} swap(parentIndex, fromIndex, toIndex) - Swaps content within a parent
 */
export function createNestedItemSwapper({ getSlide, getPrefix, fields, callbacks = {} }) {
  const { markDirty, rerenderEditor, scheduleUiRefresh } = callbacks;

  /**
   * Swap content between two nested item positions
   * @param {number} parentIndex - Parent item index (e.g., row number)
   * @param {number} fromIndex - Source item index within parent
   * @param {number} toIndex - Target item index within parent
   */
  return function swap(parentIndex, fromIndex, toIndex) {
    const slide = getSlide();
    if (!slide?.content) return;

    // Store "from" values in temp
    const tempValues = {};
    for (const field of fields) {
      const fromKey = `${getPrefix(parentIndex, fromIndex)}${field}`;
      tempValues[field] = slide.content?.[fromKey] ?? '';
    }

    // Copy "to" values to "from"
    for (const field of fields) {
      const fromKey = `${getPrefix(parentIndex, fromIndex)}${field}`;
      const toKey = `${getPrefix(parentIndex, toIndex)}${field}`;
      slide.content[fromKey] = slide.content?.[toKey] ?? '';
    }

    // Copy temp values to "to"
    for (const field of fields) {
      const toKey = `${getPrefix(parentIndex, toIndex)}${field}`;
      slide.content[toKey] = tempValues[field];
    }

    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };
}
