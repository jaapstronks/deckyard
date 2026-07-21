/**
 * Busy state manager for UI elements.
 * Reduces boilerplate for managing disabled states during async operations.
 *
 * @example
 * const busyManager = createBusyManager({
 *   elements: [submitBtn, cancelBtn, inputField],
 *   onBusyChange: (busy) => {
 *     statusEl.textContent = busy ? 'Loading...' : '';
 *   },
 * });
 *
 * busyManager.setBusy(true);
 * try {
 *   await doSomething();
 * } finally {
 *   busyManager.setBusy(false);
 * }
 *
 * // Or use the wrapper:
 * await busyManager.run(async () => {
 *   await doSomething();
 * });
 */

/**
 * Create a busy state manager for a set of UI elements.
 *
 * @param {Object} options
 * @param {HTMLElement[]} [options.elements=[]] - Elements to disable when busy
 * @param {Function} [options.onBusyChange] - Callback when busy state changes
 * @param {boolean} [options.initialBusy=false] - Initial busy state
 * @returns {Object} Busy manager with isBusy(), setBusy(), run() methods
 */
export function createBusyManager(options = {}) {
  // Back-compat: also accept a positional array of elements, the shape the
  // former modal.js createBusyManager used.
  const {
    elements = [],
    onBusyChange = null,
    initialBusy = false,
  } = Array.isArray(options) ? { elements: options } : options;
  let busy = initialBusy;

  const updateElements = () => {
    for (const el of elements) {
      if (el && typeof el.disabled !== 'undefined') {
        el.disabled = busy;
      }
    }
  };

  const setBusy = (value) => {
    const newBusy = Boolean(value);
    if (busy === newBusy) return;
    busy = newBusy;
    updateElements();
    if (typeof onBusyChange === 'function') {
      onBusyChange(busy);
    }
  };

  const isBusy = () => busy;

  /**
   * Add elements to the managed set.
   * @param {...HTMLElement} els - Elements to add
   */
  const addElements = (...els) => {
    for (const el of els) {
      if (el && !elements.includes(el)) {
        elements.push(el);
        if (busy && typeof el.disabled !== 'undefined') {
          el.disabled = true;
        }
      }
    }
  };

  /**
   * Remove elements from the managed set.
   * @param {...HTMLElement} els - Elements to remove
   */
  const removeElements = (...els) => {
    for (const el of els) {
      const idx = elements.indexOf(el);
      if (idx !== -1) {
        elements.splice(idx, 1);
      }
    }
  };

  /**
   * Run an async function with busy state automatically managed.
   * Sets busy=true before running, busy=false after (even on error).
   *
   * @param {Function} fn - Async function to run
   * @returns {Promise<*>} Result of fn()
   */
  const run = async (fn) => {
    if (busy) return undefined;
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  // Apply initial state
  if (initialBusy) {
    updateElements();
  }

  return {
    isBusy,
    setBusy,
    addElements,
    removeElements,
    // Singular aliases for back-compat with the former modal.js manager.
    addElement: (el) => addElements(el),
    removeElement: (el) => removeElements(el),
    run,
  };
}

/**
 * Create a simple busy manager for common patterns.
 * Shorthand for the most common use case.
 *
 * @param  {...HTMLElement} elements - Elements to disable when busy
 * @returns {Object} Busy manager
 */
export function simpleBusyManager(...elements) {
  return createBusyManager({ elements });
}