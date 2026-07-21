/**
 * Factory for managing collapsed state of items in slide editors.
 *
 * Creates a namespace-specific state manager that tracks collapsed/expanded
 * state for items identified by slideId and itemId.
 *
 * @param {string} namespace - Unique namespace for this state set (e.g., 'row', 'card', 'col')
 * @returns {Object} State manager with isCollapsed, toggle, setCollapsed methods
 */
export function createCollapsedState(namespace) {
  const state = new Map();

  /**
   * Generate a unique key for an item
   * @param {string} slideId - The slide's unique ID
   * @param {string|number} itemId - The item's identifier within the slide
   * @returns {string}
   */
  function getKey(slideId, itemId) {
    return `${slideId}-${namespace}${itemId}`;
  }

  /**
   * Check if an item is collapsed
   * @param {string} key - The item key (from getKey)
   * @returns {boolean}
   */
  function isCollapsed(key) {
    return state.get(key) ?? false;
  }

  /**
   * Toggle collapsed state for an item
   * @param {string} key - The item key (from getKey)
   * @returns {boolean} The new collapsed state
   */
  function toggle(key) {
    const newValue = !state.get(key);
    state.set(key, newValue);
    return newValue;
  }

  /**
   * Set collapsed state for an item
   * @param {string} key - The item key (from getKey)
   * @param {boolean} value - The collapsed state to set
   */
  function setCollapsed(key, value) {
    state.set(key, !!value);
  }

  /**
   * Set collapsed state for a batch of items at once
   * @param {string[]} keys - Item keys (from getKey)
   * @param {boolean} value - The collapsed state to set for all of them
   */
  function setAll(keys, value) {
    for (const key of keys) state.set(key, !!value);
  }

  /**
   * Check whether every item in a batch is collapsed
   * @param {string[]} keys - Item keys (from getKey)
   * @returns {boolean} true when there is at least one key and all are collapsed
   */
  function allCollapsed(keys) {
    return keys.length > 0 && keys.every((key) => isCollapsed(key));
  }

  return {
    getKey,
    isCollapsed,
    toggle,
    setCollapsed,
    setAll,
    allCollapsed,
  };
}
