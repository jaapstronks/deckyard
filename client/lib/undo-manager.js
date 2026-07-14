/**
 * Undo Manager
 * Provides undo/redo functionality for presentation editing.
 *
 * Usage:
 * - Call `captureSnapshot()` AFTER making changes (via markDirty)
 * - The manager automatically tracks the "before" state for each edit sequence
 * - Call `undo()` to restore the previous state
 * - Call `redo()` to restore a previously undone state
 *
 * Edit sequences are grouped: rapid edits (typing) result in a single undo step.
 * The debounce window determines when one edit sequence ends and another begins.
 */

const DEFAULT_MAX_DEPTH = 50;
const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Create an undo manager instance.
 * @param {Object} options
 * @param {number} [options.maxDepth=50] - Maximum number of undo steps to keep
 * @param {number} [options.debounceMs=400] - Debounce window for grouping rapid edits
 * @param {Function} [options.onChange] - Called after any change to the undo/redo
 *   stacks, with `{ undoCount, redoCount }`. Lets the UI (e.g. topbar buttons)
 *   reflect canUndo/canRedo without polling.
 * @returns {Object} Undo manager instance
 */
export function createUndoManager({
  maxDepth = DEFAULT_MAX_DEPTH,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onChange = null,
} = {}) {
  const undoStack = [];
  const redoStack = [];

  const notifyChange = () => {
    if (typeof onChange !== 'function') return;
    try {
      onChange({ undoCount: undoStack.length, redoCount: redoStack.length });
    } catch {
      // ignore listener errors
    }
  };

  // State tracking for edit sequences
  let lastStableState = null; // State at end of last edit sequence (before current edits)
  let isNewSequence = true; // Whether next capture starts a new edit sequence
  let debounceTimer = null;
  let skipNextCapture = false; // Skip capture after undo/redo to avoid re-pushing

  /**
   * Deep clone a presentation object.
   * @param {Object} pres - Presentation to clone
   * @returns {Object} Deep clone
   */
  const clonePres = (pres) => {
    try {
      return structuredClone(pres);
    } catch {
      // Fallback for older browsers
      return JSON.parse(JSON.stringify(pres));
    }
  };

  /**
   * Initialize with the current state (call on editor load).
   * This establishes the "before" state for the first edit sequence.
   * @param {Object} pres - Current presentation state
   */
  const init = (pres) => {
    if (!pres) return;
    lastStableState = clonePres(pres);
    isNewSequence = true;
  };

  /**
   * Capture a snapshot after a change has been made.
   * Should be called via markDirty AFTER the change is applied.
   *
   * The manager tracks edit sequences:
   * - On first edit of a new sequence, pushes the PREVIOUS stable state
   * - Subsequent edits in the same sequence don't push (debounced)
   * - After debounce window, the current state becomes the new stable state
   *
   * @param {Object} pres - Current presentation state (after the change)
   * @param {Object} [meta] - Optional metadata
   * @param {string} [meta.slideId] - ID of the slide being edited
   * @param {string} [meta.action] - Description of the action
   */
  const captureSnapshot = (pres, meta = {}) => {
    if (!pres) return;

    // Skip capture after undo/redo (the restored state is already set as lastStableState)
    if (skipNextCapture) {
      skipNextCapture = false;
      // Still set up debounce timer for future edits
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastStableState = clonePres(pres);
        isNewSequence = true;
      }, debounceMs);
      return;
    }

    // If starting a new edit sequence and we have a previous stable state,
    // push that state (the "before" state) to the undo stack
    if (isNewSequence && lastStableState) {
      undoStack.push({
        pres: lastStableState,
        timestamp: Date.now(),
        slideId: meta.slideId || null,
        action: meta.action || 'edit',
      });

      // Clear redo stack on new edit
      redoStack.length = 0;

      // Enforce max depth
      while (undoStack.length > maxDepth) {
        undoStack.shift();
      }

      isNewSequence = false;
      notifyChange();
    }

    // Reset debounce timer - when it fires, current state becomes the new stable state
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      lastStableState = clonePres(pres);
      isNewSequence = true;
    }, debounceMs);
  };

  /**
   * Undo the last change.
   * @param {Object} currentPres - Current presentation state (to save for redo)
   * @returns {Object|null} The previous state to restore, or null if nothing to undo
   */
  const undo = (currentPres) => {
    if (undoStack.length === 0) return null;

    // Cancel any pending debounce
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Save current state to redo stack
    redoStack.push({
      pres: clonePres(currentPres),
      timestamp: Date.now(),
    });

    // Pop and return previous state
    const snapshot = undoStack.pop();

    // The restored state becomes the new stable state
    lastStableState = snapshot?.pres ? clonePres(snapshot.pres) : null;
    isNewSequence = true;
    skipNextCapture = true; // Don't capture the restore operation

    notifyChange();
    return snapshot;
  };

  /**
   * Redo a previously undone change.
   * @param {Object} currentPres - Current presentation state (to save for undo)
   * @returns {Object|null} The state to restore, or null if nothing to redo
   */
  const redo = (currentPres) => {
    if (redoStack.length === 0) return null;

    // Cancel any pending debounce
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Save current state to undo stack
    undoStack.push({
      pres: clonePres(currentPres),
      timestamp: Date.now(),
    });

    // Pop and return redo state
    const snapshot = redoStack.pop();

    // The restored state becomes the new stable state
    lastStableState = snapshot?.pres ? clonePres(snapshot.pres) : null;
    isNewSequence = true;
    skipNextCapture = true; // Don't capture the restore operation

    notifyChange();
    return snapshot;
  };

  /**
   * Check if undo is available.
   * @returns {boolean}
   */
  const canUndo = () => undoStack.length > 0;

  /**
   * Check if redo is available.
   * @returns {boolean}
   */
  const canRedo = () => redoStack.length > 0;

  /**
   * Get the current stack sizes.
   * @returns {Object} { undoCount, redoCount }
   */
  const getStackInfo = () => ({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  });

  /**
   * Clear all undo/redo history.
   */
  const clear = () => {
    undoStack.length = 0;
    redoStack.length = 0;
    lastStableState = null;
    isNewSequence = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    notifyChange();
  };

  return {
    init,
    captureSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
    getStackInfo,
    clear,
  };
}
