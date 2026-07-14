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

  return {
    /**
     * Register a cleanup function
     * @param {string} key - Unique identifier for this cleanup
     * @param {Function} fn - Cleanup function to call
     */
    register(key, fn) {
      if (typeof fn === 'function') {
        cleanupFns.set(key, fn);
      }
    },

    /**
     * Update a registered cleanup function
     * @param {string} key - Identifier to update
     * @param {Function} fn - New cleanup function
     */
    update(key, fn) {
      if (typeof fn === 'function') {
        cleanupFns.set(key, fn);
      }
    },

    /**
     * Run a specific cleanup by key
     * @param {string} key - Identifier of cleanup to run
     */
    run(key) {
      const fn = cleanupFns.get(key);
      if (fn) {
        try {
          fn();
        } catch {
          // ignore cleanup errors
        }
        cleanupFns.delete(key);
      }
    },

    /**
     * Run all registered cleanup functions
     */
    runAll() {
      for (const [key, fn] of cleanupFns) {
        try {
          fn();
        } catch {
          // ignore cleanup errors
        }
      }
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