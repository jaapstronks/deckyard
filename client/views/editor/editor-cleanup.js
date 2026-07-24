/**
 * Editor Cleanup Registry
 * Manages cleanup functions for the editor controller
 */

/**
 * Create a cleanup registry for the editor
 * @returns {object} Registry with register and cleanup methods
 */
export function createEditorCleanupRegistry() {
  const cleanupFns = new Map();
  // The registry is terminal: once runAll() has fired, the editor is gone and
  // anything registered afterwards (an async import or fetch that resolved
  // after the user navigated away) would otherwise sit in the map forever,
  // holding its window listeners and timers alive. Run it on arrival instead.
  let torndown = false;

  const runNow = (fn) => {
    try {
      fn();
    } catch {
      // ignore cleanup errors
    }
  };

  return {
    /**
     * Register a cleanup function. After teardown, the function is run
     * immediately instead of being stored.
     * @param {string} key - Unique identifier for this cleanup
     * @param {Function} fn - Cleanup function to call
     */
    register(key, fn) {
      if (typeof fn !== 'function') return;
      if (torndown) {
        runNow(fn);
        return;
      }
      cleanupFns.set(key, fn);
    },

    /**
     * Update a registered cleanup function
     * @param {string} key - Identifier to update
     * @param {Function} fn - New cleanup function
     */
    update(key, fn) {
      if (typeof fn !== 'function') return;
      if (torndown) {
        runNow(fn);
        return;
      }
      cleanupFns.set(key, fn);
    },

    /**
     * Whether runAll() has already fired.
     * @returns {boolean}
     */
    get isTornDown() {
      return torndown;
    },

    /**
     * Run a specific cleanup by key
     * @param {string} key - Identifier of cleanup to run
     */
    run(key) {
      const fn = cleanupFns.get(key);
      if (fn) {
        runNow(fn);
        cleanupFns.delete(key);
      }
    },

    /**
     * Run all registered cleanup functions and mark the registry torn down.
     */
    runAll() {
      torndown = true;
      for (const [, fn] of cleanupFns) runNow(fn);
      cleanupFns.clear();
    },

    /**
     * Get the number of registered cleanups
     */
    get size() {
      return cleanupFns.size;
    },
  };
}

/**
 * Attach editor lifecycle handlers (beforeunload, visibility change)
 * This is a re-export for backwards compatibility
 */
export { attachEditorLifecycle } from './editor-lifecycle.js';